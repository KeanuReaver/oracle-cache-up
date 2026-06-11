import * as vscode from 'vscode';
import * as oracledb from 'oracledb';

import { saveCache } from './cache';
import { buildConnectString, getActiveConnection, getPasswordKey } from './connections';
import { getMetadataQuery, validateCustomMetadataQuery } from './metadataQueries';
import { OracleMetadataCache, OracleConnection } from './types';

export function registerRefreshCacheCommand(context: vscode.ExtensionContext): void {
	const refreshCacheCommand = vscode.commands.registerCommand(
		'oracle-cache-up.refreshCache',
		async () => {
			let connection: any;

			try {
				const activeConnection = getActiveConnection();

				if (!activeConnection) {
					vscode.window.showErrorMessage(
						'No active OracleCacheUp connection configured.'
					);
					return;
				}

				const password = await context.secrets.get(
					getPasswordKey(activeConnection.name)
				);

				if (!activeConnection.user || !password) {
					vscode.window.showErrorMessage(
						'OracleCacheUp connection is not configured. Set connection values and password first.'
					);
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

				const metadataQuery = getMetadataQuery(activeConnection);

				const owner = activeConnection.owner;

				let rows: any[] = [];

				if (activeConnection.metadataSource === 'custom') {
					const result = await connection.execute(
						metadataQuery,
						{},
						{
							outFormat: (oracledb as any).OUT_FORMAT_OBJECT
						}
					);

					rows = result.rows ?? [];
				}
				else {
					const result = await connection.execute(
						metadataQuery,
						{
							owner: owner?.trim()
								? owner.trim().toUpperCase()
								: null
						},
						{
							fetchInfo: {
								CACHE_JSON: {
									type: oracledb.STRING
								}
							}
						}
					);

					const jsonText = result.rows?.[0]?.[0] as string;
					rows = JSON.parse(jsonText || '[]');
				}

				const newCache: OracleMetadataCache = {};

				for (const row of rows) {
					const tableNameRaw = row.table_name ?? row.TABLE_NAME;
					const fieldNameRaw = row.field_name ?? row.FIELD_NAME;
					const fieldDataType = row.field_data_type ?? row.FIELD_DATA_TYPE;
					const tableDesc = row.table_desc ?? row.TABLE_DESC;
					const columnDesc = row.column_desc ?? row.COLUMN_DESC;

					if (!tableNameRaw || !fieldNameRaw || !fieldDataType) {
						continue;
					}

					const tableName = String(tableNameRaw).toUpperCase();
					const fieldName = String(fieldNameRaw).toUpperCase();

					if (!newCache[tableName]) {
						newCache[tableName] = {};
					}

					if (tableDesc && !newCache[tableName]._table) {
						newCache[tableName]._table = {
							description: String(tableDesc)
						};
					}

					newCache[tableName][fieldName] = {
						field_data_type: String(fieldDataType),
						description: columnDesc ? String(columnDesc) : undefined
					};
				}

				saveCache(newCache);

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
			catch (err: any) {
				vscode.window.showErrorMessage(`Cache refresh failed: ${err.message}`);
			}
			finally {
				if (connection) {
					await connection.close();
				}
			}
		}
	);

	context.subscriptions.push(refreshCacheCommand);
}

export async function testCustomMetadataQuery(
    context: vscode.ExtensionContext,
    connectionInfo: OracleConnection
): Promise<void> {
    const missingAliases = validateCustomMetadataQuery(
        connectionInfo.customMetadataQuery ?? ''
    );

    if (missingAliases.length > 0) {
        throw new Error(
            `Missing required aliases: ${missingAliases.join(', ')}`
        );
    }

    const password = await context.secrets.get(
        getPasswordKey(connectionInfo.name)
    );

    if (!password) {
        throw new Error(`No password saved for "${connectionInfo.name}".`);
    }

    let connection: any;

    try {
        connection = await oracledb.getConnection({
            user: connectionInfo.user,
            password,
            connectString: buildConnectString(connectionInfo)
        });

		const customQuery = (connectionInfo.customMetadataQuery ?? '')
			.trim()
			.replace(/;$/, '');

        const testQuery = `
            SELECT *
            FROM (
                ${customQuery}
            )
            WHERE ROWNUM <= 1
        `;

        const result = await connection.execute(
            testQuery,
            {},
            {
                outFormat: (oracledb as any).OUT_FORMAT_OBJECT
            }
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
    }
    finally {
        if (connection) {
            await connection.close();
        }
    }
}