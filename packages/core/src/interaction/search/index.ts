/**
 * Session Search — system-wide full-content search across every
 * Source Session on disk.
 *
 * Public surface:
 *  - `searchSessions(query, opts)` — primary entry point
 *  - Types: SessionHit, SearchOptions, ScanOptions, RawScanHit
 *  - Errors: RipgrepNotFoundError
 *
 * Implementation details (scanner, parser, default roots) are
 * exported too so power users / tests can reach in, but most
 * callers should use only `searchSessions`.
 *
 * See PRD #82 and ADR docs/adr/0002-session-search-shells-out-to-ripgrep.md.
 */

export { searchSessions } from "./searcher.js";
export { scanWithRipgrep, defaultSearchRoots } from "./ripgrep-scanner.js";
export { parseHit, decodeProjectDirName, extractMessageText } from "./hit-parser.js";
export {
	type RawScanHit,
	type SessionHit,
	type ScanOptions,
	type SearchOptions,
	RipgrepNotFoundError,
} from "./types.js";
