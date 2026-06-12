/**
 * Session Search TUI — slices 4 (#86) + 5 (#87) + 6 (#88).
 *
 * Two-pane Ink TUI used by `umwelten search [query]`:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  Search: "score industry_"   (2 hits)                            │   header
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │ ▶ 2026-05-22  alpha  user  …score industry alpha…                │   hit
 *   │   2026-05-21  beta   asst  …score industry beta…                 │   list
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │  Full body for ALPHA hit — score industry alpha discussion.      │   detail
 *   │                                                                  │   pane
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │  type to search · ↑/↓ navigate · Enter open · Esc quit           │   footer
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Slice 5 makes the query editable: typing edits the field, a 200 ms
 * debounce timer fires after the last keystroke and re-runs the scan.
 * Empty query → empty list, no scanning indicator. The highlight resets
 * to row 0 on each new result set. Esc / Ctrl+C exit (`q` is now a
 * search character — slice 4's `q` exit gave way to inline editing).
 *
 * Slice 6 turns Enter into "launch the Exploration Browser dashboard
 * pre-selected at this hit" (via the `onSelectHit` prop and Ink's
 * `exit()`). Slice 7 (#89) will rebind exit for the dashboard-launched
 * case; slice 9 (#91) adds `--no-tui`.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { SessionHit } from "@umwelten/core/interaction/search/index.js";

import { theme, secondary } from "../theme.js";
// ── Props ───────────────────────────────────────────────────────────────────

/**
 * Snapshot of the search TUI's interactive state at the moment a hit is
 * opened (slice 7, #89). The runner holds onto it so that when the launched
 * dashboard bounces back with `q`, search re-mounts exactly where the user
 * left it — same query, same hit list, same highlighted row — without
 * re-running the scan.
 */
export interface SearchTuiSnapshot {
	query: string;
	hits: SessionHit[];
	cursorIndex: number;
}

export interface SessionSearchTuiProps {
	/**
	 * Initial query at mount. Empty string is valid — the TUI launches with
	 * an empty editable field. The query is then owned by component state.
	 */
	initialQuery?: string;
	/**
	 * Async function that runs a scan for the given query and returns the
	 * hits. Called on initial mount (if `initialQuery` is non-empty) and
	 * on every debounced query change.
	 *
	 * In production this is a thin wrapper around `searchSessions(query)`;
	 * tests pass a controllable promise.
	 */
	runScan: (query: string) => Promise<SessionHit[]>;
	/**
	 * Called on Esc / Ctrl+C. The caller is responsible for any
	 * process-level exit; the TUI also calls Ink's `useApp().exit()` so the
	 * `render()` promise resolves.
	 */
	onExit: () => void;
	/**
	 * Debounce window in milliseconds. Defaults to 200 ms per the PRD.
	 * Tests override this so they can drive the timer without waiting.
	 */
	debounceMs?: number;
	/**
	 * Called when the user presses Enter on a highlighted hit (slice 6, #88).
	 * The TUI also calls Ink's `useApp().exit()` to unmount cleanly so the
	 * caller can launch the Exploration Browser dashboard for the hit's
	 * project. If omitted, Enter is a no-op.
	 *
	 * The second argument (slice 7, #89) is a snapshot of the TUI state at
	 * selection time, so the caller can re-mount search with the same query,
	 * hit list, and highlight when the dashboard returns.
	 */
	onSelectHit?: (hit: SessionHit, snapshot: SearchTuiSnapshot) => void;
	/**
	 * Seed the hit list at mount and skip the initial scan for
	 * `initialQuery` (slice 7, #89). Used when re-mounting search after a
	 * dashboard round trip so the user lands on the same results without
	 * waiting for a re-scan. Subsequent query edits re-scan as usual.
	 */
	initialHits?: SessionHit[];
	/** Highlight this row index at mount (clamped to the hit list). */
	initialCursor?: number;
}

// ── Component ──────────────────────────────────────────────────────────────

