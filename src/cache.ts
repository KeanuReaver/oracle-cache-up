import * as fs from 'node:fs';
import * as path from 'node:path';

import { OracleMetadataCache } from './types';

let cache: OracleMetadataCache = {};

export function getCache(): OracleMetadataCache {
	return cache;
}

export function getCachePath(): string {
	return path.join(__dirname, '../cache/metadata.json');
}

export function loadCache(): void {
	const cachePath = getCachePath();

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

export function saveCache(newCache: OracleMetadataCache): void {
	const cachePath = getCachePath();

	fs.mkdirSync(path.dirname(cachePath), { recursive: true });

	fs.writeFileSync(
		cachePath,
		JSON.stringify(newCache, null, 4),
		'utf8'
	);

	cache = newCache;
}
