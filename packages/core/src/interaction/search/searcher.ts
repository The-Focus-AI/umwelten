/**
 * SessionSearcher — the public entry point for Session Search.
 *
 * Callers (CLI command, TUI) only ever import from this file. The
 * scanner and parser are implementation details.
 *
 * Slice 1: scan → parse → return. No sorting, no snippet polish —
 * that's slice 3.
 */

import { scanWithRipgrep } from "./ripgrep-scanner.js";
import { parseHit } from "./hit-parser.js";
import type { SearchOptions, SessionHit } from "./types.js";

/**
 * Search every Source Session for full-content matches of `query`.
 *
 * Returns one SessionHit per matching message. Empty query returns [].
 *
 * Throws RipgrepNotFoundError if `rg` isn't on PATH.
 */
export async function searchSessions(
	query: string,
	options: SearchOptions = {},
): Promise<SessionHit[]> {
	const trimmed = query.trim();
	if (!trimmed) return [];

	const rawHits = await scanWithRipgrep(trimmed, options);

	const hits: SessionHit[] = [];
	for (const raw of rawHits) {
		const parsed = parseHit(raw);
		if (parsed) hits.push(parsed);
	}

	return hits;
}
