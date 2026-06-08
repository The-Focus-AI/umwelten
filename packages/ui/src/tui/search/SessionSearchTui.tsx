/**
 * Session Search TUI — slice 4 (issue #86).
 *
 * Two-pane Ink TUI used by `umwelten search "query"`:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  Search: "score industry"   (2 hits)                             │   header
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │ ▶ 2026-05-22  alpha  user  …score industry alpha…                │   hit
 *   │   2026-05-21  beta   asst  …score industry beta…                 │   list
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │  Full body for ALPHA hit — score industry alpha discussion.      │   detail
 *   │                                                                  │   pane
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │  ↑/↓ navigate · q quit                                           │   footer
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * The query is **fixed at launch** in slice 4. Slice 5 (#87) makes it
 * editable with debounced re-scanning; slice 6 (#88) adds the
 * `Enter`-to-launch-dashboard intent; slice 7 (#89) makes `q` bounce back
 * to search instead of exiting; slice 9 (#91) wires `--no-tui`.
 *
 * The scan is pre-run before mount in production (the caller awaits
 * SessionSearcher first, then renders), but the component still accepts a
 * pending `runScan` promise so tests can exercise the "scanning…" state
 * and so later slices can call the scanner from inside the component.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { SessionHit } from "@umwelten/core/interaction/search/index.js";

// ── Props ───────────────────────────────────────────────────────────────────

export interface SessionSearchTuiProps {
	/** Query string echoed in the header. Fixed at mount for slice 4. */
	query: string;
	/**
	 * Async function that runs the scan and returns the hits. Called once
	 * on mount; while pending, the "scanning…" indicator is shown.
	 *
	 * In production this is a thin wrapper around `searchSessions(query)`;
	 * tests pass a controllable promise.
	 */
	runScan: () => Promise<SessionHit[]>;
	/**
	 * Called on `q` / Ctrl+C. The caller is responsible for unmounting Ink
	 * via the instance handle and for any process-level exit. The TUI also
	 * calls Ink's `useApp().exit()` so the `render()` promise resolves.
	 */
	onExit: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function SessionSearchTui(
	props: SessionSearchTuiProps,
): React.ReactElement {
	const { query, runScan, onExit } = props;
	const { exit } = useApp();
	const { stdout } = useStdout();
	const totalCols = Math.max(80, stdout?.columns ?? 100);
	const totalRows = Math.max(20, (stdout?.rows ?? 30) - 1);

	const [hits, setHits] = useState<SessionHit[] | null>(null);
	const [scanError, setScanError] = useState<string | null>(null);
	const [cursor, setCursor] = useState(0);

	// Run the scan exactly once on mount.
	useEffect(() => {
		let cancelled = false;
		runScan()
			.then((result) => {
				if (cancelled) return;
				setHits(result);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setScanError(err instanceof Error ? err.message : String(err));
				setHits([]);
			});
		return () => {
			cancelled = true;
		};
		// runScan intentionally not in deps — at most one scan per mount.
		// Slice 5 will redo this when the query becomes editable.
	}, []);

	const bounded = hits && hits.length > 0 ? Math.min(cursor, hits.length - 1) : 0;
	const current = hits && hits.length > 0 ? hits[bounded] : null;

	// Keyboard input.
	useInput((input, key) => {
		if (input === "q" || (key.ctrl && input === "c")) {
			onExit();
			exit();
			return;
		}
		if (!hits || hits.length === 0) return;
		if (key.downArrow || input === "j") {
			setCursor((c) => Math.min(hits.length - 1, c + 1));
			return;
		}
		if (key.upArrow || input === "k") {
			setCursor((c) => Math.max(0, c - 1));
			return;
		}
	});

	// ── Render ────────────────────────────────────────────────────────────

	const scanning = hits === null;
	const hitCount = hits?.length ?? 0;

	// Vertical layout: header (1) + table header (1) + list (flex) + detail (flex)
	// + footer (1). Give the list and detail equal space within the remaining
	// rows after the chrome.
	const chromeRows = 4; // header, column-headers, footer, +1 border
	const listAndDetailRows = Math.max(6, totalRows - chromeRows);
	const listHeight = Math.max(3, Math.floor(listAndDetailRows / 2));
	const detailHeight = Math.max(3, listAndDetailRows - listHeight);

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
				{scanning ? null : hits && hits.length === 0 ? (
					<Box paddingX={1}>
						<Text color="gray">no hits</Text>
					</Box>
				) : (
					hits!.map((hit, i) => (
						<HitRow
							key={`${hit.filePath}:${hit.messageTimestamp}:${i}`}
							hit={hit}
							selected={i === bounded}
							width={totalCols}
						/>
					))
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
			<Text bold color="cyan">
				Search:
			</Text>
			<Text> </Text>
			<Text color="magenta">"{query}"</Text>
			<Text color="gray"> · </Text>
			{scanning ? (
				<Text color="yellow">scanning…</Text>
			) : (
				<Text color="gray">
					({hitCount} {hitCount === 1 ? "hit" : "hits"})
				</Text>
			)}
			{error ? (
				<>
					<Text color="gray"> · </Text>
					<Text color="red">scan failed: {error}</Text>
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
				<Text color="gray" bold>
					time
				</Text>
			</Box>
			<Box width={projW}>
				<Text color="gray" bold>
					project
				</Text>
			</Box>
			<Box width={COL_ROLE_WIDTH}>
				<Text color="gray" bold>
					role
				</Text>
			</Box>
			<Box width={snipW}>
				<Text color="gray" bold>
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
	return (
		<Box paddingX={1} flexShrink={0}>
			<Box width={2}>
				<Text bold color="cyan">
					{selected ? "▶" : " "}
				</Text>
			</Box>
			<Box width={COL_TIME_WIDTH}>
				<Text color="gray">{time}</Text>
			</Box>
			<Box width={projW}>
				<Text color={selected ? "white" : "gray"}>{project}</Text>
			</Box>
			<Box width={COL_ROLE_WIDTH}>
				<Text color={roleColor(hit.role)}>{role}</Text>
			</Box>
			<Box width={snipW}>
				<Text color={selected ? "white" : "gray"}>{snippet}</Text>
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
			borderColor="gray"
			flexDirection="column"
			paddingX={1}
			overflow="hidden"
		>
			{scanning ? (
				<Text color="gray">scanning…</Text>
			) : current ? (
				<DetailBody hit={current} maxLines={height - 2} maxCols={width - 4} />
			) : (
				<Text color="gray">(no hit to preview)</Text>
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
	const lines = useMemo(() => {
		// Soft-wrap fullMessageContent to fit the pane width. Long messages are
		// hard-truncated to maxLines (scrolling lands in a later slice).
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
		if (wrapped.length <= maxLines) return wrapped;
		const truncated = wrapped.slice(0, maxLines - 1);
		truncated.push(`… (${wrapped.length - truncated.length} more lines)`);
		return truncated;
	}, [hit.fullMessageContent, maxCols, maxLines]);

	return (
		<>
			<Box>
				<Text color="cyan" bold>
					{hit.projectName}
				</Text>
				<Text color="gray"> · </Text>
				<Text color={roleColor(hit.role)}>{hit.role}</Text>
				<Text color="gray"> · </Text>
				<Text color="gray">{hit.messageTimestamp}</Text>
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
			borderColor="gray"
			paddingX={1}
		>
			<Text color="gray" dimColor>
				↑/↓ navigate · q quit
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
	switch (role) {
		case "user":
			return "green";
		case "assistant":
			return "blue";
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
