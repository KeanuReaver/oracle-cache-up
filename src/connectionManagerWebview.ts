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
import { testCustomMetadataQuery } from './cacheRefresh';
import { OracleConnection } from './types';

const SAVED_PASSWORD_PLACEHOLDER = '********';

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
				if (message.command === 'testCustomMetadataQuery') {
					const connectionInfo = message.connection as OracleConnection;

					try {
						const password = cleanPassword(message.password);

						if (password) {
							await context.secrets.store(
								getPasswordKey(connectionInfo.name),
								password
							);
						}

						await testCustomMetadataQuery(context, connectionInfo);

						vscode.window.showInformationMessage(
							'Custom metadata query returned the required fields.'
						);
					}
					catch (err: any) {
						vscode.window.showErrorMessage(
							`Custom metadata query failed: ${err.message}`
						);
					}
					finally {
						panel.webview.postMessage({
							command: 'testCustomMetadataQueryFinished'
						});
					}
				}

				if (message.command === 'makeActive') {
					const connection = message.connection as OracleConnection;

					if (!connection?.name) {
						vscode.window.showErrorMessage('Choose a connection before connecting.');
						return;
					}

					const errors = validateConnection(connection);

					if (errors.length > 0) {
						vscode.window.showErrorMessage(`Connection is missing: ${errors.join(', ')}`);
						return;
					}

					await upsertConnection(connection);

					const password = cleanPassword(message.password);

					if (password) {
						await context.secrets.store(
							getPasswordKey(connection.name),
							password
						);
					}

					await setActiveConnection(connection.name);
					await renderConnectionManager(panel, context, connection.name);

					vscode.window.showInformationMessage(`Active connection set to "${connection.name}".`);
				}

				if (message.command === 'testConnection') {
					const testConnection = message.connection as OracleConnection;

					const errors = validateConnection(testConnection);

					if (errors.length > 0) {
						vscode.window.showErrorMessage(`Connection is missing: ${errors.join(', ')}`);
						return;
					}

					try {
						const password = cleanPassword(message.password);

						if (password) {
							await context.secrets.store(
								getPasswordKey(testConnection.name),
								password
							);
						}

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
					finally {
						panel.webview.postMessage({
							command: 'testConnectionFinished'
						});
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

					await upsertConnection(savedConnection);

					const password = cleanPassword(message.password);

					if (password) {
						await context.secrets.store(
							getPasswordKey(savedConnection.name),
							password
						);
					}

					await setActiveConnection(savedConnection.name);
					await renderConnectionManager(panel, context, savedConnection.name);

					vscode.window.showInformationMessage('Connection saved.');
				}
			});
		}
	);

	context.subscriptions.push(manageConnectionsCommand);
}

function cleanPassword(password: unknown): string {
	if (typeof password !== 'string') {
		return '';
	}

	const trimmedPassword = password.trim();

	if (!trimmedPassword || trimmedPassword === SAVED_PASSWORD_PLACEHOLDER) {
		return '';
	}

	return password;
}

