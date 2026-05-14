/**
 * FACTS.md Writer
 *
 * FACTS.md is freeform Markdown containing declarative project truths.
 * This writer is NOT marker-managed — it simply appends new facts or
 * creates the file if it doesn't exist.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Options for writing a project fact.
 */
export interface ProjectFactOptions {
	/** The fact text to add. Supports multi-line Markdown. */
	fact: string;
	/** Optional section heading to group facts (e.g. "## Architecture"). */
	section?: string;
}

/**
 * Append a project fact to FACTS.md.
 *
 * - If the file does not exist, creates it with a top-level header.
 * - If the file exists, appends the fact (optionally under a section).
 *
 * Returns the path to the written file.
 */
export async function writeProjectFact(
	filePath: string,
	options: ProjectFactOptions,
): Promise<string> {
	const { fact, section } = options;

	// Build the fact entry
	const entry = section
		? `\n${section}\n\n${indentFact(fact)}\n`
		: `\n${indentFact(fact)}\n`;

	// Try to read existing file
	try {
		const existing = await readFile(filePath, "utf-8");
		const updated = existing.trimEnd() + entry;
		await writeFile(filePath, updated, "utf-8");
		return filePath;
	} catch (err: unknown) {
		if (isNotFound(err)) {
			await ensureDir(filePath);
			const header = `# Project Facts\n\n*Declarative truths about this project.*\n`;
			await writeFile(filePath, header + entry, "utf-8");
			return filePath;
		}
		throw err;
	}
}

/**
 * Read the entire FACTS.md content.
 * Returns null if the file does not exist.
 */
export async function readProjectFacts(
	filePath: string,
): Promise<string | null> {
	try {
		return await readFile(filePath, "utf-8");
	} catch (err: unknown) {
		if (isNotFound(err)) return null;
		throw err;
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────

function indentFact(fact: string): string {
	// Ensure the fact is a proper bullet or paragraph
	const trimmed = fact.trim();
	if (
		trimmed.startsWith("- ") ||
		trimmed.startsWith("* ") ||
		trimmed.startsWith("#")
	) {
		return trimmed;
	}
	return `- ${trimmed}`;
}

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
