/**
 * Domain types for the Exploration-centered session knowledge workflow.
 *
 * These types sit above the existing NormalizedSession and Interaction:
 *   - Source Session = tool-specific persisted history artifact
 *   - Interaction   = flat model-facing conversation passed to the runner
 *   - Exploration   = queryable grouping of Source Sessions
 *
 * See CONTEXT.md for the full domain language.
 * See docs/adr/0001-*.md for pi session tree → Exploration projection.
 */

import type { SessionSource } from "./normalized-types.js";

// ── Source Session ──────────────────────────────────────────────────────

/**
 * Source session kind — the tool that produced this session.
 */
export type SourceSessionKind = SessionSource;

/**
 * Aggregated metrics for a source session.
 */
export interface SourceSessionMetrics {
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	totalTokens?: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	estimatedCost?: number;
}

/**
 * Source Session — tool-specific persisted history artifact.
 *
 * A Source Session is the raw material produced by an AI coding tool
 * (pi, Claude Code, Cursor, Habitat, etc.). It is NOT an Interaction
 * (flat, model-facing conversation). A single Source Session may
 * produce zero, one, or many Interactions when projected.
 *
 * The existing NormalizedSession maps directly here. Adapters such
 * as ClaudeCodeAdapter, CursorAdapter, and (future) PiSessionAdapter
 * produce SourceSessions from their discovery and parse methods.
 */
export interface SourceSession {
	/** Globally unique identifier across sources */
	id: string;

	/** The tool that produced this session */
	source: SourceSessionKind;

	/** Original identifier from the source tool */
	sourceId: string;

	/** Human-readable title (derived or from source metadata) */
	title: string;

	/** Project path this session belongs to */
	projectPath?: string;

	/** Git branch at time of session */
	gitBranch?: string;

	/** Git repository name */
	gitRepo?: string;

	/** Creation timestamp (ISO 8601) */
	created: string;

	/** Last modified timestamp (ISO 8601) */
	modified: string;

	/** Number of messages in this session */
	messageCount: number;

	/** First user prompt (for display / search) */
	firstPrompt: string;

	/** Aggregated metrics if available */
	metrics?: SourceSessionMetrics;

	/** Source-specific metadata preserved for adapter use */
	sourceData?: Record<string, unknown>;
}

// ── Exploration ─────────────────────────────────────────────────────────

/**
 * Exploration kind — how the Exploration was created.
 */
export type ExplorationKind = "default" | "virtual" | "saved";

/**
 * Exploration member reference type.
 *
 * V1 uses 'reference' members only. 'snapshot' is reserved so the
 * schema can later embed session content directly when needed.
 */
export type ExplorationMemberKind = "reference";

/**
 * A single member of an Exploration.
 *
 * In v1 every member is a reference to a Source Session by ID.
 * The `source` field is kept for display filtering without
 * having to resolve the referenced session immediately.
 */
export interface ExplorationMember {
	/** Member kind — 'reference' in v1 */
	kind: ExplorationMemberKind;

	/** The Source Session this member references */
	sourceSessionId: string;

	/** Source kind for display / filtering */
	source: SourceSessionKind;

	/** Optional label for this member within the exploration */
	label?: string;
}

/**
 * Exploration — a queryable grouping of Source Sessions.
 *
 * Every Source Session initially belongs to one default Exploration.
 * Search results form virtual Explorations.
 * Saved Explorations persist the grouping to disk under `.umwelten/`.
 */
export interface Exploration {
	/** Globally unique identifier */
	id: string;

	/** Human-readable name */
	name: string;

	/** How this Exploration was created */
	kind: ExplorationKind;

	/** Members (references to Source Sessions) */
	members: ExplorationMember[];

	/** Creation timestamp (ISO 8601) */
	created: string;

	/** Last modified timestamp (ISO 8601) */
	modified: string;

	/** Total member count */
	memberCount: number;

	/** Virtual only — the search query that produced this exploration */
	searchQuery?: string;

	/** Saved only — filesystem path to the saved file */
	savedPath?: string;
}

// ── Saved Exploration ───────────────────────────────────────────────────

/**
 * Saved Exploration — a persisted Exploration file.
 *
 * Stored as versioned JSON under `.umwelten/explorations/<id>.json`.
 * The `version` field ensures forward compatibility as the schema
 * evolves (e.g. from reference-only to mixed reference/snapshot).
 */
export interface SavedExploration {
	/** Schema version — increment when shape changes incompatibly */
	version: 1;

	/** Unique identifier — same as the file stem */
	id: string;

	/** Human-readable name */
	name: string;

	/** When this exploration was persisted (ISO 8601) */
	saved: string;

	/** Members — references in v1, future snapshots in later versions */
	members: ExplorationMember[];
}

// ── Discovery options ───────────────────────────────────────────────────

/**
 * Options for discovering Explorations.
 */
export interface ExplorationDiscoveryOptions {
	projectPath?: string;
	since?: string;
	until?: string;
	kind?: ExplorationKind;
	limit?: number;
}

// ── Factory helpers ─────────────────────────────────────────────────────

/**
 * Result of creating a default Exploration from a Source Session.
 */
export interface DefaultExplorationResult {
	exploration: Exploration;
	sourceSession: SourceSession;
}

/**
 * Create a default Exploration from a Source Session.
 *
 * Every Source Session gets exactly one default Exploration.
 * The Exploration name falls back from title → firstPrompt → a
 * generic label.
 */
