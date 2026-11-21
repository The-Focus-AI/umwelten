/**
 * Agent Instruction Writer
 *
 * Creates or updates a marker-managed `## Reflections` section in AGENTS.md
 * or CLAUDE.md without disturbing surrounding hand-written content.
 *
 * Section boundaries:
 *   <!-- umwelten:reflections:start -->
 *   <!-- umwelten:reflections:end -->
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REFLECTIONS_START = "<!-- umwelten:reflections:start -->";
const REFLECTIONS_END = "<!-- umwelten:reflections:end -->";

const DEFAULT_SECTION_HEADER = "## Reflections";

/**
 * Options for writing a reflection entry.
 */
export interface AgentReflectionOptions {
	/** One or more bullet-point-ready reflection strings. */
	entries: string[];
	/** Override the section heading (default: "## Reflections"). */
	sectionHeader?: string;
}

/**
 * Create or update the Reflections section in an agent instruction file.
 *
 * - If the file does not exist, creates it with the section.
 * - If the file exists but has no Reflections section, appends one.
 * - If the file exists with a Reflections section, replaces the content
 *   between the markers.
 *
 * Returns the path to the written file.
 */
export async function writeAgentReflection(
	filePath: string,
	options: AgentReflectionOptions,
): Promise<string> {
	const { entries, sectionHeader = DEFAULT_SECTION_HEADER } = options;

	// Build the new section content
	const bulletContent = entries
		.map((e) => (e.startsWith("- ") || e.startsWith("* ") ? e : `- ${e}`))
		.join("\n");

	const newSection = [
		"",
		sectionHeader,
		"",
		REFLECTIONS_START,
		bulletContent,
		REFLECTIONS_END,
		"",
	].join("\n");

	// Try to read the existing file
	let existing: string;
	try {
		existing = await readFile(filePath, "utf-8");
	} catch (err: unknown) {
		if (isNotFound(err)) {
			// File doesn't exist — create it with the section
			await ensureDir(filePath);
			const content = `# ${basename(filePath).replace(/\.md$/i, "")}\n${newSection}\n`;
			await writeFile(filePath, content, "utf-8");
			return filePath;
		}
		throw err;
	}

	// File exists — check for existing Reflections section
	const startIdx = existing.indexOf(REFLECTIONS_START);
	const endIdx = existing.indexOf(REFLECTIONS_END);

	if (startIdx === -1 || endIdx === -1) {
		// No section — append it
		const updated = existing.trimEnd() + "\n" + newSection + "\n";
		await writeFile(filePath, updated, "utf-8");
		return filePath;
	}

	// Section exists — replace content between markers
	const before = existing.slice(0, startIdx + REFLECTIONS_START.length);
	const after = existing.slice(endIdx);
	const updated = before + "\n" + bulletContent + "\n" + after;
	await writeFile(filePath, updated, "utf-8");
	return filePath;
}

/**
 * Read the current reflections from an agent instruction file.
 * Returns the text between the markers, or null if no section exists.
 */
export async function readAgentReflections(
	filePath: string,
): Promise<string | null> {
	try {
		const content = await readFile(filePath, "utf-8");
		const startIdx = content.indexOf(REFLECTIONS_START);
		const endIdx = content.indexOf(REFLECTIONS_END);

		if (startIdx === -1 || endIdx === -1) return null;

		return content.slice(startIdx + REFLECTIONS_START.length, endIdx).trim();
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

function basename(p: string): string {
	const last = p.replace(/\\/g, "/").split("/").pop() ?? p;
	return last;
}
