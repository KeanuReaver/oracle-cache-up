import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as oracledb from 'oracledb';

interface OracleConnection {
	name: string;
	user: string;
	host: string;
	port: number;
	serviceName: string;
	sid: string;
	owner?: string;
	database: string;
	connectionType: 'serviceName' | 'sid';
	metadataMode: 'generic' | 'powerschool';
}

let cache: any = {};
let hoverPaused = false;

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

export function activate(context: vscode.ExtensionContext) {
	loadCache();

	const addConnection = vscode.commands.registerCommand(
		'oracle-cache-up.addConnection',
		async () => {

			const name = await vscode.window.showInputBox({
				prompt: 'Connection name'
			});

			if (!name) { return; }

			const user = await vscode.window.showInputBox({
				prompt: 'Oracle username'
			});

			if (!user) { return; }

			const host = await vscode.window.showInputBox({
				prompt: 'Host name or IP'
			});

			if (!host) { return; }

			const portText = await vscode.window.showInputBox({
				prompt: 'Port',
				value: '1521'
			});

			if (!portText) { return; }

			const serviceName = await vscode.window.showInputBox({
				prompt: 'Service name'
			});

			if (!serviceName) { return; }

			const owner = await vscode.window.showInputBox({
				prompt: 'Schema owner to cache',
				value: 'PS'
			});

			if (!owner) { return; }

			const config = vscode.workspace.getConfiguration('oracleCacheUp');

			const connections =
				config.get<any[]>('connections') ?? [];

			connections.push({
				name,
				user,
				host,
				port: Number(portText),
				serviceName,
				owner
			});

			await config.update(
				'connections',
				connections,
				vscode.ConfigurationTarget.Global
			);

			await config.update(
				'activeConnection',
				name,
				vscode.ConfigurationTarget.Global
			);

			vscode.window.showInformationMessage(
				`Connection "${name}" added.`
			);
		}
	);

	const refreshCacheCommand = vscode.commands.registerCommand(
		'oracle-cache-up.refreshCache',
		async () => {
			let connection: oracledb.Connection | undefined;
			

			try {
				const activeConnection = getActiveConnection();

				if (!activeConnection) {
					vscode.window.showErrorMessage(
						'No active OracleCacheUp connection configured.'
					);
					return;
				}

				const user = activeConnection.user;
				const owner = activeConnection.owner;
				const connectString = buildConnectString(activeConnection);
				const password = await context.secrets.get(`oracleCacheUp.password.${activeConnection.name}`);

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

				const config = vscode.workspace.getConfiguration('oracleCacheUp');
				const metadataMode = config.get<string>('metadataMode') ?? 'generic';

				const metadataQuery = activeConnection.metadataMode === 'powerschool'
						? getPowerSchoolMetadataQuery()
						: getGenericOracleMetadataQuery();

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

				const rows = JSON.parse(jsonText);

				const newCache: any = {};

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
				const activeConnection = getActiveConnection();

				if (!activeConnection) {
					vscode.window.showErrorMessage(
						'No active OracleCacheUp connection configured.'
					);
					return;
				}

				const user = activeConnection.user;
				const owner = activeConnection.owner;
				const connectString = buildConnectString(activeConnection);
				const password = await context.secrets.get(`oracleCacheUp.password.${activeConnection.name}`);

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
				if (hoverPaused) {
					return;
				}

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

	const manageConnectionsCommand = vscode.commands.registerCommand(
		'oracle-cache-up.manageConnections',
		async () => {
			const panel = vscode.window.createWebviewPanel(
				'oracleCacheUpConnections',
				'OracleCacheUp Connections',
				vscode.ViewColumn.One,
				{
					enableScripts: true
				}
			);

			const config = vscode.workspace.getConfiguration('oracleCacheUp');
			const connections = config.get<OracleConnection[]>('connections') ?? [];
			const activeConnectionName = config.get<string>('activeConnection') ?? '';
			const passwordStatuses: Record<string, boolean> = {};

			for (const conn of connections) {
				passwordStatuses[conn.name] = !!await context.secrets.get(`oracleCacheUp.password.${conn.name}`);
			}

			panel.webview.html = getConnectionManagerHtml(connections, activeConnectionName, passwordStatuses);

			panel.webview.onDidReceiveMessage(async message => {
				if (message.command === 'makeActive') {
					const connection = message.connection as OracleConnection;

					if (!connection?.name) {
						vscode.window.showErrorMessage('Choose a connection before connecting.');
						return;
					}

					const config = vscode.workspace.getConfiguration('oracleCacheUp');

					await config.update(
						'activeConnection',
						connection.name,
						vscode.ConfigurationTarget.Global
					);

					const connections = config.get<OracleConnection[]>('connections') ?? [];

					panel.webview.html = getConnectionManagerHtml(
						connections,
						connection.name,
						await getPasswordStatuses(context, connections)
					);

					vscode.window.showInformationMessage(`Active connection set to "${connection.name}".`);
				}
				if (message.command === 'setPassword') {
					const connectionName = message.connectionName as string;

					if (!connectionName) {
						vscode.window.showErrorMessage('Enter a connection name before setting a password.');
						return;
					}

					const password = await vscode.window.showInputBox({
						prompt: `Enter password for ${connectionName}`,
						password: true,
						ignoreFocusOut: true
					});

					if (!password) {
						return;
					}

					await context.secrets.store(
						`oracleCacheUp.password.${connectionName}`,
						password
					);

					const config = vscode.workspace.getConfiguration('oracleCacheUp');
					const connections = config.get<OracleConnection[]>('connections') ?? [];
					const activeConnectionName = config.get<string>('activeConnection') ?? '';

					panel.webview.html = getConnectionManagerHtml(
						connections,
						activeConnectionName,
						await getPasswordStatuses(context, connections)
					);

					vscode.window.showInformationMessage(`Password saved for "${connectionName}".`);
				}

				if (message.command === 'testConnection') {
					const testConnection = message.connection as OracleConnection;

					if (!testConnection?.name) {
						vscode.window.showErrorMessage('Enter a connection name before testing.');
						return;
					}

					const password = await context.secrets.get(
						`oracleCacheUp.password.${testConnection.name}`
					);

					if (!password) {
						vscode.window.showErrorMessage(`No password saved for "${testConnection.name}".`);
						return;
					}

					let connection: oracledb.Connection | undefined;

					try {
						connection = await oracledb.getConnection({
							user: testConnection.user,
							password,
							connectString: buildConnectString(testConnection)
						});

						const result = await connection.execute('select sysdate from dual');

						vscode.window.showInformationMessage(
							`Connection successful: ${JSON.stringify(result.rows)}`
						);
					}
					catch (err: any) {
						vscode.window.showErrorMessage(`Connection failed: ${err.message}`);
					}
					finally {
						if (connection) {
							await connection.close();
						}
					}
				}

				if (message.command === 'deleteConnection') {
					const connectionName = message.connectionName as string;

					if (!connectionName) {
						vscode.window.showErrorMessage('No connection selected.');
						return;
					}

					const confirm = await vscode.window.showWarningMessage(
						`Delete connection "${connectionName}"?`,
						{ modal: true },
						'Delete'
					);

					if (confirm !== 'Delete') {
						return;
					}

					const config = vscode.workspace.getConfiguration('oracleCacheUp');
					const connections = config.get<OracleConnection[]>('connections') ?? [];

					const updatedConnections = connections.filter(
						c => c.name !== connectionName
					);

					await config.update(
						'connections',
						updatedConnections,
						vscode.ConfigurationTarget.Global
					);

					await context.secrets.delete(
						`oracleCacheUp.password.${connectionName}`
					);

					const activeConnectionName = config.get<string>('activeConnection') ?? '';

					const newActiveConnectionName =
						activeConnectionName === connectionName
							? updatedConnections[0]?.name ?? ''
							: activeConnectionName;

					await config.update(
						'activeConnection',
						newActiveConnectionName,
						vscode.ConfigurationTarget.Global
					);

					panel.webview.html = getConnectionManagerHtml(
						updatedConnections,
						newActiveConnectionName,
						await getPasswordStatuses(context, updatedConnections)
					);

					vscode.window.showInformationMessage(`Connection "${connectionName}" deleted.`);
				}

				if (message.command === 'saveConnection') {
					const config = vscode.workspace.getConfiguration('oracleCacheUp');
					const connections = config.get<OracleConnection[]>('connections') ?? [];

					const savedConnection = message.connection as OracleConnection;

					const existingIndex = connections.findIndex(
						c => c.name === savedConnection.name
					);

					if (existingIndex >= 0) {
						connections[existingIndex] = savedConnection;
					}
					else {
						connections.push(savedConnection);
					}

					await config.update(
						'connections',
						connections,
						vscode.ConfigurationTarget.Global
					);

					await config.update(
						'activeConnection',
						savedConnection.name,
						vscode.ConfigurationTarget.Global
					);

					panel.webview.html = getConnectionManagerHtml(
						connections,
						savedConnection.name,
						await getPasswordStatuses(context, connections)
					);

					vscode.window.showInformationMessage('Connection saved.');
				}
			});
		}
	);

	const pauseHoverCommand = vscode.commands.registerCommand(
		'oracle-cache-up.pauseHover',
		() => {
			hoverPaused = true;
			vscode.window.showInformationMessage('OracleCacheUp hovers paused.');
		}
	);

	const resumeHoverCommand = vscode.commands.registerCommand(
		'oracle-cache-up.resumeHover',
		() => {
			hoverPaused = false;
			vscode.window.showInformationMessage('OracleCacheUp hovers resumed.');
		}
	);

	const restartHoverCommand = vscode.commands.registerCommand(
		'oracle-cache-up.restartHover',
		() => {
			hoverPaused = false;
			loadCache();
			vscode.window.showInformationMessage('OracleCacheUp hovers restarted.');
		}
	);

	context.subscriptions.push(addConnection);
	context.subscriptions.push(hoverProvider);
	context.subscriptions.push(testConnectionCommand);
	context.subscriptions.push(refreshCacheCommand);
	context.subscriptions.push(manageConnectionsCommand);

	context.subscriptions.push(pauseHoverCommand);
	context.subscriptions.push(resumeHoverCommand);
	context.subscriptions.push(restartHoverCommand);
}

async function getPasswordStatuses(
    context: vscode.ExtensionContext,
    connections: OracleConnection[]
): Promise<Record<string, boolean>> {
    const statuses: Record<string, boolean> = {};

    for (const conn of connections) {
        statuses[conn.name] = !!await context.secrets.get(
            `oracleCacheUp.password.${conn.name}`
        );
    }

    return statuses;
}

function showTableHover(tableName: string, cache: any): vscode.Hover | undefined {
    const table = cache[tableName];

    if (!table) {
        return new vscode.Hover(`Table/Object: ${tableName}\n\nNo cached metadata found.`);
    }

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`### ${tableName}\n\n`);
    md.appendMarkdown(`| Field | Type |\n`);
    md.appendMarkdown(`|---|---|\n`);

    for (const [fieldName, fieldInfo] of Object.entries(table)) {
        const info = fieldInfo as any;
        md.appendMarkdown(`| ${fieldName} | ${info.field_data_type ?? ''} |\n`);
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
    md.appendMarkdown(`**Type:** ${fieldInfo.field_data_type ?? ''}`);

    return new vscode.Hover(md);
}

function showGlobalFieldHover(fieldName: string, cache: any): vscode.Hover | undefined {
	const matches: string[] = [];

	for (const [tableName, fields] of Object.entries(cache)) {
		const tableFields = fields as any;

		if (tableFields[fieldName]) {
			const fieldInfo = tableFields[fieldName];

			matches.push(
				`| ${tableName}.${fieldName} | ${fieldInfo.field_data_type ?? ''} |`
			);
		}
	}

	if (matches.length === 0) {
		return undefined;
	}

	const md = new vscode.MarkdownString();
	md.appendMarkdown(`### ${fieldName}\n\n`);
	md.appendMarkdown(`| Field | Type |\n`);
	md.appendMarkdown(`|---|---|\n`);
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

function buildConnectString(connection: OracleConnection): string {
    if (connection.connectionType === 'sid') {
        return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${connection.host})(PORT=${connection.port}))(CONNECT_DATA=(SID=${connection.sid})))`;
    }

    return `${connection.host}:${connection.port}/${connection.serviceName}`;
}

function getActiveConnection(): OracleConnection | undefined {
	const config = vscode.workspace.getConfiguration('oracleCacheUp');

	const activeConnectionName =
		config.get<string>('activeConnection');

	const connections =
		config.get<OracleConnection[]>('connections') ?? [];

	return connections.find(
		c => c.name === activeConnectionName
	);
}

function getGenericOracleMetadataQuery(): string {
    return `
        SELECT
            JSON_ARRAYAGG(
                JSON_OBJECT(
                    'table_name' VALUE atc.table_name,
                    'field_name' VALUE atc.column_name,
                    'field_data_type' VALUE
                        CASE
                            WHEN atc.data_type IN ('VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR')
                                THEN atc.data_type || '(' || atc.char_length || ')'
                            WHEN atc.data_type = 'NUMBER' AND atc.data_precision IS NOT NULL AND atc.data_scale IS NOT NULL
                                THEN atc.data_type || '(' || atc.data_precision || ',' || atc.data_scale || ')'
                            WHEN atc.data_type = 'NUMBER' AND atc.data_precision IS NOT NULL
                                THEN atc.data_type || '(' || atc.data_precision || ')'
                            ELSE atc.data_type
                        END
                    RETURNING CLOB
                )
                ORDER BY atc.table_name, atc.column_id
                RETURNING CLOB
            ) AS CACHE_JSON
        FROM all_tab_columns atc
        LEFT JOIN all_objects ao
            ON ao.owner = atc.owner
            AND ao.object_name = atc.table_name
            AND ao.object_type IN ('TABLE', 'VIEW')
        LEFT JOIN all_col_comments acc
            ON acc.owner = atc.owner
            AND acc.table_name = atc.table_name
            AND acc.column_name = atc.column_name
        WHERE (:owner IS NULL OR atc.owner = :owner)
    `;
}

function getPowerSchoolMetadataQuery(): string {
    return `
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
				WHERE (:owner IS NULL OR owner = :owner)
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
		`;
}

function getConnectionManagerHtml(
    connections: OracleConnection[],
    activeConnectionName: string,
    passwordStatuses: Record<string, boolean> = {}
): string {
	const connectionJson = JSON.stringify(connections);
	const activeJson = JSON.stringify(activeConnectionName);
	const passwordStatusJson = JSON.stringify(passwordStatuses);

	return `
<!DOCTYPE html>
<html>
<head>
	<style>
		body {
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			padding: 16px;
		}

		.hidden {
			display: none;
		}

		.placeholder {
			color: var(--vscode-descriptionForeground);
			padding: 16px;
			border: 1px dashed var(--vscode-panel-border);
			border-radius: 4px;
		}

		.layout {
			display: grid;
			grid-template-columns: 260px 1fr;
			gap: 16px;
		}

		#connection-form-tile {
			width: 800px;
		}

		.connection-list {
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			overflow: hidden;
		}

		.connection-item {
			padding: 10px;
			cursor: pointer;
			border-bottom: 1px solid var(--vscode-panel-border);
		}

		.connection-item:hover {
			background: var(--vscode-list-hoverBackground);
		}

		.connection-item.active {
			background: var(--vscode-list-activeSelectionBackground);
			color: var(--vscode-list-activeSelectionForeground);
		}

		label {
			display: block;
			margin-top: 10px;
			margin-bottom: 4px;
		}

		.two-column-row {
			display: grid;
			grid-template-columns: 180px 1fr;
			gap: 12px;
		}

		input, select {
			width: 100%;
			box-sizing: border-box;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			padding: 6px;
			border-radius: 2px;
		}

		.password-row {
			display: flex;
			align-items: center;
			gap: 10px;
		}

		.button-row {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-top: 14px;
		}

		.button-group {
			display: flex;
			gap: 6px;
		}

		button.danger {
			background: var(--vscode-errorForeground);
			color: var(--vscode-button-foreground);
		}

		button.danger:hover {
			opacity: 0.85;
		}

		button {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			padding: 6px 10px;
			margin-right: 6px;
			margin-top: 14px;
			cursor: pointer;
			border-radius: 2px;
		}

		button#passwordBtn {
			margin-top: 1px;
		}

		button:hover {
			background: var(--vscode-button-hoverBackground);
		}

		button.secondary {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}

		.small {
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
		}
	</style>
</head>
<body>
	<h2>OracleCacheUp Connections</h2>

	<div class="layout">
		<div>
			<h3>Saved Connections</h3>
			<div id="connectionList" class="connection-list"></div>
			<button id="newBtn">New Connection</button>
		</div>

		<div id="connection-form-tile" class="hidden">
			<h3 id="formTitle">New Connection</h3>
			<label>Name</label>
			<input id="name">

			<label>Metadata Mode</label>
			<select id="metadataMode">
				<option value="generic">Generic Oracle</option>
				<option value="powerschool">PowerSchool</option>
			</select>
			<div class="two-column-row">
				<div>
					<label>User</label>
					<input id="user">
				</div>
				<div>
					<label>Password (Passwords are stored separately in VS Code SecretStorage.)</label>
					<div class="password-row">
						<button id="passwordBtn" class="secondary">Set Password</button>
						<span id="passwordStatus">Not saved</span>	
					</div>
				</div>
			</div>

			<div class="two-column-row">
				<div>
					<label>Host</label>
					<input id="host">
				</div>
				<div>
					<label>Port</label>
					<input id="port" value="1521">
				</div>
			</div>

			<div class="two-column-row">
				<div>
					<label>Type</label>
					<select id="connectionType">
						<option value="serviceName">Service Name</option>
						<option value="sid">SID</option>
					</select>
				</div>

				<div>
					<label id="databaseLabel">Service Name</label>
					<input id="databaseValue">
				</div>
			</div>

			<label>Schema Owner <span class="small">(optional)</span></label>
			<input id="owner" value="PS">

			<div class="button-row">
				<div class="button-group">
					<button id="cancelBtn" class="secondary">Cancel</button>
					<button id="testBtn" class="secondary">Test</button>
				</div>

				<div class="button-group">
					<button id="deleteBtn" class="danger">Delete</button>
					<button id="connectBtn" class="secondary">Connect</button>
					<button id="saveBtn">Save</button>
				</div>
			</div>	
		</div>

		<div id="form-placeholder" class="placeholder">
			Select an existing connection or click New Connection.
		</div>
	</div>

	<script>
		const vscode = acquireVsCodeApi();

		let connections = ${connectionJson};
		let activeConnectionName = ${activeJson};
		let selectedName = "";
		let passwordStatuses = ${passwordStatusJson};

		function showForm() {
			document.getElementById('connection-form-tile').classList.remove('hidden');
			document.getElementById('form-placeholder').classList.add('hidden');
		}

		function hideForm() {
			document.getElementById('connection-form-tile').classList.add('hidden');
			document.getElementById('form-placeholder').classList.remove('hidden');
		}

		function renderList() {
			const list = document.getElementById('connectionList');
			list.innerHTML = '';

			connections.forEach(conn => {
				const div = document.createElement('div');
				div.className = 'connection-item' + (conn.name === selectedName ? ' active' : '');
				div.textContent =
					conn.name +
					(conn.name === activeConnectionName ? ' ★' : '') +
					(passwordStatuses[conn.name] ? ' 🔑' : '');
				div.addEventListener('click', () => {
					selectedName = conn.name;
					fillForm(conn);
					showForm();
					renderList();
				});
				list.appendChild(div);
			});
		}

		function updateDatabaseLabel() {
			const type = document.getElementById('connectionType').value;
			const label = document.getElementById('databaseLabel');
			const input = document.getElementById('databaseValue');

			if (type === 'sid') {
				label.textContent = 'SID';
				input.value = input.dataset.sid || '';
			}
			else {
				label.textContent = 'Service Name';
				input.value = input.dataset.serviceName || '';
			}
		}

		function updateFormTitle(conn) {
			const title = document.getElementById('formTitle');

			if (conn && conn.name) {
				title.textContent = 'Update Connection: ' + conn.name;
			}
			else {
				title.textContent = 'New Connection';
			}
		}

		function fillForm(conn) {
			document.getElementById('name').value = conn?.name || '';
			document.getElementById('user').value = conn?.user || '';
			document.getElementById('host').value = conn?.host || '';
			document.getElementById('port').value = conn?.port || 1521;
			document.getElementById('owner').value = conn?.owner || '';
			document.getElementById('metadataMode').value = conn?.metadataMode || 'generic';

			const typeEl = document.getElementById('connectionType');
			const dbEl = document.getElementById('databaseValue');

			typeEl.value = conn?.connectionType || 'serviceName';
			dbEl.dataset.serviceName = conn?.serviceName || '';
			dbEl.dataset.sid = conn?.sid || '';

			updateDatabaseLabel();
			updateFormTitle(conn);

			const hasPassword = conn?.name && passwordStatuses[conn.name];

			document.getElementById('passwordStatus').textContent =
				hasPassword ? 'Saved 🔑' : 'Not saved';
		}

		function readForm() {
			const type = document.getElementById('connectionType').value;
			const dbEl = document.getElementById('databaseValue');

			if (type === 'sid') {
				dbEl.dataset.sid = dbEl.value.trim();
			}
			else {
				dbEl.dataset.serviceName = dbEl.value.trim();
			}

			return {
				name: document.getElementById('name').value.trim(),
				user: document.getElementById('user').value.trim(),
				host: document.getElementById('host').value.trim(),
				port: Number(document.getElementById('port').value),
				connectionType: type,
				serviceName: dbEl.dataset.serviceName || '',
				sid: dbEl.dataset.sid || '',
				owner: document.getElementById('owner').value.trim(),
				metadataMode: document.getElementById('metadataMode').value || 'generic'
			};
		}

		function validateForm() {
			const form = readForm();

			const errors = [];

			if (!form.name) {
				errors.push('Name');
			}

			if (!form.user) {
				errors.push('User');
			}

			if (!form.host) {
				errors.push('Host');
			}

			if (!form.port) {
				errors.push('Port');
			}

			if (!form.connectionType) {
				errors.push('Type');
			}

			if (
				form.connectionType === 'serviceName' &&
				!form.serviceName
			) {
				errors.push('Service Name');
			}

			if (
				form.connectionType === 'sid' &&
				!form.sid
			) {
				errors.push('SID');
			}

			if (errors.length > 0) {
				alert(
					'Please complete:\\n\\n' +
					errors.join('\\n')
				);

				return false;
			}

			return true;
		}

		document.getElementById('connectionType').addEventListener('change', () => {
			const dbEl = document.getElementById('databaseValue');
			const type = document.getElementById('connectionType').value;

			if (type === 'sid') {
				dbEl.dataset.serviceName = dbEl.dataset.serviceName || '';
			}
			else {
				dbEl.dataset.sid = dbEl.dataset.sid || '';
			}

			updateDatabaseLabel();
		});

		document.getElementById('cancelBtn').addEventListener('click', () => {
			selectedName = '';
			fillForm(null);
			hideForm();
			renderList();
		});

		document.getElementById('connectBtn').addEventListener('click', () => {
			if (!validateForm()) {
				return;
			}

			vscode.postMessage({
				command: 'makeActive',
				connection: readForm()
			});
		});

		document.getElementById('newBtn').addEventListener('click', () => {
			selectedName = '';
			fillForm(null);
			showForm();
			renderList();
		});

		document.getElementById('saveBtn').addEventListener('click', () => {
			if (!validateForm()) {
				return;
			}

			vscode.postMessage({
				command: 'saveConnection',
				connection: readForm()
			});
		});

		document.getElementById('testBtn').addEventListener('click', () => {
			if (!validateForm()) {
				return;
			}

			vscode.postMessage({
				command: 'testConnection',
				connection: readForm()
			});
		});

		document.getElementById('passwordBtn').addEventListener('click', () => {
			const name = document.getElementById('name').value.trim();

			if (!name) {
				alert('Connection name is required before setting a password.');
				return;
			}

			vscode.postMessage({
				command: 'setPassword',
				connectionName: name
			});
		});

		document.getElementById('deleteBtn').addEventListener('click', () => {
			vscode.postMessage({
				command: 'deleteConnection',
				connectionName: document.getElementById('name').value.trim()
			});
		});

		hideForm();

		renderList();
	</script>
</body>
</html>
`;
}

// This method is called when your extension is deactivated
export function deactivate() {}
