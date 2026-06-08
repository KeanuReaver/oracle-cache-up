// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as oracledb from 'oracledb';

let cache: any = {};

function loadCache() {
	const cachePath = path.join(__dirname, '../cache/metadata.json');

	if (!fs.existsSync(cachePath)) {
		cache = {};
		return;
	}

	const raw = fs.readFileSync(cachePath, 'utf8').trim();

	if (!raw) {
		cache = {};
		return;
	}

	cache = JSON.parse(raw);
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// console.log('OracleCacheUp active');
	vscode.window.showInformationMessage('OracleCacheUp activated');
	loadCache();

	const refreshCacheCommand = vscode.commands.registerCommand(
		'oracle-cache-up.refreshCache',
		async () => {
			let connection: oracledb.Connection | undefined;
			

			try {
				const config = vscode.workspace.getConfiguration('oracleCacheUp');

				const user = config.get<string>('user');
				const connectString = config.get<string>('connectString');
				const owner = config.get<string>('owner') ?? 'PS';
				const password = await context.secrets.get('oracleCacheUp.password');

				if (!user || !connectString || !password) {
					vscode.window.showErrorMessage(
						'OracleCacheUp connection is not configured. Set user/connectString in settings and run OracleCacheUp: Set Password.'
					);
					return;
				}

				connection = await oracledb.getConnection({
					user,
					password,
					connectString
				});

				const result = await connection.execute(
					`
						SELECT
							JSON_ARRAYAGG(
								JSON_OBJECT(
									'table_name' VALUE atc.table_name,
									'field_name' VALUE atc.column_name,
									'field_version' VALUE COALESCE(pb_dict.field_version, cust_dict.field_version, '1.0'),
									'field_data_type' VALUE atc.data_type || chr(40) || atc.data_length || chr(41)
									RETURNING CLOB
								)
								RETURNING CLOB
							) AS CACHE_JSON
						FROM (
							SELECT table_name, column_name, data_type, data_length
							FROM all_tab_columns
							WHERE owner = :owner
						) atc
						LEFT JOIN (
							SELECT 
								UPPER(dictionaryobject.objectname) AS table_name_uc,
								UPPER(dictionarycolumn.columnname) AS column_name_uc,
								dictionarycolumn.columnversion AS field_version
							FROM dictionarycolumn
							INNER JOIN dictionaryobject 
								ON dictionaryobject.objectname = dictionarycolumn.tablename
						) pb_dict
							ON pb_dict.table_name_uc = atc.table_name
							AND pb_dict.column_name_uc = atc.column_name
						LEFT JOIN (
							SELECT 
								UPPER(extschemadeftable.dbtablename) AS table_name_uc,
								UPPER(extschemadeffield.name) AS column_name_uc,
								'1.0.0' AS field_version
							FROM extschemadeftable
							INNER JOIN extschemadeffield 
								ON extschemadeffield.extschematable_id = extschemadeftable.id
						) cust_dict
							ON cust_dict.table_name_uc = atc.table_name
							AND cust_dict.column_name_uc = atc.column_name
					`,
					{ owner: owner.toUpperCase() },
					{
						fetchInfo: {
							CACHE_JSON: {
								type: oracledb.STRING
							}
						}
					}
				);

				const jsonText = result.rows?.[0]?.[0] as string;

				const rows = JSON.parse(jsonText);

				const newCache: any = {};

				for (const row of rows) {
					const tableName = row.table_name.toUpperCase();
					const fieldName = row.field_name.toUpperCase();

					if (!newCache[tableName]) {
						newCache[tableName] = {};
					}

					newCache[tableName][fieldName] = {
						field_version: row.field_version,
						field_data_type: row.field_data_type
					};
				}

				const cachePath = path.join(__dirname, '../cache/metadata.json');

				fs.mkdirSync(path.dirname(cachePath), { recursive: true });

				fs.writeFileSync(
					cachePath,
					JSON.stringify(newCache, null, 4),
					'utf8'
				);

				loadCache();

				vscode.window.showInformationMessage('OracleCacheUp cache refreshed.');
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

	const testConnectionCommand = vscode.commands.registerCommand(
		'oracle-cache-up.testConnection',
		async () => {
			let connection: oracledb.Connection | undefined;
			try {

				const config = vscode.workspace.getConfiguration('oracleCacheUp');

				const user = config.get<string>('user');
				const connectString = config.get<string>('connectString');
				const owner = config.get<string>('owner') ?? 'PS';
				const password = await context.secrets.get('oracleCacheUp.password');

				if (!user || !connectString || !password) {
					vscode.window.showErrorMessage(
						'OracleCacheUp connection is not configured. Set user/connectString in settings and run OracleCacheUp: Set Password.'
					);
					return;
				}

				connection = await oracledb.getConnection({
					user,
					password,
					connectString
				});

				const result = await connection.execute(
					'select sysdate from dual'
				);

				await connection.close();

				vscode.window.showInformationMessage(
					JSON.stringify(result.rows)
				);
			}
			catch (err: any) {
				vscode.window.showErrorMessage(
					err.message
				);
			}
		}
	);

	const hoverProvider = vscode.languages.registerHoverProvider(
		['sql', 'plsql', 'oracle-sql', 'oracle-plsql'],
		{
			provideHover(document, position) {
				const wordRange = document.getWordRangeAtPosition(
					position,
					/[a-zA-Z0-9_$#]+/
				);

				if (!wordRange) {
					return;
				}

				const word = document.getText(wordRange);
				const upperWord = word.toUpperCase();

				const lineText = document.lineAt(position.line).text;
				const beforeWord = lineText.substring(0, wordRange.start.character);
				const afterWord = lineText.substring(wordRange.end.character);

				const hasDotAfter = afterWord.trimStart().startsWith('.');
				const hasDotBefore = beforeWord.trimEnd().endsWith('.');

				if (hasDotAfter) {
					const statementSql = getCurrentStatement(document, position);
					const aliases = getAliases(statementSql);
					const resolvedTableName = aliases[upperWord] ?? upperWord;

					return showTableHover(resolvedTableName, cache);
				}

				if (hasDotBefore) {
					const qualifierMatch = beforeWord.match(/([a-zA-Z0-9_$#]+)\s*\.\s*$/);
					const qualifier = qualifierMatch?.[1]?.toUpperCase();

					if (qualifier) {
						const statementSql = getCurrentStatement(document, position);
						const aliases = getAliases(statementSql);
						const resolvedTableName = aliases[qualifier] ?? qualifier;

						return showFieldHover(resolvedTableName, upperWord, cache);
					}
				}

				const statementSql = getCurrentStatement(document, position);
				const aliases = getAliases(statementSql);
				const resolvedWord = aliases[upperWord] ?? upperWord;

				if (cache[resolvedWord]) {
					return showTableHover(resolvedWord, cache);
				}

				return showGlobalFieldHover(upperWord, cache);
			}
		}
	);

	const setPasswordCommand = vscode.commands.registerCommand(
		'oracle-cache-up.setPassword',
		async () => {
			const password = await vscode.window.showInputBox({
				prompt: 'Enter Oracle password',
				password: true,
				ignoreFocusOut: true
			});

			if (!password) {
				return;
			}

			await context.secrets.store('oracleCacheUp.password', password);

			vscode.window.showInformationMessage('OracleCacheUp password saved.');
		}
	);

	context.subscriptions.push(hoverProvider);
	context.subscriptions.push(testConnectionCommand);
	context.subscriptions.push(refreshCacheCommand);
	context.subscriptions.push(setPasswordCommand);
}

function showTableHover(tableName: string, cache: any): vscode.Hover | undefined {
	const table = cache[tableName];

	if (!table) {
		return new vscode.Hover(`Table/Object: ${tableName}\n\nNo cached metadata found.`);
	}

	const md = new vscode.MarkdownString();
	md.appendMarkdown(`### ${tableName}\n\n`);
	md.appendMarkdown(`| Field | Type | Version |\n`);
	md.appendMarkdown(`|---|---|---|\n`);

	for (const [fieldName, fieldInfo] of Object.entries(table)) {
		const info = fieldInfo as any;

		md.appendMarkdown(
			`| ${fieldName} | ${info.field_data_type ?? ''} | ${info.field_version ?? ''} |\n`
		);
	}

	return new vscode.Hover(md);
}

function showFieldHover(tableName: string, fieldName: string, cache: any): vscode.Hover | undefined {
	const fieldInfo = cache?.[tableName]?.[fieldName];

	if (!fieldInfo) {
		return new vscode.Hover(
			`Field: ${tableName}.${fieldName}\n\nNo cached metadata found.`
		);
	}

	const md = new vscode.MarkdownString();
	md.appendMarkdown(`### ${tableName}.${fieldName}\n\n`);
	md.appendMarkdown(`**Type:** ${fieldInfo.field_data_type ?? ''}  \n`);
	md.appendMarkdown(`**Version:** ${fieldInfo.field_version ?? ''}`);

	return new vscode.Hover(md);
}

function showGlobalFieldHover(fieldName: string, cache: any): vscode.Hover | undefined {
	const matches: string[] = [];

	for (const [tableName, fields] of Object.entries(cache)) {
		const tableFields = fields as any;

		if (tableFields[fieldName]) {
			const fieldInfo = tableFields[fieldName];

			matches.push(
				`| ${tableName}.${fieldName} | ${fieldInfo.field_data_type ?? ''} | ${fieldInfo.field_version ?? ''} |`
			);
		}
	}

	if (matches.length === 0) {
		return undefined;
	}

	const md = new vscode.MarkdownString();
	md.appendMarkdown(`### ${fieldName}\n\n`);
	md.appendMarkdown(`| Field | Type | Version |\n`);
	md.appendMarkdown(`|---|---|---|\n`);
	md.appendMarkdown(matches.join('\n'));

	return new vscode.Hover(md);
}

function getCurrentStatement(document: vscode.TextDocument, position: vscode.Position): string {
	const fullText = document.getText();
	const offset = document.offsetAt(position);

	const start = fullText.lastIndexOf(';', offset - 1) + 1;

	let end = fullText.indexOf(';', offset);

	if (end === -1) {
		end = fullText.length;
	}

	return fullText.substring(start, end);
}

function getAliases(statementSql: string): Record<string, string> {
	const aliases: Record<string, string> = {};

	const regex = /\b(?:from|join)\s+(?:[a-zA-Z0-9_$#]+\.)?([a-zA-Z0-9_$#]+)(?:\s+(?:as\s+)?([a-zA-Z0-9_$#]+))?/gi;

	const ignoredAliases = new Set([
		'ON', 'WHERE', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER',
		'JOIN', 'ORDER', 'GROUP', 'HAVING', 'UNION'
	]);

	let match: RegExpExecArray | null;

	while ((match = regex.exec(statementSql)) !== null) {
		const tableName = match[1]?.toUpperCase();
		const alias = match[2]?.toUpperCase();

		if (tableName) {
			aliases[tableName] = tableName;
		}

		if (tableName && alias && !ignoredAliases.has(alias)) {
			aliases[alias] = tableName;
		}
	}

	return aliases;
}

// This method is called when your extension is deactivated
export function deactivate() {}