export function createDefaultExploration(
	session: SourceSession,
): DefaultExplorationResult {
	const exploration: Exploration = {
		id: `exp-default-${session.id}`,
		name: session.title || session.firstPrompt || `Session ${session.id}`,
		kind: "default",
		members: [
			{
				kind: "reference",
				sourceSessionId: session.id,
				source: session.source,
			},
		],
		created: session.created,
		modified: session.modified,
		memberCount: 1,
	};

	return { exploration, sourceSession: session };
}

/**
 * Create a virtual Exploration from a search query and matching sessions.
 */
export function createVirtualExploration(
	query: string,
	sessions: SourceSession[],
): Exploration {
	return {
		id: `exp-virtual-${Date.now()}`,
		name: `Search: ${query}`,
		kind: "virtual",
		members: sessions.map((s) => ({
			kind: "reference" as const,
			sourceSessionId: s.id,
			source: s.source,
		})),
		created: new Date().toISOString(),
		modified: new Date().toISOString(),
		memberCount: sessions.length,
		searchQuery: query,
	};
}

// ── Exploration Browser data shape ──────────────────────────────────────

/**
 * One entry in an analysis-run tally for a session.
 *
 * Kept here (rather than in @umwelten/sessions/introspection) so the
 * ExplorationBrowserEntry shape can travel with the rest of the domain
 * types and TUI consumers (in @umwelten/ui) don't need to depend on the
 * sessions package.
 */
export interface ExplorationAnalysisRun {
	runId: string;
	runCreatedAt: string;
	tally: {
		total: number;
		accepted: number;
		skipped: number;
		pending: number;
	};
	/** Subset of proposals whose evidence matched this session. Heuristic. */
	attributedProposals: Array<{
		/** "workflowRule" | "architectureFact" | "gotcha" — kept as string here
		 * so the core package doesn't depend on the sessions enum. */
		kind: string;
		head: string;
		verdict?: "accepted" | "skipped";
	}>;
}

/**
 * Date window for the Exploration Browser filter.
 */
export type DateWindow = "24h" | "7d" | "30d" | "all";

/**
 * Status filter for the Exploration Browser.
 */
export type StatusFilter =
	| "all"
	| "unanalyzed"
	| "pending"
	| "decided"
	| "fresh"
	| "digested"
	| "undigested";

/**
 * Source filter — narrows to one adapter, or "all".
 */
export type SourceFilter = "all" | SourceSessionKind;

/**
 * Filter state for the Exploration Browser.
 */
export interface FilterState {
	date: DateWindow;
	status: StatusFilter;
	source: SourceFilter;
	query: string;
}

/**
 * Browser entry wrapping an Exploration with browser-specific metadata.
 *
 * Used by the Exploration Browser (DashboardApp in @umwelten/ui) and
 * built by buildExploreBrowse in @umwelten/sessions/introspection.
 */
export interface ExplorationBrowserEntry {
	/** The Exploration (domain grouping). */
	exploration: Exploration;
	/** The underlying Source Session metadata. */
	sourceSession: SourceSession;
	/** Modified timestamp in ms (for sorting). */
	modifiedMs: number;
	/** Full path to the session file for transcript/beats views. */
	filePath?: string;
	/** Digest data if available. */
	digest?: import("../analysis/analysis-types.js").SessionDigest | null;
	/** Analysis runs that included this session. */
	analyzedIn: ExplorationAnalysisRun[];
	modifiedSinceAnalysis: boolean;
	everAnalyzed: boolean;
}

/**
 * Filter Exploration browser entries by date, source, status, and text query.
 *
 * Pure function — no I/O. Lives here in core so TUI consumers (in
 * @umwelten/ui) don't need to depend on @umwelten/sessions just to filter.
 */
export function applyExploreFilter(
	entries: ExplorationBrowserEntry[],
	f: FilterState,
): ExplorationBrowserEntry[] {
	let cutoff = 0;
	const now = Date.now();
	switch (f.date) {
		case "24h":
			cutoff = now - 24 * 60 * 60 * 1000;
			break;
		case "7d":
			cutoff = now - 7 * 24 * 60 * 60 * 1000;
			break;
		case "30d":
			cutoff = now - 30 * 24 * 60 * 60 * 1000;
			break;
		case "all":
			cutoff = 0;
			break;
	}

	const q = f.query.trim().toLowerCase();
	return entries.filter((e) => {
		if (e.modifiedMs < cutoff) return false;
		if (f.source !== "all" && e.sourceSession.source !== f.source) return false;
		if (f.status === "unanalyzed" && e.everAnalyzed) return false;
		if (f.status === "pending") {
			if (!e.analyzedIn.some((a) => a.tally.pending > 0)) return false;
		}
		if (f.status === "decided") {
			if (!e.everAnalyzed) return false;
			if (e.analyzedIn.some((a) => a.tally.pending > 0)) return false;
		}
		if (f.status === "fresh" && !(e.modifiedSinceAnalysis || !e.everAnalyzed))
			return false;
		if (f.status === "digested" && !e.digest) return false;
		if (f.status === "undigested" && e.digest) return false;
		if (q) {
			const hay = [
				e.exploration.name,
				e.sourceSession.id,
				e.digest?.overallSummary ?? "",
				...(e.digest?.analysis.tags ?? []),
				...(e.digest?.analysis.topics ?? []),
			]
				.join(" ")
				.toLowerCase();
			if (!hay.includes(q)) return false;
		}
		return true;
	});
}
