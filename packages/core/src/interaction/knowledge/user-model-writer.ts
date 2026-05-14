/**
 * User Model Writer
 *
 * Manages project-local `.umwelten/user-model.md` — a freeform
 * Markdown file where agents record work-style observations about
 * how development happens in this project.
 *
 * The file is NOT marker-managed. Writers append dated entries.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Options for writing a user model entry.
 */
export interface UserModelEntryOptions {
	/** The observation or preference text. */
	entry: string;
	/** Optional category heading (e.g. "## Preferences", "## Workflow Notes"). */
	category?: string;
}

/**
 * Append a user model entry to `.umwelten/user-model.md`.
 *
 * - If the file does not exist, creates it with a header.
 * - If the file exists, appends a dated entry (optionally under a category).
 *
 * Returns the path to the written file.
 */
export async function writeUserModelEntry(
	filePath: string,
	options: UserModelEntryOptions,
): Promise<string> {
	const { entry, category } = options;

	const now = new Date().toISOString().slice(0, 10);
	const formatted =
		entry.trim().startsWith("- ") || entry.trim().startsWith("* ")
			? entry.trim()
			: `- ${entry.trim()}`;

	const datedEntry = `> _Recorded: ${now}_\n${formatted}\n`;
	const block = category ? `\n${category}\n\n${datedEntry}` : `\n${datedEntry}`;

	try {
		const existing = await readFile(filePath, "utf-8");
		const updated = existing.trimEnd() + block;
		await writeFile(filePath, updated, "utf-8");
		return filePath;
	} catch (err: unknown) {
		if (isNotFound(err)) {
			await ensureDir(filePath);
			const header = `# Project User Model\n\n*Work-style observations about this project.*\n`;
			await writeFile(filePath, header + block, "utf-8");
			return filePath;
		}
		throw err;
	}
}

/**
 * Read the entire user model content.
 * Returns null if the file does not exist.
 */
export async function readUserModel(filePath: string): Promise<string | null> {
	try {
		return await readFile(filePath, "utf-8");
	} catch (err: unknown) {
		if (isNotFound(err)) return null;
		throw err;
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────

function isNotFound(err: unknown): boolean {
	return (
		err !== null &&
		typeof err === "object" &&
		"code" in err &&
		(err as NodeJS.ErrnoException).code === "ENOENT"
	);
}

async function ensureDir(filePath: string): Promise<void> {
	const dir = dirname(filePath);
	await mkdir(dir, { recursive: true });
}
