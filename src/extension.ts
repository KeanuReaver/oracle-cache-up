import * as vscode from 'vscode';

import { loadCache } from './cache';
import { registerRefreshCacheCommand } from './cacheRefresh';
import { registerAddConnectionCommand, registerTestConnectionCommand, updateConnectionContext } from './connections';
import { registerManageConnectionsCommand } from './connectionManagerWebview';
import { registerHoverControlCommands, registerHoverProvider } from './hoverProvider';

export async function activate(context: vscode.ExtensionContext) {
	loadCache();

	await updateConnectionContext();
	registerAddConnectionCommand(context);
	registerTestConnectionCommand(context);
	registerRefreshCacheCommand(context);
	registerManageConnectionsCommand(context);
	registerHoverProvider(context);
	registerHoverControlCommands(context);
}

export function deactivate() {}
