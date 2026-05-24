import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	loadRun,
	listRuns,
	readDecisions,
	tallyRun,
	normalizeKey,
} from "./storage.js";
import type {
	IntrospectionRun,
	DecisionLogEntry,
	DecisionKind,
} from "./types.js";
import { projectSessions } from "@umwelten/core/interaction/projection/index.js";
import { createVirtualExploration } from "@umwelten/core/interaction/types/domain-types.js";
import type {
	Exploration,
	SourceSession,
} from "@umwelten/core/interaction/types/domain-types.js";
import type { SessionDigest } from "@umwelten/core/interaction/analysis/analysis-types.js";

export type SessionSourceKind = "claude-code" | "habitat" | "pi";

function digestFilename(sessionId: string): string {
	return `${encodeURIComponent(sessionId)}.json`;
}

/** Path convention: digests are written to <project>/.umwelten/digests/sessions/<encoded-id>.json */
export function getDigestPath(projectPath: string, sessionId: string): string {
	return join(
		projectPath,
		".umwelten",
		"digests",
		"sessions",
		digestFilename(sessionId),
	);
}

export async function loadDigest(
	projectPath: string,
	sessionId: string,
): Promise<SessionDigest | null> {
	try {
		const text = await readFile(getDigestPath(projectPath, sessionId), "utf-8");
		return JSON.parse(text) as SessionDigest;
	} catch {
		return null;
	}
}

export async function saveDigest(
	projectPath: string,
	digest: SessionDigest,
): Promise<string> {
	const { mkdir, writeFile } = await import("node:fs/promises");
	const { dirname } = await import("node:path");
	const path = getDigestPath(projectPath, digest.sessionId);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(digest, null, 2), "utf-8");
	return path;
}

/**
 * One row in the browser: a session plus every time it has been analyzed.
 */
export interface SessionBrowserEntry {
	id: string;
	source: SessionSourceKind;
	/** Full path to the .jsonl file (for passing to analyze / sessions tui). */
	filePath: string;
	/** File mtime — "last activity" on the session. */
	modifiedISO: string;
	modifiedMs: number;
	/** First user prompt, truncated. Useful as a title. */
	firstPrompt: string;
	messageCount: number;
	gitBranch?: string;

	/** Every run that included this session, newest first.
	 * Same shape as ExplorationAnalysisRun (kind is `string`, not the strict
	 * DecisionKind union, so downstream renderers don't need to know the
	 * sessions package enum). */
	analyzedIn: ExplorationAnalysisRun[];

	/** True if session mtime > most-recent-run.createdAt (something new since last analysis). */
	modifiedSinceAnalysis: boolean;
	/** Cached for quick filtering. */
	everAnalyzed: boolean;

	/** Digest output (topics, tags, summary, key learnings, segments, facts) if the session has been digested. */
	digest?: SessionDigest | null;
}

function matchSessionInRun(run: IntrospectionRun, sessionId: string): boolean {
	// run.sessions stores the session id (short ids like '7c917069-...' or 'claude-code:...'-prefixed).
	// Normalize both to first 8 chars for the match since that's what we print.
	const short = sessionId.slice(0, 8);
	return run.sessions.some((s) => s.id.startsWith(short) || s.id === sessionId);
}

function attributeProposalToSession(
	run: IntrospectionRun,
	sessionFirstPromptLower: string,
): Array<{ kind: DecisionKind; head: string }> {
	const matches: Array<{ kind: DecisionKind; head: string }> = [];
	const check = (evidence: string[]): boolean => {
		for (const q of evidence) {
			const needle = q.trim().slice(0, 40).toLowerCase();
			if (!needle) continue;
			if (sessionFirstPromptLower.includes(needle)) return true;
		}
		return false;
	};
	for (const r of run.result.workflowRules)
		if (check(r.evidence)) matches.push({ kind: "workflowRule", head: r.rule });
	for (const f of run.result.architectureFacts)
		if (check(f.evidence))
			matches.push({ kind: "architectureFact", head: f.fact });
	for (const g of run.result.gotchas)
		if (check(g.evidence)) matches.push({ kind: "gotcha", head: g.issue });
	return matches;
}

