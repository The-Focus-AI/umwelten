/**
 * Back-compat shim — introspection moved to `@umwelten/sessions`.
 * Existing consumers (TUI components, evaluation barrel) keep working
 * via this re-export.
 */
export {
	buildBrowse,
	applyFilter,
	loadDigest,
	saveDigest,
	getDigestPath,
} from "@umwelten/sessions/introspection/browse.js";
export type {
	SessionBrowserEntry,
	BuildBrowseOptions,
	DateWindow,
	StatusFilter,
	SourceFilter,
	FilterState,
	SessionSourceKind,
} from "@umwelten/sessions/introspection/browse.js";
