import * as vscode from 'vscode';
import * as oracledb from 'oracledb';

import { OracleConnection } from './types';

export function buildConnectString(connection: OracleConnection): string {
	if (connection.connectionType === 'sid') {
		return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${connection.host})(PORT=${connection.port}))(CONNECT_DATA=(SID=${connection.sid})))`;
	}

	return `${connection.host}:${connection.port}/${connection.serviceName}`;
}

export function getConnections(): OracleConnection[] {
	const config = vscode.workspace.getConfiguration('oracleCacheUp');
	return config.get<OracleConnection[]>('connections') ?? [];
}

export async function saveConnections(connections: OracleConnection[]): Promise<void> {
	const config = vscode.workspace.getConfiguration('oracleCacheUp');

	await config.update(
		'connections',
		connections,
		vscode.ConfigurationTarget.Global
	);

	await updateConnectionContext();
}

export async function updateConnectionContext(): Promise<void> {
	const config = vscode.workspace.getConfiguration('oracleCacheUp');
	const connections = config.get<OracleConnection[]>('connections') ?? [];

	await vscode.commands.executeCommand(
		'setContext',
		'oracleCacheUp.hasConnections',
		connections.length > 0
	);
}

export function getActiveConnection(): OracleConnection | undefined {
	const config = vscode.workspace.getConfiguration('oracleCacheUp');

	const activeConnectionName =
		config.get<string>('activeConnection');

	return getConnections().find(
		c => c.name === activeConnectionName
	);
}

export async function setActiveConnection(connectionName: string): Promise<void> {
	const config = vscode.workspace.getConfiguration('oracleCacheUp');

	await config.update(
		'activeConnection',
		connectionName,
		vscode.ConfigurationTarget.Global
	);
}

export function getPasswordKey(connectionName: string): string {
	return `oracleCacheUp.password.${connectionName}`;
}

export async function getPasswordStatuses(
	context: vscode.ExtensionContext,
	connections: OracleConnection[]
): Promise<Record<string, boolean>> {
	const statuses: Record<string, boolean> = {};

	for (const conn of connections) {
		statuses[conn.name] = !!await context.secrets.get(
			getPasswordKey(conn.name)
		);
	}

	return statuses;
}

export function validateConnection(connection: OracleConnection): string[] {
	const errors: string[] = [];

	if (!connection.name?.trim()) {
		errors.push('Name');
	}

	if (!connection.user?.trim()) {
		errors.push('User');
	}

	if (!connection.host?.trim()) {
		errors.push('Host');
	}

	if (!connection.port || Number.isNaN(Number(connection.port))) {
		errors.push('Port');
	}

	if (!connection.connectionType) {
		errors.push('Type');
	}

	if (connection.connectionType === 'serviceName' && !connection.serviceName?.trim()) {
		errors.push('Service Name');
	}

	if (connection.connectionType === 'sid' && !connection.sid?.trim()) {
		errors.push('SID');
	}

	return errors;
}

export async function testOracleConnection(
	context: vscode.ExtensionContext,
	connectionInfo: OracleConnection
): Promise<unknown[] | undefined> {
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

		const result = await connection.execute(
			'select sysdate from dual'
		);

		return result.rows;
	}
	finally {
		if (connection) {
			await connection.close();
		}
	}
}

export function registerAddConnectionCommand(context: vscode.ExtensionContext): void {
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
				prompt: 'Schema owner to cache'
			});

			const connections = getConnections();

			const connection: OracleConnection = {
				name,
				user,
				host,
				port: Number(portText),
				connectionType: 'serviceName',
				serviceName,
				sid: '',
				owner: owner?.trim()
			};

			connections.push(connection);

			await saveConnections(connections);
			await setActiveConnection(name);

			vscode.window.showInformationMessage(
				`Connection "${name}" added.`
			);
		}
	);

	context.subscriptions.push(addConnection);
}

export function registerTestConnectionCommand(context: vscode.ExtensionContext): void {
	const testConnectionCommand = vscode.commands.registerCommand(
		'oracle-cache-up.testConnection',
		async () => {
			try {
				const activeConnection = getActiveConnection();

				if (!activeConnection) {
					vscode.window.showErrorMessage(
						'No active OracleCacheUp connection configured.'
					);
					return;
				}

				const resultRows = await testOracleConnection(
					context,
					activeConnection
				);

				vscode.window.showInformationMessage(
					`Connection successful: ${JSON.stringify(resultRows)}`
				);
			}
			catch (err: any) {
				vscode.window.showErrorMessage(
					err.message
				);
			}
		}
	);

	context.subscriptions.push(testConnectionCommand);
}
