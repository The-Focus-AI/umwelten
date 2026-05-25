/**
 * Tiny glob matcher used by `agent_logs` to resolve patterns like
 * `logs/*.jsonl` or `**\/*.log` against an agent's project directory.
 * Uses `readdir` walks — no external deps.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Find files matching a glob-like pattern relative to a base directory.
 * Supports simple patterns like "logs/*.jsonl" or "*.log".
 */
export async function findMatchingFiles(
	basePath: string,
	pattern: string,
): Promise<string[]> {
	const parts = pattern.split("/");
	return walkPattern(basePath, parts);
}

async function walkPattern(dir: string, parts: string[]): Promise<string[]> {
	if (parts.length === 0) return [];

	const [current, ...rest] = parts;
	const results: string[] = [];

	try {
		const entries = await readdir(dir, { withFileTypes: true });

		if (current === "**") {
			// Recursive: match in this dir and all subdirs
			// Try matching rest in current dir
			results.push(...(await walkPattern(dir, rest)));
			// Recurse into subdirectories
			for (const entry of entries) {
				if (entry.isDirectory()) {
					results.push(...(await walkPattern(join(dir, entry.name), parts)));
				}
			}
		} else if (rest.length === 0) {
			// Last part: match files
			const regex = globToRegex(current);
			for (const entry of entries) {
				if (entry.isFile() && regex.test(entry.name)) {
					results.push(join(dir, entry.name));
				}
			}
		} else {
			// Intermediate directory part
			if (current.includes("*")) {
				const regex = globToRegex(current);
				for (const entry of entries) {
					if (entry.isDirectory() && regex.test(entry.name)) {
						results.push(...(await walkPattern(join(dir, entry.name), rest)));
					}
				}
			} else {
				// Exact directory name
				results.push(...(await walkPattern(join(dir, current), rest)));
			}
		}
	} catch {
		// Directory doesn't exist or not readable
	}

	return results;
}

function globToRegex(glob: string): RegExp {
	const escaped = glob
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${escaped}$`);
}
