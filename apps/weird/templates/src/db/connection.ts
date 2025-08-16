import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

export async function createDb(): Promise<Database> {
	const db = await open({ filename: ':memory:', driver: sqlite3.Database });
	await db.exec('PRAGMA journal_mode=MEMORY;');
	await db.exec('PRAGMA synchronous=OFF;');
	return db;
}