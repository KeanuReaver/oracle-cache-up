import * as vscode from 'vscode';

import {
	getConnections,
	getPasswordKey,
	getPasswordStatuses,
	saveConnections,
	setActiveConnection,
	testOracleConnection,
	validateConnection
} from './connections';
import { OracleConnection } from './types';

export function registerManageConnectionsCommand(context: vscode.ExtensionContext): void {
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

			await renderConnectionManager(panel, context);
			
			panel.webview.onDidReceiveMessage(async message => {
				if (message.command === 'makeActive') {
					const connection = message.connection as OracleConnection;

					if (!connection?.name) {
						vscode.window.showErrorMessage('Choose a connection before connecting.');
						return;
					}

					await setActiveConnection(connection.name);
					await renderConnectionManager(panel, context, connection.name);

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
						getPasswordKey(connectionName),
						password
					);

					await renderConnectionManager(panel, context, connectionName);

					vscode.window.showInformationMessage(`Password saved for "${connectionName}".`);
				}

				if (message.command === 'testConnection') {
					const testConnection = message.connection as OracleConnection;

					const errors = validateConnection(testConnection);

					if (errors.length > 0) {
						vscode.window.showErrorMessage(`Connection is missing: ${errors.join(', ')}`);
						return;
					}

					try {
						const resultRows = await testOracleConnection(
							context,
							testConnection
						);

						vscode.window.showInformationMessage(
							`Connection successful: ${JSON.stringify(resultRows)}`
						);
					}
					catch (err: any) {
						vscode.window.showErrorMessage(`Connection failed: ${err.message}`);
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

					const connections = getConnections();

					const updatedConnections = connections.filter(
						c => c.name !== connectionName
					);

					await saveConnections(updatedConnections);

					await context.secrets.delete(
						getPasswordKey(connectionName)
					);

					const config = vscode.workspace.getConfiguration('oracleCacheUp');
					const activeConnectionName = config.get<string>('activeConnection') ?? '';

					const newActiveConnectionName =
						activeConnectionName === connectionName
							? updatedConnections[0]?.name ?? ''
							: activeConnectionName;

					await setActiveConnection(newActiveConnectionName);

					await renderConnectionManager(panel, context, '');

					vscode.window.showInformationMessage(`Connection "${connectionName}" deleted.`);
				}

				if (message.command === 'saveConnection') {
					const savedConnection = message.connection as OracleConnection;

					const errors = validateConnection(savedConnection);

					if (errors.length > 0) {
						vscode.window.showErrorMessage(`Connection is missing: ${errors.join(', ')}`);
						return;
					}

					const connections = getConnections();

					const existingIndex = connections.findIndex(
						c => c.name === savedConnection.name
					);

					if (existingIndex >= 0) {
						connections[existingIndex] = savedConnection;
					}
					else {
						connections.push(savedConnection);
					}

					await saveConnections(connections);
					await setActiveConnection(savedConnection.name);

					await renderConnectionManager(panel, context, savedConnection.name);

					vscode.window.showInformationMessage('Connection saved.');
				}
			});
		}
	);

	context.subscriptions.push(manageConnectionsCommand);
}

async function renderConnectionManager(
	panel: vscode.WebviewPanel,
	context: vscode.ExtensionContext,
	selectedConnectionName = ''
): Promise<void> {
	const config = vscode.workspace.getConfiguration('oracleCacheUp');
	const connections = getConnections();
	const activeConnectionName = config.get<string>('activeConnection') ?? '';
	const passwordStatuses = await getPasswordStatuses(context, connections);

	panel.webview.html = getConnectionManagerHtml(
		connections,
		activeConnectionName,
		passwordStatuses,
		selectedConnectionName
	);
}