const DEFAULT_DEBOUNCE_MS = 200;

export function SessionSearchTui(
	props: SessionSearchTuiProps,
): React.ReactElement {
	const {
		initialQuery = "",
		runScan,
		onExit,
		debounceMs = DEFAULT_DEBOUNCE_MS,
		onSelectHit,
		initialHits,
		initialCursor,
	} = props;
	const { exit } = useApp();
	const { stdout } = useStdout();
	const totalCols = Math.max(80, stdout?.columns ?? 100);
	const totalRows = Math.max(20, (stdout?.rows ?? 30) - 1);

	// Editable query state. Owned by the component from this slice forward.
	const [query, setQuery] = useState<string>(initialQuery);

	// `hits` is null while the very first scan is in flight, [] for an
	// empty-query state (no scan in progress), and a populated array
	// otherwise. `scanning` is independent — true while a scan is in
	// flight (initial *or* re-scan), false otherwise.
	const [hits, setHits] = useState<SessionHit[]>(() => initialHits ?? []);
	const [scanning, setScanning] = useState<boolean>(
		initialQuery.trim() !== "" && initialHits === undefined,
	);
	const [scanError, setScanError] = useState<string | null>(null);
	const [cursor, setCursor] = useState(initialCursor ?? 0);
	const [scrollOffset, setScrollOffset] = useState(0);

	// Track the latest scan so out-of-order results from a stale scan get
	// discarded.
	const scanSeqRef = useRef(0);

	// When the caller seeds hits (re-mount after a dashboard round trip,
	// slice 7 #89), the first run of the debounce effect must not re-scan —
	// the seeded hits ARE the results for `initialQuery`. Consumed once;
	// later query edits re-scan as usual.
	const skipInitialScanRef = useRef(
		initialHits !== undefined && initialQuery.trim() !== "",
	);

	// Debounce-driven scan. The effect re-arms whenever the query changes;
	// the timer fires after `debounceMs` and runs the scanner. An empty
	// query short-circuits — clear the hit list, drop the indicator, no
	// scan.
	useEffect(() => {
		const trimmed = query.trim();
		if (trimmed === "") {
			setScanning(false);
			setScanError(null);
			setHits([]);
			setCursor(0);
			return;
		}
		if (skipInitialScanRef.current) {
			skipInitialScanRef.current = false;
			return;
		}
		// Show the indicator immediately on a query change. Initial mount
		// already initialized `scanning = true`.
		setScanning(true);
		const handle = setTimeout(() => {
			const seq = ++scanSeqRef.current;
			runScan(trimmed)
				.then((result) => {
					if (seq !== scanSeqRef.current) return;
					setHits(result);
					setScanning(false);
					setScanError(null);
					setCursor(0);
				})
				.catch((err: unknown) => {
					if (seq !== scanSeqRef.current) return;
					setScanError(err instanceof Error ? err.message : String(err));
					setHits([]);
					setScanning(false);
				});
		}, debounceMs);
		return () => {
			clearTimeout(handle);
		};
	}, [query, runScan, debounceMs]);

	const bounded =
		hits.length > 0 ? Math.min(cursor, hits.length - 1) : 0;
	const current = hits.length > 0 ? hits[bounded] : null;

	// Keyboard input. Two modes share one handler:
	//   - Navigation: ↑/↓
	//   - Editing: backspace, printable characters
	//   - Exit: Esc / Ctrl+C
	// `q` is *not* an exit — it's a search character now. Esc-or-Ctrl+C is
	// the only way out.
	useInput((input, key) => {
		if (key.escape || (key.ctrl && input === "c")) {
			onExit();
			exit();
			return;
		}
		if (key.return) {
			// Slice 6 (#88): open the highlighted hit. The caller (`run.tsx`)
			// receives the hit via onSelectHit and is responsible for
			// launching the Exploration Browser dashboard scoped to its
			// project. We exit() to unmount Ink so the dashboard can take
			// over the terminal.
			if (!current || !onSelectHit) return;
			onSelectHit(current, { query, hits, cursorIndex: bounded });
			exit();
			return;
		}
		if (key.downArrow) {
			if (hits.length === 0) return;
			setCursor((c) => Math.min(hits.length - 1, c + 1));
			return;
		}
		if (key.upArrow) {
			if (hits.length === 0) return;
			setCursor((c) => Math.max(0, c - 1));
			return;
		}
		if (key.backspace || key.delete) {
			setQuery((q) => q.slice(0, -1));
			return;
		}
		// Ignore tab / other non-printable control sequences. (Enter is
		// handled above as "open hit".)
		if (key.tab) return;
		// Any printable, non-modified character extends the query.
		if (input && !key.ctrl && !key.meta) {
			const printable = input.replace(/[^\x20-\x7e]/g, "");
			if (printable.length > 0) {
				setQuery((q) => q + printable);
			}
		}
	});

	// ── Layout ────────────────────────────────────────────────────────────

	const hitCount = hits.length;

	// Vertical layout: header (1) + table header (1) + list (flex) + detail (flex)
	// + footer (1). Give the list and detail equal space within the remaining
	// rows after the chrome.
	const chromeRows = 4; // header, column-headers, footer, +1 border
	const listAndDetailRows = Math.max(6, totalRows - chromeRows);
	const listHeight = Math.max(3, Math.floor(listAndDetailRows / 2));
	const detailHeight = Math.max(3, listAndDetailRows - listHeight);

	// Keep the highlighted row in the visible window of the hit list. When
	// the cursor moves off the top, scroll up by one; when it moves past the
	// bottom edge of the window, scroll down by one. Reset to 0 whenever the
	// hit list shrinks below the cursor (e.g. after a re-scan).
	useEffect(() => {
		setScrollOffset((prev) => {
			let next = prev;
			if (bounded < next) next = bounded;
			else if (bounded >= next + listHeight) next = bounded - listHeight + 1;
			const maxOffset = Math.max(0, hitCount - listHeight);
			if (next > maxOffset) next = maxOffset;
			if (next < 0) next = 0;
			return next;
		});
	}, [bounded, listHeight, hitCount]);

	const visibleHits = hits.slice(scrollOffset, scrollOffset + listHeight);

	// ── Render ────────────────────────────────────────────────────────────

	return (
		<Box flexDirection="column" height={totalRows}>
			<Header
				query={query}
				scanning={scanning}
				hitCount={hitCount}
				error={scanError}
			/>

			<HitListHeader width={totalCols} />

			<Box flexDirection="column" height={listHeight} overflow="hidden">
				{scanning ? null : hits.length === 0 ? (
					<Box paddingX={1}>
						<Text {...secondary}>
							{query.trim() === "" ? "type to search" : "no hits"}
						</Text>
					</Box>
				) : (
					visibleHits.map((hit, i) => {
						const absoluteIndex = scrollOffset + i;
						return (
							<HitRow
								key={`${hit.filePath}:${hit.messageTimestamp}:${absoluteIndex}`}
								hit={hit}
								selected={absoluteIndex === bounded}
								width={totalCols}
							/>
						);
					})
				)}
			</Box>

			<DetailPane
				current={current}
				scanning={scanning}
				height={detailHeight}
				width={totalCols}
			/>

			<Footer />
		</Box>
	);
}