function verdictForProposal(
	decisions: DecisionLogEntry[],
	kind: DecisionKind,
	head: string,
): "accepted" | "skipped" | undefined {
	const key = normalizeKey(head);
	return decisions.find((d) => d.kind === kind && d.key === key)?.verdict;
}

export interface BuildBrowseOptions {
	projectPath: string;
	/** Optional habitat sessions root. When set, every <dir>/<id>/transcript.jsonl is pulled in. */
	sessionsDir?: string;
}

// ── Exploration-oriented browser (v2) ───────────────────────────────────

/**
 * Re-exported from @umwelten/core so the type lives next to the rest of
 * the Exploration domain model and TUI consumers (in @umwelten/ui) don't
 * have to depend on the sessions package.
 */
import type {
	ExplorationBrowserEntry,
	ExplorationAnalysisRun,
} from "@umwelten/core/interaction/types/domain-types.js";
export type {
	ExplorationBrowserEntry,
	ExplorationAnalysisRun,
} from "@umwelten/core/interaction/types/domain-types.js";

/**
 * Build an Exploration-oriented browser for a project.
 *
 * Uses the projection layer to discover sessions from all registered
 * adapters (Claude Code, pi, Cursor, Habitat) and wraps each default
 * Exploration with browser metadata (digests, analysis runs).
 */

/**
 * Resolve a session file path from source metadata.
 * Used by buildExploreBrowse to enable transcript/beats views.
 */
