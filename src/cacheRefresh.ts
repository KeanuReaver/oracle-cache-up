import * as vscode from 'vscode';
import * as oracledb from 'oracledb';

import { saveCache } from './cache';
import { buildConnectString, getActiveConnection, getPasswordKey } from './connections';
import { getMetadataQuery, validateCustomMetadataQuery } from './metadataQueries';
import { OracleMetadataCache, OracleConnection } from './types';

export function registerRefreshCacheCommand(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'oracle-cache-up.refreshCache',
			async () => refreshCache(context)
		)
	);
}

export async function testCustomMetadataQuery(
    context: vscode.ExtensionContext,
    connectionInfo: OracleConnection
): Promise<void> {
    const missingAliases = validateCustomMetadataQuery(connectionInfo.customMetadataQuery ?? '');
    if (missingAliases.length > 0) {
        throw new Error(
            `Missing required aliases: ${missingAliases.join(', ')}`
        );
    }

    const password = await context.secrets.get(getPasswordKey(connectionInfo.name));
    if (!password) {
        throw new Error(`No password saved for "${connectionInfo.name}".`);
    }

    let connection: oracledb.Connection | undefined;

    try {
        connection = await oracledb.getConnection({
            user: connectionInfo.user,
            password,
            connectString: buildConnectString(connectionInfo)
        });

        const result = await connection.execute(
            `
                SELECT *
                FROM (
                    ${(connectionInfo.customMetadataQuery ?? '').trim().replace(/;$/, '')}
                )
                WHERE ROWNUM <= 1
            `, 
            {}, 
            { outFormat: (oracledb as any).OUT_FORMAT_OBJECT }
        );
        
        const row = result.rows?.[0];

        if (!row) {
            throw new Error('Query returned no rows.');
        }

        const required = ['TABLE_NAME', 'FIELD_NAME', 'FIELD_DATA_TYPE'];
        const rowKeys = Object.keys(row).map(key => key.toUpperCase());
        const missing = required.filter(
            key => !rowKeys.includes(key)
        );

        if (missing.length > 0) {
            throw new Error(
                `Query result is missing required columns: ${missing.join(', ')}`
            );
        }
    } finally {
        if (connection) {
            await connection.close();
        }
    }
}

