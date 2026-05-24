/**
 * Pure helpers for the dashboard TUI — no React, no Ink, no I/O.
 */

import type { ExplorationBrowserEntry } from "@umwelten/core/interaction/types/domain-types.js";
import type { DashboardStatus } from "./types.js";

/** Compact relative time, e.g. "now" / "5m" / "3h" / "2d" / "4mo". */
export function ago(ms: number): string {
	const diff = Date.now() - ms;
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return "now";
	if (mins < 60) return `${mins}m`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 48) return `${hrs}h`;
	const days = Math.floor(hrs / 24);
	if (days < 30) return `${days}d`;
	const months = Math.floor(days / 30);
	return `${months}mo`;
}

/** Single-letter badge for the source column. */
export function sourceBadge(source: string): string {
	switch (source) {
		case "pi":
			return "P";
		case "claude-code":
			return "C";
		case "habitat":
			return "H";
		case "cursor":
			return "X";
		default:
			return "?";
	}
}

/** Truncate to `max` chars with a trailing ellipsis. */
export function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	if (max <= 1) return s.slice(0, max);
	return s.slice(0, max - 1) + "…";
}

/**
 * Status derived from the entry's digest + analysis runs.
 *
 * Used when no live progress event is in flight for this entry.
 */
export function deriveStatus(e: ExplorationBrowserEntry): DashboardStatus {
	if (e.digest && e.modifiedSinceAnalysis) return "stale";
	if (e.digest) return "digested";
	return "new";
}

/** Color hint for a status pill (Ink color names). */
export function statusColor(s: DashboardStatus): string {
	switch (s) {
		case "digesting":
			return "cyan";
		case "queued":
			return "gray";
		case "digested":
			return "green";
		case "failed":
			return "red";
		case "stale":
			return "yellow";
		case "new":
		default:
			return "gray";
	}
}

export interface DashboardEntryView {
	entry: ExplorationBrowserEntry;
	status: DashboardStatus;
	statusDetail?: string;
	/** Counts surfaced in the row. */
	messageCount: number;
	toolCount: number;
	candidateCount: number;
	/**
	 * Title shown in the row's topic column. Prefers the LLM-generated digest
	 * summary once the session has been digested; falls back to the first
	 * prompt (exploration.name) for new/queued/digesting rows.
	 */
	title: string;
}

/** Pick the best title for a row given what's known about the entry. */
export function rowTitle(entry: ExplorationBrowserEntry): string {
	// Prefer overallSummary (the compaction layer's output) over
	// analysis.summary (the analyzer's output) — for sessions where the
	// analyzer can't find user/assistant text (e.g. pi sessions where most
	// assistant content is thinking/toolCall blocks), the compaction
	// summary is still meaningful while analysis.summary literally reads
	// "Session with no analyzable conversation content."
	const overall = entry.digest?.overallSummary?.trim();
	if (
		overall &&
		!/^session with no analyzable/i.test(overall)
	) {
		return overall;
	}
	const analysisSummary = entry.digest?.analysis?.summary?.trim();
	if (
		analysisSummary &&
		!/^session with no analyzable/i.test(analysisSummary)
	) {
		return analysisSummary;
	}
	return entry.exploration.name;
}

/**
 * Project the entries into per-row view data, applying any live phase
 * overrides for in-flight extractions and live-title overrides loaded
 * from freshly-written digests.
 */
export function projectEntries(
	entries: ExplorationBrowserEntry[],
	phases: Map<string, { status: DashboardStatus; detail?: string }>,
	liveTitles?: Map<string, string>,
): DashboardEntryView[] {
	return entries.map((entry) => {
		const live = phases.get(entry.sourceSession.id);
		const status: DashboardStatus = live?.status ?? deriveStatus(entry);
		const metrics = entry.digest?.metrics;
		const messageCount =
			metrics?.messageCount ?? entry.sourceSession.messageCount ?? 0;
		const toolCount =
			metrics?.toolCallCount ?? entry.sourceSession.metrics?.toolCalls ?? 0;
		const candidateCount =
			(entry.digest?.extractedFacts?.length ?? 0) +
			(entry.digest?.phases?.length ?? 0);
		const liveTitle = liveTitles?.get(entry.sourceSession.id);
		return {
			entry,
			status,
			statusDetail: live?.detail,
			messageCount,
			toolCount,
			candidateCount,
			title: liveTitle ?? rowTitle(entry),
		};
	});
}

/**
 * How many entries are extractable right now (undigested or stale).
 * Used for the startup confirmation overlay's count.
 */
export function countExtractable(entries: ExplorationBrowserEntry[]): number {
	let n = 0;
	for (const e of entries) {
		const s = deriveStatus(e);
		if (s === "new" || s === "stale") n++;
	}
	return n;
}
