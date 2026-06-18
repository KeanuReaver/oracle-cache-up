import * as vscode from 'vscode';

import { getCache, loadCache } from './cache';
import { parseCtes, parseInlineViews, ParsedCte } from './cteParser';
import { setTimeout as delayTimeout } from 'node:timers/promises';

let hoverPaused = false;

export function registerHoverProvider(context: vscode.ExtensionContext): void {
	const hoverProvider = vscode.languages.registerHoverProvider(
		['sql', 'plsql', 'oracle-sql', 'oracle-plsql'],
		{
			async provideHover(document, position) {
				const showDescriptions =
					vscode.workspace
						.getConfiguration('oracleCacheUp')
						.get<boolean>('showDescriptions') ?? false;
				if (hoverPaused) {
					return;
				}

				const rawHoverDelayMs =
					vscode.workspace
						.getConfiguration('oracleCacheUp')
						.get<number>('hoverDelayMs') ?? 0;

				const hoverDelayMs = Math.max(
					0,
					Math.min(500, rawHoverDelayMs)
				);

				if (hoverDelayMs > 0) {
					await delayTimeout(hoverDelayMs);
				}

				const cache = getCache();

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

				const statementSql = getCurrentStatement(document, position);
				const aliases = getAliases(statementSql);
				const ctes = {
						...parseCtes(statementSql),
						...parseInlineViews(statementSql)
					};

				if (hasDotAfter) {
					const resolvedTableName = aliases[upperWord] ?? upperWord;

					if (cache[resolvedTableName]) {
						return showTableHover(resolvedTableName, cache, showDescriptions);
					}

					if (ctes[resolvedTableName]) {
						return showCteHover(ctes[resolvedTableName], cache, ctes);
					}

					return new vscode.Hover(
						`Table/Object: ${resolvedTableName}\n\nNo cached metadata found.`
					);
				}

				if (hasDotBefore) {
					const qualifierMatch = beforeWord.match(/([a-zA-Z0-9_$#]+)\s*\.\s*$/);
					const qualifier = qualifierMatch?.[1]?.toUpperCase();

					if (qualifier) {
						const resolvedTableName = aliases[qualifier] ?? qualifier;

						if (cache[resolvedTableName]) {
							return showFieldHover(resolvedTableName, upperWord, cache, showDescriptions);
						}

						if (ctes[resolvedTableName]) {
							return showCteFieldHover(ctes[resolvedTableName], upperWord, cache, ctes);
						}

						return new vscode.Hover(
							`Field: ${resolvedTableName}.${upperWord}\n\nNo cached metadata found.`
						);
					}
				}

				const resolvedWord = aliases[upperWord] ?? upperWord;

				if (cache[resolvedWord]) {
					return showTableHover(resolvedWord, cache, showDescriptions);
				}

				if (ctes[resolvedWord]) {
					return showCteHover(ctes[resolvedWord], cache, ctes);
				}

				return showGlobalFieldHover(upperWord, cache);
			}
		}
	);

	context.subscriptions.push(hoverProvider);
}

export function registerHoverControlCommands(context: vscode.ExtensionContext): void {
	vscode.commands.executeCommand(
        'setContext',
        'oracleCacheUp.hoverPaused',
        false
    );

	const pauseHoverCommand = vscode.commands.registerCommand(
		'oracle-cache-up.pauseHover',
		async () => {
			hoverPaused = true;

			await vscode.commands.executeCommand(
				'setContext',
				'oracleCacheUp.hoverPaused',
				true
			);

			vscode.window.showInformationMessage('OracleCacheUp hovers paused.');
		}
	);

	const resumeHoverCommand = vscode.commands.registerCommand(
		'oracle-cache-up.resumeHover',
		async () => {
			hoverPaused = false;

			await vscode.commands.executeCommand(
				'setContext',
				'oracleCacheUp.hoverPaused',
				false
			);

			vscode.window.showInformationMessage('OracleCacheUp hovers resumed.');
		}
	);

	const restartHoverCommand = vscode.commands.registerCommand(
		'oracle-cache-up.restartHover',
		async () => {
			try {
				hoverPaused = false;
				loadCache();

				await vscode.commands.executeCommand(
					'setContext',
					'oracleCacheUp.hoverPaused',
					false
				);

				vscode.window.showInformationMessage('OracleCacheUp local cache reloaded.');
			} catch (err: any) {
				vscode.window.showErrorMessage(
					`OracleCacheUp reload failed: ${err.message ?? err}`
				);
			}
		}
	);

	context.subscriptions.push(pauseHoverCommand);
	context.subscriptions.push(resumeHoverCommand);
	context.subscriptions.push(restartHoverCommand);
}

function showTableHover(
    tableName: string,
    cache: any,
    showDescriptions: boolean
): vscode.Hover | undefined {
	const table = cache[tableName];
	const inferData = vscode.workspace.getConfiguration('oracleCacheUp').get<boolean>('inferPowerSchoolRelationships');
	const extBy = vscode.workspace.getConfiguration('oracleCacheUp').get<boolean>('tableExtendedBy');

	if (!table) {
		return new vscode.Hover(`Table/Object: ${tableName}\n\nNo cached metadata found.`);
	}

	const md = new vscode.MarkdownString();
	const extendedBy = table._table?.extended_by;

	md.appendMarkdown(`### ${tableName}\n\n`);
	if (showDescriptions && table._table?.description) {
		md.appendMarkdown(`${table._table.description}\n\n`);
	}

	if (extBy && Array.isArray(extendedBy) && extendedBy.length > 0) {
		md.appendMarkdown(
			`**Extended by:** ${extendedBy.join(', ')}\n\n`
		);
	}

	if (inferData ) {
		md.appendMarkdown(`| Field | Type | Relationship |\n|---|---|---|\n`);
	} else {
		md.appendMarkdown(`| Field | Type |\n|---|---|\n`);
	}	
	
	for (const [fieldName, fieldInfo] of Object.entries(table)) {
		if (fieldName === '_table') {
			continue;
		}

		const info = fieldInfo as any;
		const relationship = getFieldRelationshipLabel(info);

		
		if (inferData ) {
			md.appendMarkdown(
				`| ${fieldName} | ${info.field_data_type ?? ''} | ${relationship} |\n`
			);
		} else {
			md.appendMarkdown(
				`| ${fieldName} | ${info.field_data_type ?? ''} |\n`
			);
		}
			
	}

	return new vscode.Hover(md);
}

function showFieldHover(
    tableName: string,
    fieldName: string,
    cache: any,
    showDescriptions: boolean
): vscode.Hover | undefined {
	const fieldInfo = cache?.[tableName]?.[fieldName];

	if (!fieldInfo) {
		return new vscode.Hover(
			`Field: ${tableName}.${fieldName}\n\nNo cached metadata found.`
		);
	}

	const md = new vscode.MarkdownString();
	md.appendMarkdown(`### ${tableName}.${fieldName}\n\n**Type:** ${fieldInfo.field_data_type ?? ''}`);
	if (showDescriptions && fieldInfo.description) {
		md.appendMarkdown(`\n\n${fieldInfo.description}`);
	}

	if (fieldInfo.relationship_table && fieldInfo.relationship_column) {
		md.appendMarkdown(
			`\n\n**PowerSchool Relationship:** ${fieldInfo.relationship_table}.${fieldInfo.relationship_column}`
		);

		if (fieldInfo.relationship_source === 'powerschool-inferred') {
			md.appendMarkdown(`  \n_Inferred from field name._`);
		}
	}

	return new vscode.Hover(md);
}

function tableCell(
    value: string | undefined,
    maxLength = 100
): string {
    if (!value) {
        return '';
    }

	if (/^\s*CASE\b/i.test(value)) {
		return 'CASE expression';
	}

    const cleaned = value
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\|/g, '\\|')
        .trim();

    if (cleaned.length <= maxLength) {
        return cleaned;
    }

    return cleaned.substring(0, maxLength - 3) + '...';
}

function showCteHover(
    cte: ParsedCte,
    cache: any,
    ctes: Record<string, ParsedCte>
): vscode.Hover {
    const md = new vscode.MarkdownString();

    md.appendMarkdown(`### CTE: ${cte.name}\n\n| Field | Source | Type |\n|---|---|---|\n`);

    for (const [fieldName, source] of Object.entries(cte.fields)) {
        const datatype = getDatatypeFromSource(source, cache, ctes) ?? 'Derived expression';

        md.appendMarkdown(
			`| ${fieldName} | \`${tableCell(source)}\` | ${tableCell(datatype)} |\n`
		);
    }

    return new vscode.Hover(md);
}

function showCteFieldHover(
    cte: ParsedCte,
    fieldName: string,
    cache: any,
    ctes: Record<string, ParsedCte>
): vscode.Hover {
    const source = cte.fields[fieldName];

    if (!source) {
        return new vscode.Hover(
            `CTE Field: ${cte.name}.${fieldName}\n\nNo derived field found.`
        );
    }

    const datatype = getDatatypeFromSource(source, cache, ctes);

    const md = new vscode.MarkdownString();

    md.appendMarkdown(`### ${cte.name}.${fieldName}\n\n**Derived from:** \`${tableCell(source)}\`  \n`);

    if (datatype) {
        md.appendMarkdown(`**Type:** ${datatype}`);
    } else {
        md.appendMarkdown(`**Type:** Derived expression`);
    }

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
	md.appendMarkdown(`### ${fieldName}\n\n| Field | Type |\n|---|---|\n${matches.join('\n')}`);

	return new vscode.Hover(md);
}

function getFieldRelationshipLabel(fieldInfo: any): string {
    if (fieldInfo.parent_table) {
        const parentIndex = fieldInfo.parent_table_index
            ? `.${fieldInfo.parent_table_index}`
            : '';

        return `PowerSchool → ${fieldInfo.parent_table}${parentIndex}`;
    }

    if (fieldInfo.relationship_table && fieldInfo.relationship_column) {
        return `Inferred → ${fieldInfo.relationship_table}.${fieldInfo.relationship_column}`;
    }

    if (fieldInfo.foreign_table && fieldInfo.foreign_column) {
        return `FK → ${fieldInfo.foreign_table}.${fieldInfo.foreign_column}`;
    }

    if (fieldInfo.is_primary_key) {
        return 'PK';
    }

    return '';
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

function getDatatypeFromSource(
    source: string,
    cache: any,
    ctes: Record<string, ParsedCte>,
    depth = 0
): string | undefined {
    if (depth > 10) {
        return undefined;
    }

    const match = source.match(/^([a-zA-Z0-9_$#]+)\.([a-zA-Z0-9_$#]+)$/);

    if (!match) {
        return undefined;
    }

    const tableName = match[1].toUpperCase();
    const fieldName = match[2].toUpperCase();

    const cachedField = cache?.[tableName]?.[fieldName];

    if (cachedField) {
        return cachedField.field_data_type ?? cachedField;
    }

    const cte = ctes[tableName];

    if (!cte) {
        return undefined;
    }

    const nextSource = cte.fields[fieldName];

    if (!nextSource) {
        return undefined;
    }

    return getDatatypeFromSource(nextSource, cache, ctes, depth + 1);
}