export function resolveSessionFilePath(
	source: SourceSession["source"],
	_sessionId: string,
	sourceData?: Record<string, unknown>,
): string | undefined {
	const explicitFilePath = sourceData?.["filePath"];
	if (typeof explicitFilePath === "string" && explicitFilePath.length > 0) {
		return explicitFilePath;
	}

	// pi sessions: reconstruct from sourceData for older entries that do not
	// carry an explicit file path.
	if (source === "pi" && sourceData) {
		const filename = sourceData["filename"] as string | undefined;
		if (!filename) return undefined;
		const cwd = (sourceData["cwd"] as string) ?? "";
		const encoded = "--" + cwd.replace(/\//g, "-").replace(/^-/, "") + "--";
		return join(homedir(), ".pi", "agent", "sessions", encoded, filename);
	}

	// claude-code sessions: file path resolution needs the original project path
	// which isn't available in the projection context. Fall back to undefined;
	// caller handles gracefully by disabling transcript/beats for these.

	return undefined;
}

export async function buildExploreBrowse(opts: BuildBrowseOptions): Promise<{
	entries: ExplorationBrowserEntry[];
	runs: IntrospectionRun[];
}> {
	const { projectPath } = opts;

	// ---- 1. Project all sessions into Explorations ----
	const projection = await projectSessions(projectPath);

	// ---- 2. Load all runs + decisions for analysis matching ----
	const runIds = await listRuns(projectPath);
	const runs: IntrospectionRun[] = [];
	for (const id of runIds) {
		const run = await loadRun(projectPath, id);
		if (run) runs.push(run);
	}
	const decisions = await readDecisions(projectPath);

	// ---- 3. Build browser entries from explorations ----
	const entries: ExplorationBrowserEntry[] = [];
	const sourceSessionsById = new Map(
		projection.sourceSessions.map((session) => [session.id, session]),
	);

	for (const projectionSource of projection.sources) {
		for (const exploration of projection.explorations) {
			// Only process explorations from this source
			if (exploration.members[0]?.source !== projectionSource.source) continue;

			const member = exploration.members[0];
			if (!member) continue;

			// Resolve modifiedMs from the exploration's timestamps
			const modifiedMs = new Date(exploration.modified).getTime();

			const sourceSession: SourceSession = sourceSessionsById.get(
				member.sourceSessionId,
			) ?? {
				id: member.sourceSessionId,
				source: member.source,
				sourceId: member.sourceSessionId,
				title: exploration.name,
				created: exploration.created,
				modified: exploration.modified,
				messageCount: 0,
				firstPrompt: exploration.name,
			};

			// Match analysis runs by source session ID
			const sessionIdForMatch = member.sourceSessionId;
			const sessionFirstPromptLower = exploration.name.toLowerCase();
			const analyzedIn: ExplorationAnalysisRun[] = [];
			for (const run of runs) {
				if (!matchSessionInRun(run, sessionIdForMatch)) continue;
				const attributedRaw = attributeProposalToSession(
					run,
					sessionFirstPromptLower,
				);
				const attributed = attributedRaw.map((a) => ({
					...a,
					verdict: verdictForProposal(decisions, a.kind, a.head),
				}));
				analyzedIn.push({
					runId: run.runId,
					runCreatedAt: run.createdAt,
					tally: tallyRun(run, decisions),
					attributedProposals: attributed,
				});
			}
			analyzedIn.sort((a, b) => (a.runCreatedAt < b.runCreatedAt ? 1 : -1));

			const lastAnalyzedAt = analyzedIn[0]?.runCreatedAt;
			const modifiedSinceAnalysis = lastAnalyzedAt
				? modifiedMs > new Date(lastAnalyzedAt).getTime()
				: false;

			const everAnalyzed = analyzedIn.length > 0;

			// Resolve file path for transcript/beats views when possible
			const filePath = resolveSessionFilePath(
				member.source,
				member.sourceSessionId,
				sourceSession.sourceData,
			);

			entries.push({
				exploration,
				sourceSession,
				modifiedMs,
				filePath,
				analyzedIn,
				modifiedSinceAnalysis,
				everAnalyzed,
			});
		}
	}

	// ---- 4. Load digests in parallel ----
	await Promise.all(
		entries.map(async (e) => {
			e.digest = await loadDigest(projectPath, e.sourceSession.id);
		}),
	);

	entries.sort((a, b) => b.modifiedMs - a.modifiedMs);
	return { entries, runs };
}

// ── Search-to-Exploration ──────────────────────────────────────────────

/**
 * Result of a search that produced a virtual Exploration.
 */
export interface VirtualExplorationResult {
	/** The virtual Exploration created from search results. */
	exploration: Exploration;
	/** The query that produced it. */
	query: string;
	/** The matching browser entries. */
	matches: ExplorationBrowserEntry[];
	/** Total entries searched. */
	totalSearched: number;
}

/**
 * Create a virtual Exploration from a search query against browser entries.
 *
 * Filters entries by the query text against exploration name, session ID,
 * digest tags, and digest topics. Wraps the matches in a virtual Exploration
 * with the query preserved as metadata.
 */
export function searchToVirtualExploration(
	entries: ExplorationBrowserEntry[],
	query: string,
): VirtualExplorationResult {
	const q = query.trim().toLowerCase();
	if (!q) {
		return {
			exploration: {
				id: `exp-virtual-empty-${Date.now()}`,
				name: "Search: (empty query)",
				kind: "virtual",
				members: [],
				created: new Date().toISOString(),
				modified: new Date().toISOString(),
				memberCount: 0,
				searchQuery: query,
			},
			query,
			matches: [],
			totalSearched: entries.length,
		};
	}

	const matches = entries.filter((e) => {
		const hay = [
			e.exploration.name,
			e.sourceSession.id,
			e.digest?.overallSummary ?? "",
			...(e.digest?.analysis.tags ?? []),
			...(e.digest?.analysis.topics ?? []),
		]
			.join(" ")
			.toLowerCase();
		return hay.includes(q);
	});

	const sourceSessions: SourceSession[] = matches.map((m) => m.sourceSession);
	const exploration = createVirtualExploration(query, sourceSessions);

	return { exploration, query, matches, totalSearched: entries.length };
}

// ---- Filtering (re-exports from core) ----

export type {
	DateWindow,
	StatusFilter,
	SourceFilter,
	FilterState,
} from "@umwelten/core/interaction/types/domain-types.js";
export { applyExploreFilter } from "@umwelten/core/interaction/types/domain-types.js";
