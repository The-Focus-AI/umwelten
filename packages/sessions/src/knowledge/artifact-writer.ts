/**
 * Artifact Writer
 *
 * Creates dated output artifacts under `.umwelten/artifacts/`.
 * Supports Markdown and HTML formats.
 *
 * Filename format: YYYY-MM-DD-slug.md  or  YYYY-MM-DD-slug.html
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { slugify } from "./saved-reflection-writer.js";

/**
 * Supported artifact output formats.
 */
export type ArtifactFormat = "md" | "html";

/**
 * Options for writing an artifact.
 */
export interface ArtifactOptions {
	/** Human-readable title used for the filename slug. */
	title: string;
	/** File body content (Markdown or HTML). */
	content: string;
	/** Output format. */
	format: ArtifactFormat;
}

/**
 * Write a dated artifact to disk.
 *
 * Creates the artifacts directory if it doesn't exist.
 * Filename format: YYYY-MM-DD-slug.{md,html}
 *
 * Returns the absolute path to the written file.
 */
export async function writeArtifact(
	artifactsDir: string,
	options: ArtifactOptions,
): Promise<string> {
	const { title, content, format } = options;

	const dateStr = new Date().toISOString().slice(0, 10);
	const slug = slugify(title);
	const filename = `${dateStr}-${slug}.${format}`;
	const filePath = join(artifactsDir, filename);

	await mkdir(artifactsDir, { recursive: true });

	const body = format === "html" ? buildHtmlDocument(title, content) : content;

	await writeFile(filePath, body, "utf-8");
	return filePath;
}

/**
 * List artifact file names (newest first), optionally filtered by format.
 */
export async function listArtifacts(
	artifactsDir: string,
	format?: ArtifactFormat,
): Promise<string[]> {
	const { readdir } = await import("node:fs/promises");
	try {
		const files = await readdir(artifactsDir);
		return files
			.filter((f) => {
				if (!format) return f.endsWith(".md") || f.endsWith(".html");
				return f.endsWith(`.${format}`);
			})
			.sort()
			.reverse();
	} catch {
		return [];
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────

function buildHtmlDocument(title: string, bodyContent: string): string {
	const escapedTitle = title
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedTitle}</title>
</head>
<body>
${bodyContent}
</body>
</html>`;
}
