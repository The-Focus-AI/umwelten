import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import type { Database } from 'sqlite';

type ScalarType = 'string'|'integer'|'float'|'boolean'|'date'|'datetime'|'json';

export async function ingestCsv(db: Database) {
	const parsingSpecPath = path.resolve(process.cwd(), 'src/ingest/parsingSpec.json');
	const spec = JSON.parse(fs.readFileSync(parsingSpecPath, 'utf-8')) as {
		delimiter: string;
		header_row_index: number;
		data_start_row_index: number;
		null_tokens: string[];
		columns: Array<{ name: string; type: ScalarType }>;
	};
	const csvPath = process.env.CSV_PATH;
	if (!csvPath) throw new Error('CSV_PATH env var is required');
	const text = fs.readFileSync(csvPath, 'utf-8');
	const parsed = Papa.parse<string[]>(text, { delimiter: spec.delimiter as Papa.ParseConfig['delimiter'], skipEmptyLines: 'greedy' });
	if (parsed.errors && parsed.errors.length) throw new Error(parsed.errors[0].message);
	const rows = parsed.data as string[][];

	const table = deriveTableName(csvPath);
	const ddlCols = spec.columns.map(c => `${escapeIdent(c.name)} ${sqliteType(c.type)}`).join(', ');
	await db.exec(`CREATE TABLE ${escapeIdent(table)} (${ddlCols});`);

	const batchSize = 1000;
	for (let i = spec.data_start_row_index; i < rows.length; i += batchSize) {
		const batch = rows.slice(i, i + batchSize);
		await insertBatch(db, table, spec, batch);
	}
}

function deriveTableName(p: string): string {
	return path.basename(p).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
}

function escapeIdent(id: string): string { return '"' + id.replace(/"/g, '""') + '"'; }

function sqliteType(t: ScalarType): string {
	switch (t) {
		case 'integer': return 'INTEGER';
		case 'float': return 'REAL';
		case 'boolean': return 'INTEGER';
		case 'date':
		case 'datetime':
		case 'json':
		case 'string':
		default: return 'TEXT';
	}
}

async function insertBatch(db: Database, table: string, spec: any, batch: string[][]) {
	const placeholders = '(' + spec.columns.map(() => '?').join(',') + ')';
	const sql = `INSERT INTO ${escapeIdent(table)} VALUES ${placeholders}`;
	const stmt = await db.prepare(`INSERT INTO ${escapeIdent(table)} VALUES (${spec.columns.map(() => '?').join(',')})`);
	try {
		await db.exec('BEGIN');
		for (const row of batch) {
			const values = spec.columns.map((c: any, idx: number) => coerce(row[idx], c.type, spec.null_tokens));
			await stmt.run(values);
		}
		await db.exec('COMMIT');
	} catch (e) {
		await db.exec('ROLLBACK');
		throw e;
	} finally {
		await stmt.finalize();
	}
}

function coerce(value: any, t: ScalarType, nullTokens: string[]) {
	if (value == null) return null;
	const v = String(value);
	if (nullTokens.includes(v)) return null;
	switch (t) {
		case 'integer': {
			const n = Number(v);
			return Number.isFinite(n) ? Math.trunc(n) : null;
		}
		case 'float': {
			const n = Number(v);
			return Number.isFinite(n) ? n : null;
		}
		case 'boolean': {
			const s = v.trim().toLowerCase();
			if (['true','1','yes','y'].includes(s)) return 1;
			if (['false','0','no','n'].includes(s)) return 0;
			return null;
		}
		case 'date':
		case 'datetime': {
			const ms = Date.parse(v);
			return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
		}
		case 'json': {
			try { return JSON.stringify(JSON.parse(v)); } catch { return null; }
		}
		case 'string':
		default:
			return v;
	}
}