export interface ParsedCte {
    name: string;
    fields: Record<string, string>;
}

export function parseCtes(sql: string): Record<string, ParsedCte> {
    const ctes: Record<string, ParsedCte> = {};
    const withIndex = sql.search(/\bWITH\b/i);

    if (withIndex < 0) {
        return ctes;
    }

    let index = withIndex + 4;

    while (index < sql.length) {
        const nameMatch = sql.substring(index).match(/^\s*,?\s*([a-zA-Z0-9_$#]+)\s+AS\s*\(/i);

        if (!nameMatch) {
            break;
        }

        const name = nameMatch[1].toUpperCase();
        index += nameMatch[0].length;

        const start = index;
        const end = findMatchingParen(sql, start - 1);

        if (end < 0) {
            break;
        }

        const cteSql = sql.substring(start, end);

        ctes[name] = {
            name,
            fields: parseSelectFields(cteSql)
        };

        index = end + 1;
    }

    return ctes;
}

export function parseInlineViews(sql: string): Record<string, ParsedCte> {
    const views: Record<string, ParsedCte> = {};
    const regex = /\b(FROM|JOIN)\s*\(/gi;

    let match: RegExpExecArray | null;

    while ((match = regex.exec(sql)) !== null) {
        const openParenIndex = regex.lastIndex - 1;
        const closeParenIndex = findMatchingParen(sql, openParenIndex);

        if (closeParenIndex < 0) {
            continue;
        }

        const innerSql = sql.substring(openParenIndex + 1, closeParenIndex);

        if (!/\bSELECT\b/i.test(innerSql)) {
            regex.lastIndex = closeParenIndex + 1;
            continue;
        }

        const aliasMatch = sql
            .substring(closeParenIndex + 1)
            .match(/^\s+([a-zA-Z0-9_$#]+)/);

        const alias = aliasMatch?.[1]?.toUpperCase();

        if (!alias) {
            regex.lastIndex = closeParenIndex + 1;
            continue;
        }

        const ignoredAliases = new Set([
            'ON', 'WHERE', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER',
            'JOIN', 'ORDER', 'GROUP', 'HAVING', 'UNION'
        ]);

        if (!ignoredAliases.has(alias)) {
            views[alias] = {
                name: alias,
                fields: parseSelectFields(innerSql)
            };
        }

        regex.lastIndex = closeParenIndex + 1;
    }

    return views;
}

function findMatchingParen(sql: string, openParenIndex: number): number {
    let depth = 0;

    for (let i = openParenIndex; i < sql.length; i++) {
        const char = sql[i];

        if (char === '(') {
            depth++;
        } else if (char === ')') {
            depth--;

            if (depth === 0) {
                return i;
            }
        }
    }

    return -1;
}

function parseSelectFields(sql: string): Record<string, string> {
    const fields: Record<string, string> = {};
    const selectMatch = sql.match(/\bSELECT\b/i);
    const fromMatch = sql.match(/\bFROM\b/i);

    if (!selectMatch || !fromMatch || fromMatch.index === undefined) {
        return fields;
    }

    const selectList = sql.substring(
        selectMatch.index! + selectMatch[0].length,
        fromMatch.index
    );

    const parts = splitTopLevelCommas(selectList);

    for (const part of parts) {
        const field = parseSelectField(part);

        if (field) {
            fields[field.name] = field.source;
        }
    }

    return fields;
}

function splitTopLevelCommas(text: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of text) {
        if (char === '(') {
            depth++;
        } else if (char === ')') {
            depth--;
        }

        if (char === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    if (current.trim()) {
        parts.push(current.trim());
    }

    return parts;
}

function parseSelectField(text: string): { name: string; source: string } | undefined {
    const asMatch = text.match(/\s+AS\s+([a-zA-Z0-9_$#]+)$/i);

    if (asMatch) {
        return {
            name: asMatch[1].toUpperCase(),
            source: text.substring(0, asMatch.index).trim()
        };
    }

    const qualifiedMatch = text.match(/([a-zA-Z0-9_$#]+)\.([a-zA-Z0-9_$#]+)$/);

    if (qualifiedMatch) {
        return {
            name: qualifiedMatch[2].toUpperCase(),
            source: text.trim()
        };
    }

    const bareMatch = text.match(/^([a-zA-Z0-9_$#]+)$/);

    if (bareMatch) {
        return {
            name: bareMatch[1].toUpperCase(),
            source: text.trim()
        };
    }

    return undefined;
}