// ── Pieces ────────────────────────────────────────────────────────────────

interface HeaderProps {
	query: string;
	scanning: boolean;
	hitCount: number;
	error: string | null;
}

function Header(props: HeaderProps): React.ReactElement {
	const { query, scanning, hitCount, error } = props;
	return (
		<Box paddingX={1} flexShrink={0}>
			<Text bold color={theme.accent}>
				Search:
			</Text>
			<Text> </Text>
			<Text color={theme.userValue}>"{query}</Text>
			<Text color={theme.pending}>_</Text>
			<Text color={theme.userValue}>"</Text>
			<Text {...secondary}> · </Text>
			{scanning ? (
				<Text color={theme.pending}>scanning…</Text>
			) : (
				<Text {...secondary}>
					({hitCount} {hitCount === 1 ? "hit" : "hits"})
				</Text>
			)}
			{error ? (
				<>
					<Text {...secondary}> · </Text>
					<Text color={theme.error}>scan failed: {error}</Text>
				</>
			) : null}
		</Box>
	);
}

// Column widths for the hit list. Sum to a reasonable total; project name
// and snippet get the slack. Tuned for an 80-col terminal as the floor.
const COL_TIME_WIDTH = 11; // YYYY-MM-DD or HH:MM
const COL_ROLE_WIDTH = 5; // user / asst / tool / sys

