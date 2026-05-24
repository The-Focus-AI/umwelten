/**
 * Project-local digest persistence.
 *
 * Digests live at <projectPath>/.umwelten/digests/sessions/<encoded-id>.json.
 * One file per Source Session id. URL-encoded so prefixed ids
 * (piloc:/abs/path:filename.jsonl) survive across platforms.
 *
 * This is the single canonical home for digest read/write — the extraction
 * engine, the dashboard, the detail view, and the digest-live TUI all
 * route through these helpers.
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SessionDigest } from "./analysis-types.js";

function digestFilename(sessionId: string): string {
	return `${encodeURIComponent(sessionId)}.json`;
}

/**
 * Path convention: digests are written to
 *   <project>/.umwelten/digests/sessions/<encoded-id>.json
 */
export function getDigestPath(
	projectPath: string,
	sessionId: string,
): string {
	return join(
		projectPath,
		".umwelten",
		"digests",
		"sessions",
		digestFilename(sessionId),
	);
}

/**
 * Read a digest by session id. Returns null on any read or parse error
 * (missing file, malformed JSON, permission error). Callers should treat
 * null as "no digest yet".
 */
export async function loadDigest(
	projectPath: string,
	sessionId: string,
): Promise<SessionDigest | null> {
	try {
		const text = await readFile(
			getDigestPath(projectPath, sessionId),
			"utf-8",
		);
		return JSON.parse(text) as SessionDigest;
	} catch {
		return null;
	}
}

/**
 * Write a digest to disk. Creates the parent directory as needed.
 * Returns the full path on success.
 */
export async function saveDigest(
	projectPath: string,
	digest: SessionDigest,
): Promise<string> {
	const path = getDigestPath(projectPath, digest.sessionId);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(digest, null, 2), "utf-8");
	return path;
}
