import * as vscode from 'vscode';
import * as oracledb from 'oracledb';

import { saveCache } from './cache';
import { buildConnectString, getActiveConnection, getPasswordKey } from './connections';
import { getGenericOracleMetadataQuery } from './metadataQueries';
import { OracleMetadataCache } from './types';

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

				const metadataQuery = getGenericOracleMetadataQuery();

				const owner = activeConnection.owner;

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

				const rows = JSON.parse(jsonText || '[]');

				const newCache: OracleMetadataCache = {};

				for (const row of rows) {
					const tableName = row.table_name.toUpperCase();
					const fieldName = row.field_name.toUpperCase();

					if (!newCache[tableName]) {
						newCache[tableName] = {};
					}

					newCache[tableName][fieldName] = {
						field_data_type: row.field_data_type
					};
				}

				saveCache(newCache);

				const tableCount = Object.keys(newCache).length;
				let fieldCount = 0;

				for (const fields of Object.values(newCache)) {
					fieldCount += Object.keys(fields).length;
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