function projectWidth(totalWidth: number): number {
	// 4 → selection marker + gutter
	// The snippet gets whatever's left after project (1/3 of slack) and chrome.
	const slack = totalWidth - COL_TIME_WIDTH - COL_ROLE_WIDTH - 4;
	return Math.max(8, Math.floor(slack / 3));
}

function snippetWidth(totalWidth: number): number {
	const slack = totalWidth - COL_TIME_WIDTH - COL_ROLE_WIDTH - 4;
	return Math.max(20, slack - projectWidth(totalWidth));
}

function HitListHeader({ width }: { width: number }): React.ReactElement {
	const projW = projectWidth(width);
	const snipW = snippetWidth(width);
	return (
		<Box paddingX={1} flexShrink={0}>
			<Box width={2}>
				<Text> </Text>
			</Box>
			<Box width={COL_TIME_WIDTH}>
				<Text {...secondary} bold>
					time
				</Text>
			</Box>
			<Box width={projW}>
				<Text {...secondary} bold>
					project
				</Text>
			</Box>
			<Box width={COL_ROLE_WIDTH}>
				<Text {...secondary} bold>
					role
				</Text>
			</Box>
			<Box width={snipW}>
				<Text {...secondary} bold>
					snippet
				</Text>
			</Box>
		</Box>
	);
}

interface HitRowProps {
	hit: SessionHit;
	selected: boolean;
	width: number;
}

const HitRow = React.memo(function HitRow({
	hit,
	selected,
	width,
}: HitRowProps): React.ReactElement {
	const projW = projectWidth(width);
	const snipW = snippetWidth(width);
	const time = formatTime(hit.messageTimestamp);
	const role = formatRole(hit.role);
	const project = truncate(hit.projectName, projW - 1);
	const snippet = truncate(stripNewlines(hit.snippet), snipW - 1);
	// Selected rows use the terminal's default foreground (bold) so they pop
	// against the dimmed unselected rows — works on light and dark themes.
	return (
		<Box paddingX={1} flexShrink={0}>
			<Box width={2}>
				<Text bold color={theme.accent}>
					{selected ? "▶" : " "}
				</Text>
			</Box>
			<Box width={COL_TIME_WIDTH}>
				<Text dimColor={!selected}>{time}</Text>
			</Box>
			<Box width={projW}>
				<Text bold={selected} dimColor={!selected}>
					{project}
				</Text>
			</Box>
			<Box width={COL_ROLE_WIDTH}>
				<Text color={roleColor(hit.role)} bold={selected}>
					{role}
				</Text>
			</Box>
			<Box width={snipW}>
				<Text dimColor={!selected}>{snippet}</Text>
			</Box>
		</Box>
	);
});

interface DetailPaneProps {
	current: SessionHit | null;
	scanning: boolean;
	height: number;
	width: number;
}

function DetailPane(props: DetailPaneProps): React.ReactElement {
	const { current, scanning, height, width } = props;
	return (
		<Box
			flexShrink={0}
			height={height}
			borderStyle="single"
			borderColor={theme.borderAccent}
			flexDirection="column"
			paddingX={1}
			overflow="hidden"
		>
			{scanning ? (
				<Text color={theme.pending}>scanning…</Text>
			) : current ? (
				<DetailBody hit={current} maxLines={height - 2} maxCols={width - 4} />
			) : (
				<Text {...secondary}>(no hit to preview)</Text>
			)}
		</Box>
	);
}