async function upsertConnection(connection: OracleConnection): Promise<void> {
	const connections = getConnections();

	const existingIndex = connections.findIndex(
		c => c.name === connection.name
	);

	if (existingIndex >= 0) {
		connections[existingIndex] = connection;
	}
	else {
		connections.push(connection);
	}

	await saveConnections(connections);
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
	const passwordPlaceholderJson = JSON.stringify(SAVED_PASSWORD_PLACEHOLDER);

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
			box-sizing: border-box;
		}

		* {
			box-sizing: border-box;
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
			grid-template-columns: minmax(220px, 260px) minmax(0, 760px);
			gap: 16px;
			align-items: start;
			max-width: 1040px;
		}

		#connection-form-tile {
			width: 100%;
			max-width: 760px;
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
			grid-template-columns: minmax(140px, 180px) minmax(0, 1fr);
			gap: 12px;
		}

		input,
		select,
		textarea {
			width: 100%;
			min-width: 0;
			box-sizing: border-box;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			padding: 6px;
			border-radius: 2px;
		}

		textarea {
			min-height: 180px;
			font-family: var(--vscode-editor-font-family);
		}

		.button-row {
			display: flex;
			justify-content: space-between;
			align-items: flex-start;
			gap: 12px;
			margin-top: 14px;
			flex-wrap: wrap;
		}

		.button-group {
			display: flex;
			gap: 6px;
			flex-wrap: wrap;
			align-items: center;
		}

		button {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			padding: 6px 10px;
			margin-right: 0;
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

		button:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}

		.small {
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
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

		.inline-status {
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			margin-left: 4px;
		}

		.inline-status::before {
			content: '';
			display: inline-block;
			width: 10px;
			height: 10px;
			margin-right: 6px;
			border: 2px solid var(--vscode-descriptionForeground);
			border-top-color: transparent;
			border-radius: 50%;
			animation: spin 0.8s linear infinite;
			vertical-align: -2px;
		}

		@media (max-width: 850px) {
			.layout {
				grid-template-columns: 1fr;
				max-width: 760px;
			}

			#connection-form-tile {
				max-width: 100%;
			}
		}

		@media (max-width: 560px) {
			body {
				padding: 10px;
			}

			.two-column-row {
				grid-template-columns: 1fr;
				gap: 0;
			}

			.button-row {
				flex-direction: column;
				align-items: stretch;
			}

			.button-group {
				width: 100%;
			}

			.button-group button {
				flex: 1;
			}
		}

		@keyframes spin {
			to {
				transform: rotate(360deg);
			}
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
			<div id="name-error" class="validation-message hidden"></div>

			<div class="two-column-row">
				<div>
					<label>User</label>
					<input id="user">
					<div id="user-error" class="validation-message hidden"></div>
				</div>
				<div>
					<label>Password <span class="small">(stored in VS Code SecretStorage)</span></label>
					<input id="password" type="password" autocomplete="off">
					<div id="password-error" class="validation-message hidden"></div>
					<span id="passwordStatus" class="small">No password saved.</span>
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

			<label>Metadata Source</label>
			<select id="metadataSource">
				<option value="generic">Generic Oracle</option>
				<option value="powerschool">PowerSchool</option>
				<option value="custom">Custom SQL</option>
			</select>
			<div id="metadataSource-error" class="validation-message hidden"></div>

			<div id="customQueryBlock" class="hidden">
				<label>Custom Metadata Query</label>
				<textarea id="customMetadataQuery"></textarea>
				<div id="customMetadataQuery-error" class="validation-message hidden"></div>
				<p class="small">
					Must return table_name, field_name, field_data_type. Optional: table_desc, column_desc.
				</p>
				<button id="testCustomQueryBtn" class="secondary">Test Query</button>
				<span id="testCustomQueryStatus" class="inline-status hidden">Testing...</span>
			</div>

			<div class="button-row">
				<div class="button-group">
					<button id="cancelBtn" class="secondary">Cancel</button>
					<button id="testBtn" class="secondary">Test</button>
					<span id="testStatus" class="inline-status hidden">Testing...</span>
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
		const SAVED_PASSWORD_PLACEHOLDER = ${passwordPlaceholderJson};

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

			if (field) {
				field.classList.add('field-error');
			}

			if (error) {
				error.textContent = message;
				error.classList.remove('hidden');
			}
		}

		function showForm() {
			document.getElementById('connection-form-tile').classList.remove('hidden');
			document.getElementById('form-placeholder').classList.add('hidden');
		}

		function hideForm() {
			document.getElementById('connection-form-tile').classList.add('hidden');
			document.getElementById('form-placeholder').classList.remove('hidden');
		}

		function isExistingConnectionName(name) {
			return connections.some(c => c.name === name);
		}

		function hasSavedPassword(name) {
			return Boolean(name && passwordStatuses[name]);
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

		function updateMetadataSourceDisplay() {
			const source = document.getElementById('metadataSource').value;
			const block = document.getElementById('customQueryBlock');

			if (source === 'custom') {
				block.classList.remove('hidden');
			}
			else {
				block.classList.add('hidden');
			}
		}

		function fillForm(conn) {
			clearValidation();

			document.getElementById('name').value = conn?.name || '';
			document.getElementById('user').value = conn?.user || '';
			document.getElementById('host').value = conn?.host || '';
			document.getElementById('port').value = conn?.port || 1521;
			document.getElementById('owner').value = conn?.owner || '';
			document.getElementById('metadataSource').value = conn?.metadataSource || 'generic';
			document.getElementById('customMetadataQuery').value = conn?.customMetadataQuery || '';

			const hasPassword = hasSavedPassword(conn?.name || '');

			document.getElementById('password').value =
				hasPassword ? SAVED_PASSWORD_PLACEHOLDER : '';

			document.getElementById('passwordStatus').textContent =
				hasPassword
					? 'Password saved.'
					: 'No password saved.';

			const typeEl = document.getElementById('connectionType');
			const dbEl = document.getElementById('databaseValue');

			typeEl.value = conn?.connectionType || 'serviceName';
			dbEl.dataset.serviceName = conn?.serviceName || '';
			dbEl.dataset.sid = conn?.sid || '';

			updateDatabaseLabel();
			updateFormTitle(conn);
			updateMetadataSourceDisplay();
		}

		function readPassword() {
			const value = document.getElementById('password').value;

			if (value === SAVED_PASSWORD_PLACEHOLDER) {
				return '';
			}

			return value;
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
				metadataSource: document.getElementById('metadataSource').value || 'generic',
				customMetadataQuery: document.getElementById('customMetadataQuery').value.trim()
			};
		}

		function validateForm() {
			clearValidation();

			const form = readForm();
			let valid = true;

			if (!form.name) {
				showFieldError('name', 'Required field cannot be empty.');
				valid = false;
			}

			if (!form.user) {
				showFieldError('user', 'Required field cannot be empty.');
				valid = false;
			}

			if (!form.host) {
				showFieldError('host', 'Required field cannot be empty.');
				valid = false;
			}

			if (!form.port || Number.isNaN(Number(form.port))) {
				showFieldError('port', 'Required field cannot be empty.');
				valid = false;
			}

			if (!form.connectionType) {
				showFieldError('connectionType', 'Required field cannot be empty.');
				valid = false;
			}

			if (form.connectionType === 'serviceName' && !form.serviceName) {
				showFieldError('databaseValue', 'Required field cannot be empty.');
				valid = false;
			}

			if (form.connectionType === 'sid' && !form.sid) {
				showFieldError('databaseValue', 'Required field cannot be empty.');
				valid = false;
			}

			if (!hasSavedPassword(form.name) && !readPassword()) {
				showFieldError('password', 'Required field cannot be empty.');
				valid = false;
			}

			if (form.metadataSource === 'custom' && !form.customMetadataQuery) {
				showFieldError('customMetadataQuery', 'Required field cannot be empty.');
				valid = false;
			}

			return valid;
		}

		function setBusy(statusId, buttonId, isBusy) {
			const status = document.getElementById(statusId);
			const button = document.getElementById(buttonId);

			status.classList.toggle('hidden', !isBusy);
			button.disabled = isBusy;
		}

		document.getElementById('testBtn').addEventListener('click', () => {
			if (!validateForm()) {
				return;
			}

			setBusy('testStatus', 'testBtn', true);

			vscode.postMessage({
				command: 'testConnection',
				connection: readForm(),
				password: readPassword()
			});
		});

		document.getElementById('testCustomQueryBtn').addEventListener('click', () => {
			if (!validateForm()) {
				return;
			}

			setBusy('testCustomQueryStatus', 'testCustomQueryBtn', true);

			vscode.postMessage({
				command: 'testCustomMetadataQuery',
				connection: readForm(),
				password: readPassword()
			});
		});

		document.getElementById('metadataSource').addEventListener('change', () => {
			updateMetadataSourceDisplay();
		});

		document
			.querySelectorAll('input, select, textarea')
			.forEach(el => {
				el.addEventListener('input', () => {
					el.classList.remove('field-error');

					const error = document.getElementById(el.id + '-error');

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
				connection: readForm(),
				password: readPassword()
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
				connection: readForm(),
				password: readPassword()
			});
		});

		document.getElementById('deleteBtn').addEventListener('click', () => {
			vscode.postMessage({
				command: 'deleteConnection',
				connectionName: document.getElementById('name').value.trim()
			});
		});

		window.addEventListener('message', event => {
			const message = event.data;

			if (message.command === 'testConnectionFinished') {
				setBusy('testStatus', 'testBtn', false);
			}

			if (message.command === 'testCustomMetadataQueryFinished') {
				setBusy('testCustomQueryStatus', 'testCustomQueryBtn', false);
			}
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