export async function refreshCache(context: vscode.ExtensionContext): Promise<void> {
    let connection: oracledb.Connection | undefined;

    try {
        const activeConnection = getActiveConnection();

        if (!activeConnection) {
            vscode.window.showErrorMessage('No active OracleCacheUp connection configured.');
            return;
        }

        const password = await context.secrets.get(getPasswordKey(activeConnection.name));

        if (!activeConnection.user || !password) {
            vscode.window.showErrorMessage('OracleCacheUp connection is not configured. Set connection values and password first.');
            return;
        }

        connection = await oracledb.getConnection({
            user: activeConnection.user,
            password,
            connectString: buildConnectString(activeConnection)
        });

        if (activeConnection.metadataSource === 'custom') {
            const missingAliases = validateCustomMetadataQuery(
                activeConnection.customMetadataQuery ?? ''
            );

            if (missingAliases.length > 0) {
                vscode.window.showErrorMessage(
                    `Custom metadata query is missing required aliases: ${missingAliases.join(', ')}`
                );

                return;
            }
        }

        const rows = await getDictionary(activeConnection, connection);
        const newCache = buildMetadataCache(rows);

        if (activeConnection.metadataSource === 'powerschool' 
                    && vscode.workspace
                            .getConfiguration('oracleCacheUp')
                            .get<boolean>('inferPowerSchoolRelationships')
        ) {
            inferPowerSchoolRelationships(newCache);
        }

        saveCache(newCache);
        showCacheRefreshMessage(newCache);
    } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Cache refresh failed: ${errMsg}`);
    } finally {
        if (connection) {
            await connection.close();
        }
    }
}

function showCacheRefreshMessage(newCache: OracleMetadataCache): void {
    const tableCount = Object.keys(newCache).length;

    let fieldCount = 0;

    for (const fields of Object.values(newCache)) {
        fieldCount += Object.keys(fields).filter(
            fieldName => fieldName !== '_table'
        ).length;
    }

    const message =
        `OracleCacheUp cache refreshed. Cached ${tableCount.toLocaleString()} tables and ${fieldCount.toLocaleString()} fields.`;

    if (fieldCount > 250000) {
        vscode.window.showWarningMessage(
            `${message} This is a large cache; hover performance may be affected.`
        );
    }
    else {
        vscode.window.showInformationMessage(message);
    }
}

async function getDictionary(
    activeConnection: OracleConnection,
    connection: oracledb.Connection
): Promise<any[]> {
    const metadataQuery = getMetadataQuery(activeConnection);
    const binds = activeConnection.metadataSource === 'custom'
            ? {}
            : {
                owner: activeConnection.owner?.trim()
                    ? activeConnection.owner.trim().toUpperCase()
                    : null
            };

    const result = await connection.execute(metadataQuery, binds, { outFormat: (oracledb as any).OUT_FORMAT_OBJECT });

    return Array.isArray(result.rows)
        ? result.rows
        : [];
}

function buildMetadataCache(rows: any[]) {
	const sqlCache: OracleMetadataCache = {};

    if (!Array.isArray(rows)) {
        return sqlCache;
    }

	for (const row of rows) {
		const   tableNameRaw = row.table_name ?? row.TABLE_NAME,
                fieldNameRaw = row.field_name ?? row.FIELD_NAME,
                fieldDataType = row.field_data_type ?? row.FIELD_DATA_TYPE,
                tableDesc = row.table_desc ?? row.TABLE_DESC,
                columnDesc = row.column_desc ?? row.COLUMN_DESC,
                parentTable = row.parent_table ?? row.PARENT_TABLE,
                parentTableIndex = row.parent_table_index ?? row.PARENT_TABLE_INDEX,
                coreTable = row.core_table ?? row.CORE_TABLE,
                isCore = row.is_core ?? row.IS_CORE;

		if (!tableNameRaw || !fieldNameRaw || !fieldDataType) {
			continue;
		}

		const tableName = String(tableNameRaw).toUpperCase();
		const fieldName = String(fieldNameRaw).toUpperCase();

		if (!sqlCache[tableName]) {
			sqlCache[tableName] = {};
		}

		if (tableDesc && !sqlCache[tableName]._table) {
			sqlCache[tableName]._table = {
				description: String(tableDesc)
			};
		}

		sqlCache[tableName][fieldName] = {
			field_data_type: String(fieldDataType),
			description: columnDesc ? String(columnDesc) : undefined,
			parent_table: parentTable ? String(parentTable).toUpperCase() : undefined,
			parent_table_index: parentTableIndex ? String(parentTableIndex).toUpperCase() : undefined,
			core_table: coreTable ? String(coreTable).toUpperCase() : undefined,
			is_core: Number(isCore ?? 0) === 1
		};
	}

	return sqlCache;
}



function inferPowerSchoolRelationships(newCache: OracleMetadataCache): void {
    const tableLookup = new Map<string, string>();

    for (const tableName of Object.keys(newCache)) {
        tableLookup.set(tableName.toUpperCase(), tableName);

        if (tableName.toUpperCase().endsWith('S')) {
            tableLookup.set(tableName.toUpperCase().slice(0, -1), tableName);
        }
    }

    for (const [tableName, table] of Object.entries(newCache)) {
        for (const [fieldName, fieldInfo] of Object.entries(table)) {
            if (fieldName === '_table') {
                continue;
            }

            const info = fieldInfo as any;
            const name = fieldName.toUpperCase();

            const alreadyHasRelationship =
                info.parent_table ||
                info.relationship_table ||
                info.foreign_table;

            if (alreadyHasRelationship || name === 'ID' || name === 'DCID') {
                continue;
            }

            let base: string | undefined;

            if (name.endsWith('_DCID')) {
                base = name.slice(0, -5);
            } else if (name.endsWith('DCID')) {
                base = name.slice(0, -4);
            } else if (name.endsWith('_ID')) {
                base = name.slice(0, -3);
            } else if (name.endsWith('ID')) {
                base = name.slice(0, -2);
            }

            if (!base) {
                continue;
            }

            const matched = tableLookup.get(base) ?? tableLookup.get(`${base}S`);

            if (matched && matched.toUpperCase() !== tableName.toUpperCase()) {
                info.relationship_table = matched;
                info.relationship_source = 'powerschool-inferred';

                if (name.endsWith('DCID')) {
                    info.relationship_column = 'DCID';
                } else {
                    info.relationship_column = 'ID';
                }
            }
        }
    }

    for (const [tableName, table] of Object.entries(newCache)) {
        for (const [fieldName, fieldInfo] of Object.entries(table)) {
            if (fieldName === '_table') {
                continue;
            }

            const info = fieldInfo as any;

            if (!info.relationship_table) {
                continue;
            }

            const parentTable = newCache[info.relationship_table];

            if (!parentTable) {
                continue;
            }

            if (!parentTable._table) {
                parentTable._table = {};
            }

            const tableInfo = parentTable._table as any;

            if (!tableInfo.extended_by) {
                tableInfo.extended_by = [];
            }

            if (!tableInfo.extended_by.includes(tableName)) {
                tableInfo.extended_by.push(tableName);
            }
        }
    }
}