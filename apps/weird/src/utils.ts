import fs from 'node:fs';
import path from 'node:path';

export const ExitCodes = {
	SUCCESS: 0,
	INVALID_INPUT: 1,
	LLM_SPEC_FAILURE: 2,
	CODEGEN_FAILURE: 3,
} as const;

export function assertFileReadable(p: string) {
	if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
	const stat = fs.statSync(p);
	if (!stat.isFile()) throw new Error(`Not a file: ${p}`);
}

export function deriveProjectNameFromPath(filePath: string): string {
	const stem = path.basename(filePath).replace(/\.[^.]+$/, '');
	return stem.replace(/[^a-zA-Z0-9_-]/g, '-');
}

export function isSelectOnly(sql: string): boolean {
	const trimmed = sql.trim().toLowerCase();
	if (!/^select\s/.test(trimmed)) return false;
	const forbidden = /(insert|update|delete|create|drop|alter|truncate|attach|detach|vacuum|reindex)\b/;
	return !forbidden.test(trimmed);
}