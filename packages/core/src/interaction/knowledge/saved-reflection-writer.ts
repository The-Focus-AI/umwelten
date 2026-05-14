/**
 * Saved Reflection Writer
 *
 * Persists reflection answers as dated Markdown files under
 * `.umwelten/reflections/YYYY-MM-DD-slug.md`.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Options for writing a saved reflection.
 */
export interface SavedReflectionOptions {
	/** Human-readable title for the reflection file and frontmatter. */
	title: string;
	/** Markdown body content. */
	content: string;
	/** Optional ID of the Source Session or Exploration that prompted this reflection. */
	sourceId?: string;
	/** Optional tag to identify the reflection kind (e.g. "what-we-learned", "post-mortem"). */
	tag?: string;
}

/**
 * Generate a slug from a title string.
 */
export function slugify(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

/**
 * Write a saved reflection to disk.
 *
 * Creates the reflections directory if it doesn't exist.
 * Filename format: YYYY-MM-DD-slug.md
 *
 * Returns the absolute path to the written file.
 */
export async function writeSavedReflection(
	reflectionsDir: string,
	options: SavedReflectionOptions,
): Promise<string> {
	const { title, content, sourceId, tag } = options;

	const now = new Date();
	const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
	const slug = slugify(title);
	const filename = `${dateStr}-${slug}.md`;
	const filePath = join(reflectionsDir, filename);

	await mkdir(reflectionsDir, { recursive: true });

	// Build frontmatter
	const frontmatter = [
		"---",
		`title: "${escapeYaml(title)}"`,
		`date: ${now.toISOString()}`,
		...(sourceId ? [`source: ${escapeYaml(sourceId)}`] : []),
		...(tag ? [`tag: ${escapeYaml(tag)}`] : []),
		"---",
		"",
	].join("\n");

	const body = [frontmatter, content.trimEnd(), ""].join("\n");

	await writeFile(filePath, body, "utf-8");
	return filePath;
}

/**
 * List saved reflection file names (newest first).
 */
export async function listSavedReflections(
	reflectionsDir: string,
): Promise<string[]> {
	const { readdir } = await import("node:fs/promises");
	try {
		const files = await readdir(reflectionsDir);
		return files
			.filter((f) => f.endsWith(".md"))
			.sort()
			.reverse();
	} catch {
		return [];
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────

function escapeYaml(value: string): string {
	if (/[:#"'\n]/.test(value)) {
		return JSON.stringify(value);
	}
	return value;
}