function DetailBody({
	hit,
	maxLines,
	maxCols,
}: {
	hit: SessionHit;
	maxLines: number;
	maxCols: number;
}): React.ReactElement {
	// Header now takes 3 lines (label row + project path + file path), so the
	// body gets `maxLines - 3` for content.
	const bodyMaxLines = Math.max(1, maxLines - 3);
	const lines = useMemo(() => {
		// Soft-wrap fullMessageContent to fit the pane width. Long messages are
		// hard-truncated to fit (scrolling lands in a later slice).
		const raw = hit.fullMessageContent.split(/\r?\n/);
		const wrapped: string[] = [];
		for (const line of raw) {
			if (line.length <= maxCols) {
				wrapped.push(line);
				continue;
			}
			let i = 0;
			while (i < line.length) {
				wrapped.push(line.slice(i, i + maxCols));
				i += maxCols;
			}
		}
		if (wrapped.length <= bodyMaxLines) return wrapped;
		const truncated = wrapped.slice(0, bodyMaxLines - 1);
		truncated.push(`… (${wrapped.length - truncated.length} more lines)`);
		return truncated;
	}, [hit.fullMessageContent, maxCols, bodyMaxLines]);

	return (
		<>
			<Box>
				<Text color={theme.accent} bold>
					{hit.projectName}
				</Text>
				<Text {...secondary}> · </Text>
				<Text color={roleColor(hit.role)} bold>
					{hit.role}
				</Text>
				<Text {...secondary}> · </Text>
				<Text {...secondary}>{hit.messageTimestamp}</Text>
			</Box>
			<Box>
				<Text color={theme.accent}>path: </Text>
				<Text {...secondary}>{truncate(hit.projectPath, maxCols - 6)}</Text>
			</Box>
			<Box>
				<Text color={theme.accent}>file: </Text>
				<Text {...secondary}>{truncate(hit.filePath, maxCols - 6)}</Text>
			</Box>
			{lines.map((line, i) => (
				<Text key={i}>{line || " "}</Text>
			))}
		</>
	);
}

function Footer(): React.ReactElement {
	return (
		<Box
			flexShrink={0}
			borderStyle="single"
			borderColor={theme.borderAccent}
			paddingX={1}
		>
			<Text {...secondary}>
				type to search · ↑/↓ navigate · Enter open · Esc quit
			</Text>
		</Box>
	);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
	// Show YYYY-MM-DD when the hit is more than ~24h old, otherwise HH:MM.
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
	const ageMs = Date.now() - d.getTime();
	if (ageMs < 24 * 60 * 60 * 1000) {
		const hh = String(d.getHours()).padStart(2, "0");
		const mm = String(d.getMinutes()).padStart(2, "0");
		return `${hh}:${mm}`;
	}
	return d.toISOString().slice(0, 10);
}

function formatRole(role: SessionHit["role"]): string {
	switch (role) {
		case "user":
			return "user";
		case "assistant":
			return "asst";
		case "tool":
			return "tool";
		case "system":
			return "sys";
		default:
			return role;
	}
}

function roleColor(role: SessionHit["role"]): string {
	// Matches the implicit palette used by DashboardApp: cyan = primary accent,
	// green = user/confirmation, magenta = secondary/tool, gray = chrome.
	// Blue is avoided — too dark on many terminal themes.
	switch (role) {
		case "user":
			return "green";
		case "assistant":
			return "cyan";
		case "tool":
			return "magenta";
		case "system":
			return "gray";
		default:
			return "white";
	}
}

function truncate(s: string, width: number): string {
	if (width <= 0) return "";
	if (s.length <= width) return s;
	if (width <= 1) return "…";
	return s.slice(0, width - 1) + "…";
}

function stripNewlines(s: string): string {
	return s.replace(/[\r\n]+/g, " ");
}