function getConnectionManagerHtml(
	connections: OracleConnection[],
	activeConnectionName: string,
	passwordStatuses: Record<string, boolean> = {},
	selectedConnectionName = ''
): string {
	const connectionJson = JSON.stringify(connections);
	const activeJson = JSON.stringify(activeConnectionName);
	const passwordStatusJson = JSON.stringify(passwordStatuses);
	const selectedJson = JSON.stringify(selectedConnectionName);

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

		button:hover {
			background: var(--vscode-button-hoverBackground);
		}

		button.secondary {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}

		button.danger {
			background: var(--vscode-errorForeground);
			color: var(--vscode-button-foreground);
		}

		button.danger:hover {
			opacity: 0.85;
		}

		button#passwordBtn {
			margin-top: 1px;
		}

		.small {
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
		}

		.form-error {
			background: var(--vscode-inputValidation-errorBackground);
			border: 1px solid var(--vscode-inputValidation-errorBorder);
			color: var(--vscode-inputValidation-errorForeground);
			padding: 8px;
			margin-bottom: 10px;
			border-radius: 3px;
		}

		.field-error {
			border: 1px solid var(--vscode-inputValidation-errorBorder) !important;
		}

		.validation-message {
			color: var(--vscode-errorForeground);
			font-size: 11px;
			margin-top: 0;
			padding-top: 2px;
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
			<div id="formError" class="form-error hidden"></div>

			<label>Name</label>
			<input id="name">
			<div id="name-error" class="validation-message hidden"></div>

			<div class="two-column-row">
				<div>
					<label>User</label>
					<input id="user">
					<div id="user-error" class="validation-message hidden"></div>
				</div>
				<div>
					<label>Password <span class="small">(stored separately in VS Code SecretStorage)</span></label>
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
					<div id="host-error" class="validation-message hidden"></div>
				</div>
				<div>
					<label>Port</label>
					<input id="port" value="1521">
					<div id="port-error" class="validation-message hidden"></div>
				</div>
			</div>

			<div class="two-column-row">
				<div>
					<label>Type</label>
					<select id="connectionType">
						<option value="serviceName">Service Name</option>
						<option value="sid">SID</option>
					</select>
					<div id="connectionType-error" class="validation-message hidden"></div>
				</div>

				<div>
					<label id="databaseLabel">Service Name</label>
					<input id="databaseValue">
					<div id="databaseValue-error" class="validation-message hidden"></div>
				</div>
			</div>

			<label>Schema Owner <span class="small">(optional)</span></label>
			<input id="owner">

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
		let selectedName = ${selectedJson};
		let passwordStatuses = ${passwordStatusJson};

		function clearValidation() {
			document
				.querySelectorAll('.field-error')
				.forEach(el => el.classList.remove('field-error'));

			document
				.querySelectorAll('.validation-message')
				.forEach(el => {
					el.textContent = '';
					el.classList.add('hidden');
				});
		}

		function showFieldError(fieldId, message) {
			const field = document.getElementById(fieldId);
			const error = document.getElementById(fieldId + '-error');

			field.classList.add('field-error');

			error.textContent = message;
			error.classList.remove('hidden');
		}

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
				owner: document.getElementById('owner').value.trim()
			};
		}

		function validateForm() {
			const form = readForm();

			const errors = [];

			if (!form.name) {
				showFieldError(
					'name',
					'Required field cannot be empty.'
				);
				valid = false;
			}

			if (!form.user) {
				showFieldError(
					'user',
					'Required field cannot be empty.'
				);
				valid = false;
			}

			if (!form.host) {
				showFieldError(
					'host',
					'Required field cannot be empty.'
				);
				valid = false;
			}

			if (!form.port) {
				showFieldError(
					'port',
					'Required field cannot be empty.'
				);
				valid = false;
			}

			if (!form.connectionType) {
				showFieldError(
					'connectionType',
					'Required field cannot be empty.'
				);
				valid = false;
			}

			if (form.connectionType === 'serviceName' && !form.serviceName) {
				showFieldError(
					'serviceName',
					'Required field cannot be empty.'
				);
				valid = false;
			}

			if (form.connectionType === 'sid' && !form.sid) {
				showFieldError(
					'sid',
					'Required field cannot be empty.'
				);
				valid = false;
			}

			// if (errors.length > 0) {
			// 	const errorBox = document.getElementById('formError');

			// 	errorBox.innerHTML =
			// 		'<strong>Please complete:</strong><br>' +
			// 		errors.map(error => '- ' + error).join('<br>');

			// 	errorBox.classList.remove('hidden');

			// 	return false;
			// }

			// document.getElementById('formError').classList.add('hidden');
			return true;
		}
		
		document
			.querySelectorAll('input, select')
			.forEach(el => {
				el.addEventListener('input', () => {
					el.classList.remove('field-error');

					const error =
						document.getElementById(el.id + '-error');

					if (error) {
						error.textContent = '';
						error.classList.add('hidden');
					}
				});
			});

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

		const initial = connections.find(c => c.name === selectedName);

		if (initial) {
			fillForm(initial);
			showForm();
		}
		else {
			hideForm();
		}

		renderList();
	</script>
</body>
</html>
`;
}
