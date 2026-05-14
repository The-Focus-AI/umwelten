import { stat, readFile } from "node:fs/promises";
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
import {
	discoverSessionFilesInProject,
	buildSessionEntryFromFile,
} from "@umwelten/core/interaction/persistence/session-store.js";
import { projectSessions } from "@umwelten/core/interaction/projection/index.js";
import type {
	Exploration,
	SourceSession,
} from "@umwelten/core/interaction/types/domain-types.js";
import type { SessionDigest } from "@umwelten/core/interaction/analysis/analysis-types.js";

export type SessionSourceKind = "claude-code" | "habitat" | "pi";

/** Path convention: digests are written to ~/.umwelten/digests/sessions/<id>.json */
export function getDigestPath(sessionId: string): string {
	return join(
		homedir(),
		".umwelten",
		"digests",
		"sessions",
		`${sessionId}.json`,
	);
}

export async function loadDigest(
	sessionId: string,
): Promise<SessionDigest | null> {
	try {
		const text = await readFile(getDigestPath(sessionId), "utf-8");
		return JSON.parse(text) as SessionDigest;
	} catch {
		return null;
	}
}

export async function saveDigest(digest: SessionDigest): Promise<string> {
	const { mkdir, writeFile } = await import("node:fs/promises");
	const { dirname } = await import("node:path");
	const path = getDigestPath(digest.sessionId);
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

	/** Every run that included this session, newest first. */
	analyzedIn: Array<{
		runId: string;
		runCreatedAt: string;
		tally: {
			total: number;
			accepted: number;
			skipped: number;
			pending: number;
		};
		/** Subset of proposals whose evidence matched this session. Heuristic, not ground truth. */
		attributedProposals: Array<{
			kind: DecisionKind;
			head: string;
			verdict?: "accepted" | "skipped";
		}>;
	}>;

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

export async function buildBrowse(
	opts: BuildBrowseOptions,
): Promise<{ entries: SessionBrowserEntry[]; runs: IntrospectionRun[] }> {
	const { projectPath, sessionsDir } = opts;

	// ---- 1. Collect all claude-code session files ----
	const ccFiles = await discoverSessionFilesInProject(projectPath);
	const ccEntries: Array<
		Omit<
			SessionBrowserEntry,
			"analyzedIn" | "modifiedSinceAnalysis" | "everAnalyzed"
		>
	> = [];
	for (const filePath of ccFiles) {
		const entry = await buildSessionEntryFromFile(filePath, projectPath);
		if (!entry) continue;
		let modifiedMs = 0;
		try {
			const st = await stat(filePath);
			modifiedMs = st.mtimeMs;
		} catch {
			continue;
		}
		ccEntries.push({
			id: entry.sessionId,
			source: "claude-code",
			filePath,
			modifiedISO: new Date(modifiedMs).toISOString(),
			modifiedMs,
			firstPrompt: entry.firstPrompt || "(no prompt)",
			messageCount: entry.messageCount,
			gitBranch: entry.gitBranch,
		});
	}

	// ---- 2. Collect habitat sessions if dir given ----
	const habitatEntries: typeof ccEntries = [];
	if (sessionsDir) {
		const { readdir } = await import("node:fs/promises");
		let names: string[] = [];
		try {
			names = await readdir(sessionsDir);
		} catch {
			// no habitat sessions
		}
		for (const name of names) {
			const filePath = join(sessionsDir, name, "transcript.jsonl");
			let modifiedMs = 0;
			try {
				const st = await stat(filePath);
				modifiedMs = st.mtimeMs;
			} catch {
				continue;
			}
			// Minimal firstPrompt extraction — streamed parse of first user message
			const { parseSessionFileMetadata } = await import(
				"@umwelten/core/interaction/persistence/session-parser.js"
			);
			const meta = await parseSessionFileMetadata(filePath, modifiedMs);
			if (!meta) continue;
			habitatEntries.push({
				id: name,
				source: "habitat",
				filePath,
				modifiedISO: new Date(modifiedMs).toISOString(),
				modifiedMs,
				firstPrompt: meta.firstPrompt || "(no prompt)",
				messageCount: meta.messageCount,
				gitBranch: meta.gitBranch,
			});
		}
	}

	// ---- 3. Load all runs + decisions once for reverse-index ----
	const runIds = await listRuns(projectPath);
	const runs: IntrospectionRun[] = [];
	for (const id of runIds) {
		const run = await loadRun(projectPath, id);
		if (run) runs.push(run);
	}
	const decisions = await readDecisions(projectPath);

	// ---- 4. Stitch: for each session, which runs included it? ----
	const all = [...ccEntries, ...habitatEntries];
	const entries: SessionBrowserEntry[] = all.map((s) => {
		const sessionFirstPromptLower = s.firstPrompt.toLowerCase();
		const analyzedIn: SessionBrowserEntry["analyzedIn"] = [];
		for (const run of runs) {
			if (!matchSessionInRun(run, s.id)) continue;
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
		// Sort newest-first
		analyzedIn.sort((a, b) => (a.runCreatedAt < b.runCreatedAt ? 1 : -1));

		const lastAnalyzedAt = analyzedIn[0]?.runCreatedAt;
		const modifiedSinceAnalysis = lastAnalyzedAt
			? s.modifiedMs > new Date(lastAnalyzedAt).getTime()
			: false;

		return {
			...s,
			analyzedIn,
			modifiedSinceAnalysis,
			everAnalyzed: analyzedIn.length > 0,
		};
	});

	// ---- 5. Load digests in parallel (cheap filesystem reads; missing is fine) ----
	await Promise.all(
		entries.map(async (e) => {
			e.digest = await loadDigest(e.id);
		}),
	);

	entries.sort((a, b) => b.modifiedMs - a.modifiedMs);
	return { entries, runs };
}

// ── Exploration-oriented browser (v2) ───────────────────────────────────

/**
 * Browser entry wrapping an Exploration with browser-specific metadata.
 *
 * Replaces SessionBrowserEntry as the primary browser data type.
 * Each entry wraps one Exploration (which wraps one Source Session).
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
	digest?: SessionDigest | null;
	/** Analysis runs that included this session. */
	analyzedIn: SessionBrowserEntry["analyzedIn"];
	modifiedSinceAnalysis: boolean;
	everAnalyzed: boolean;
}

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
	// pi sessions: reconstruct from sourceData
	if (source === "pi" && sourceData) {
		// sourceData.cwd has the working directory, filename has the JSONL name
		const filename = sourceData["filename"] as string | undefined;
		if (!filename) return undefined;
		const cwd = (sourceData["cwd"] as string) ?? "";
		// Encode the cwd path to pi's directory format
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

	for (const projectionSource of projection.sources) {
		for (const exploration of projection.explorations) {
			// Only process explorations from this source
			if (exploration.members[0]?.source !== projectionSource.source) continue;

			const member = exploration.members[0];
			if (!member) continue;

			// Resolve modifiedMs from the exploration's timestamps
			const modifiedMs = new Date(exploration.modified).getTime();

			// Reconstruct the SourceSession for this entry
			// (the projection already built it internally; we rebuild browser metadata here)
			const sourceSession: SourceSession = {
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
			const analyzedIn: SessionBrowserEntry["analyzedIn"] = [];
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
			const filePath = resolveSessionFilePath(member.source, member.sourceSessionId, sourceSession.sourceData);

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
			e.digest = await loadDigest(e.sourceSession.id);
		}),
	);

	entries.sort((a, b) => b.modifiedMs - a.modifiedMs);
	return { entries, runs };
}

// ---- Filtering ----

export type DateWindow = "24h" | "7d" | "30d" | "all";
export type StatusFilter =
	| "all"
	| "unanalyzed"
	| "pending"
	| "decided"
	| "fresh"
	| "digested"
	| "undigested";
export type SourceFilter = "all" | SessionSourceKind;

export interface FilterState {
	date: DateWindow;
	status: StatusFilter;
	source: SourceFilter;
	query: string;
}

export function applyFilter(
	entries: SessionBrowserEntry[],
	f: FilterState,
): SessionBrowserEntry[] {
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
		if (f.source !== "all" && e.source !== f.source) return false;
		if (f.status === "unanalyzed" && e.everAnalyzed) return false;
		if (f.status === "pending") {
			const anyPending = e.analyzedIn.some((a) => a.tally.pending > 0);
			if (!anyPending) return false;
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
			const hay =
				`${e.firstPrompt} ${e.id} ${e.digest?.overallSummary ?? ""} ${(e.digest?.analysis.tags ?? []).join(" ")} ${(e.digest?.analysis.topics ?? []).join(" ")}`.toLowerCase();
			if (!hay.includes(q)) return false;
		}
		return true;
	});
}

// ---- Exploration-oriented filter ----

/**
 * Filter Exploration browser entries by date, source, status, and text query.
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
