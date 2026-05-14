/**
 * @umwelten/sessions — Session browsing, search, digest, learnings, transcripts.
 *
 * Wraps the digest pipeline in `@umwelten/core/interaction/analysis/` with
 * commander-based CLI commands and a session-browser data layer.
 */

// CLI commands (registered by @umwelten/cli)
export { sessionsCommand } from "./sessions.js";
export { introspectCommand, browseCommand, runBrowseAction } from "./introspect.js";

// Session-browser data layer (consumed by TUI components)
export {
	buildBrowse,
	applyFilter,
	buildExploreBrowse,
	applyExploreFilter,
	loadDigest,
	saveDigest,
	getDigestPath,
} from "./introspection/browse.js";
export type {
	SessionBrowserEntry,
	ExplorationBrowserEntry,
	BuildBrowseOptions,
	DateWindow,
	StatusFilter,
	SourceFilter,
	FilterState,
	SessionSourceKind,
} from "./introspection/browse.js";
