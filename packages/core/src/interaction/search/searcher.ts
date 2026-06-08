/**
 * SessionSearcher — the public entry point for Session Search.
 *
 * Callers (CLI command, TUI) only ever import from this file. The
 * scanner, parser, and noise filters are implementation details.
 *
 * Slice 1 (#83): scan → parse → return.
 * Slice 2 (#84): noise filtering parity with the Claude Code adapter.
 *   Files that fail the per-file noise check (sidechain transcripts,
 *   micro-files) have their hits dropped. Each unique file is peeked
 *   ONCE per search and the result reused across all hits from that
 *   file.
 * Slice 3 (#85) will add sort + snippet + per-file caps polish.
 */

import { scanWithRipgrep } from "./ripgrep-scanner.js";
import { parseHit } from "./hit-parser.js";
import { peekFile, isNoiseFile, type PeekedFile } from "./noise-filters.js";
import type { SearchOptions, SessionHit } from "./types.js";

/**
 * Search every Source Session for full-content matches of `query`.
 *
 * Returns one SessionHit per matching message. Empty query returns [].
 * Hits from noise files (sidechain / micro) are filtered out.
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

	// Peek each unique file exactly once. ripgrep can return many hits
	// from the same file (when the query matches multiple messages),
	// and peeking the same file repeatedly would be wasted disk I/O.
	const uniqueFiles = new Set(rawHits.map((h) => h.filePath));
	const peekCache = new Map<string, PeekedFile>();
	await Promise.all(
		[...uniqueFiles].map(async (filePath) => {
			const peeked = await peekFile(filePath);
			peekCache.set(filePath, peeked);
		}),
	);

	const hits: SessionHit[] = [];
	for (const raw of rawHits) {
		const peeked = peekCache.get(raw.filePath);
		// Defensive: if for some reason the peek isn't cached, treat
		// the file as noise and skip. This shouldn't happen.
		if (!peeked || isNoiseFile(peeked)) continue;

		const parsed = parseHit(raw);
		if (parsed) hits.push(parsed);
	}

	return hits;
}
