/**
 * Exploration browser TUI component.
 *
 * Side-by-side layout: slim list on the left, detail panel on the right.
 */
import React, { useState, useMemo } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type {
	ExplorationBrowserEntry,
	FilterState,
	DateWindow,
	StatusFilter,
	SourceFilter,
} from "@umwelten/sessions/introspection/browse.js";
import { applyExploreFilter } from "@umwelten/sessions/introspection/browse.js";

export type ExploreBrowseIntent =
	| { kind: "none" }
	| { kind: "detail"; entry: ExplorationBrowserEntry }
	| { kind: "transcript"; entry: ExplorationBrowserEntry }
	| { kind: "digest"; entry: ExplorationBrowserEntry }
	| { kind: "beats"; entry: ExplorationBrowserEntry };

export interface ExploreBrowseAppProps {
	projectPath: string;
	targetPath: string;
	entries: ExplorationBrowserEntry[];
	runCount: number;
	onExit: (intent: ExploreBrowseIntent) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function ago(ms: number): string {
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

function cycleDate(cur: DateWindow): DateWindow {
	switch (cur) {
		case "24h":
			return "7d";
		case "7d":
			return "30d";
		case "30d":
			return "all";
		case "all":
			return "24h";
	}
}

function cycleStatus(cur: StatusFilter): StatusFilter {
	const order: StatusFilter[] = [
		"all",
		"unanalyzed",
		"pending",
		"decided",
		"fresh",
	];
	return order[(order.indexOf(cur) + 1) % order.length];
}

function cycleSource(cur: SourceFilter): SourceFilter {
	const order: SourceFilter[] = ["all", "claude-code", "habitat", "pi"];
	return order[(order.indexOf(cur) + 1) % order.length];
}

function sourceBadge(source: string): string {
	switch (source) {
		case "pi":
			return "P";
		case "claude-code":
			return "C";
		case "habitat":
			return "H";
		default:
			return "?";
	}
}

function statusBadge(e: ExplorationBrowserEntry): {
	label: string;
	color: string;
} {
	const pending = e.analyzedIn.reduce((s, a) => s + a.tally.pending, 0);
	if (pending > 0) return { label: `${pending} pend`, color: "yellow" };
	if (e.modifiedSinceAnalysis) return { label: "changed", color: "yellow" };
	if (e.everAnalyzed && e.digest) return { label: "done", color: "green" };
	if (e.digest) return { label: "digest", color: "cyan" };
	if (e.everAnalyzed) return { label: "reviewed", color: "green" };
	return { label: "new", color: "gray" };
}

function formatPiMeta(e: ExplorationBrowserEntry): string {
	const sd = e.sourceSession.sourceData;
	if (!sd) return "";
	const parts: string[] = [];
	const branches = sd["branchCount"] as number | undefined;
	const compactions = sd["compactionCount"] as number | undefined;
	const displayName = sd["displayName"] as string | undefined;
	if (displayName) parts.push(displayName.slice(0, 12));
	if (branches && branches > 0) parts.push(`${branches}br`);
	if (compactions && compactions > 0) parts.push(`${compactions}cp`);
	return parts.join(" · ");
}

// ── Component ───────────────────────────────────────────────────────────

export function ExploreBrowseApp({
	projectPath: _projectPath,
	targetPath: _targetPath,
	entries,
	onExit,
}: ExploreBrowseAppProps): React.ReactElement {
	const { exit } = useApp();
	const { stdout } = useStdout();
	const rows = Math.max(20, (stdout?.rows ?? 30) - 1);

	const [filter, setFilter] = useState<FilterState>({
		date: "30d",
		status: "all",
		source: "all",
		query: "",
	});
	const [cursor, setCursor] = useState(0);
	const [searching, setSearching] = useState(false);
	const [query, setQuery] = useState("");
	const [confirmEntry, setConfirmEntry] =
		useState<ExplorationBrowserEntry | null>(null);
	const [digestProgress, setDigestProgress] =
		useState<ExplorationBrowserEntry | null>(null);

	const filtered = useMemo(
		() => applyExploreFilter(entries, filter),
		[entries, filter],
	);
	const bounded =
		cursor >= filtered.length ? Math.max(0, filtered.length - 1) : cursor;
	const current = filtered[bounded];

	const [windowTop, setWindowTop] = useState(0);

	useInput((input, key) => {
		if (confirmEntry !== null) {
			if (input === "y" || input === "Y") {
				setDigestProgress(confirmEntry);
				setConfirmEntry(null);
				setTimeout(() => setDigestProgress(null), 600);
			} else if (
				input === "n" ||
				input === "N" ||
				key.escape ||
				input === "q"
			) {
				setConfirmEntry(null);
				setDigestProgress(null);
			}
			return;
		}

		if (digestProgress !== null) {
			if (input === "q" || (key.ctrl && input === "c")) {
				setDigestProgress(null);
			}
			return;
		}

		if (searching) {
			if (key.return || key.escape) {
				setSearching(false);
				setFilter((f) => ({ ...f, query }));
				return;
			}
			if (key.backspace || key.delete) {
				setQuery((q) => q.slice(0, -1));
				return;
			}
			if (input && input.length === 1 && !key.ctrl && !key.meta) {
				setQuery((q) => q + input);
			}
			return;
		}

		if (input === "q" || (key.ctrl && input === "c")) {
			onExit({ kind: "none" });
			exit();
			return;
		}
		if (input === "j" || key.downArrow) {
			setCursor((c) => Math.min(filtered.length - 1, c + 1));
		} else if (input === "k" || key.upArrow) {
			setCursor((c) => Math.max(0, c - 1));
		} else if (input === "g" && !key.shift) {
			setCursor(0);
		} else if (input === "G" || (key.shift && input === "g")) {
			setCursor(filtered.length - 1);
		} else if (input === "d") {
			setFilter((f) => ({ ...f, date: cycleDate(f.date) }));
		} else if (input === "f") {
			setFilter((f) => ({ ...f, status: cycleStatus(f.status) }));
		} else if (input === "s") {
			setFilter((f) => ({ ...f, source: cycleSource(f.source) }));
		} else if (input === "/") {
			setSearching(true);
			setQuery(filter.query);
		} else if (input === "x" || key.escape) {
			setFilter((f) => ({ ...f, query: "" }));
			setQuery("");
		} else if (input === "1") {
			setFilter((f) => ({ ...f, date: "24h" }));
		} else if (input === "2") {
			setFilter((f) => ({ ...f, date: "7d" }));
		} else if (input === "3") {
			setFilter((f) => ({ ...f, date: "30d" }));
		} else if (input === "4") {
			setFilter((f) => ({ ...f, date: "all" }));
		} else if (key.return) {
			if (!current) return;
			onExit({ kind: "detail", entry: current });
			exit();
		} else if (input === "v") {
			if (!current) return;
			onExit({ kind: "transcript", entry: current });
			exit();
		} else if (input === "D") {
			if (!current) return;
			setConfirmEntry(current);
		} else if (input === "b") {
			if (!current) return;
			onExit({ kind: "beats", entry: current });
			exit();
		}
	});

	// ── Overlays ──────────────────────────────────────────────────────────

	if (confirmEntry !== null) {
		const name = confirmEntry.exploration.name.slice(0, 60);
		return (
			<Box flexDirection="column" paddingX={2} paddingY={2} height={rows}>
				<Box
					borderStyle="round"
					borderColor="yellow"
					paddingX={2}
					paddingY={1}
					flexDirection="column"
				>
					<Text bold color="yellow">
						Digest this exploration?
					</Text>
					<Box marginTop={1}>
						<Text color="gray" wrap="wrap">
							"{name}..."
						</Text>
					</Box>
					<Box marginTop={1}>
						<Text color="gray">
							Uses an LLM via GOOGLE_GENERATIVE_AI_API_KEY.
						</Text>
					</Box>
					<Box marginTop={1}>
						<Text bold color="green">
							[y]
						</Text>
						<Text color="gray"> digest </Text>
						<Text bold color="red">
							[n/q/Esc]
						</Text>
						<Text color="gray"> cancel</Text>
					</Box>
				</Box>
			</Box>
		);
	}

	if (digestProgress !== null) {
		const name = digestProgress.exploration.name.slice(0, 40);
		return (
			<Box flexDirection="column" paddingX={2} paddingY={2} height={rows}>
				<Text bold color="yellow">
					Digesting…
				</Text>
				<Box marginTop={1}>
					<Text color="gray" wrap="wrap">
						{name}
					</Text>
				</Box>
				<Box marginTop={2}>
					<Text color="gray" dimColor>
						Press <Text color="cyan">q</Text> to cancel
					</Text>
				</Box>
			</Box>
		);
	}

	// ── Side-by-side layout ───────────────────────────────────────────────
	const listWidth = 42;

	const effectiveTop = Math.min(windowTop, Math.max(0, filtered.length - 10));
	if (bounded < effectiveTop) {
		queueMicrotask(() => setWindowTop(bounded));
	} else if (bounded >= effectiveTop + 8) {
		queueMicrotask(() => setWindowTop(bounded - 7));
	}

	return (
		<Box flexDirection="row" height={rows}>
			{/* ── Left: list ─────────────────────────────────────────── */}
			<Box
				flexDirection="column"
				width={listWidth}
				flexShrink={0}
				borderStyle="single"
				borderColor="gray"
			>
				{/* Header */}
				<Box paddingX={1} paddingY={0} flexShrink={0}>
					<Text bold color="cyan">
						Expl.
					</Text>
					<Text color="gray">
						{" "}
						({filtered.length}/{entries.length})
					</Text>
					<Text color="gray"> · </Text>
					<Text color="cyan">{filter.date}</Text>
					{filter.query && (
						<>
							<Text color="gray"> · </Text>
							<Text color="magenta">"{filter.query}"</Text>
						</>
					)}
				</Box>

				{/* Rows */}
				<Box flexDirection="column" flexGrow={1} overflow="hidden">
					{filtered.length === 0 && (
						<Box paddingX={1} paddingY={1}>
							<Text color="gray">No explorations match.</Text>
						</Box>
					)}
					{filtered.map((e, i) => {
						const selected = i === bounded;
						const src = sourceBadge(e.sourceSession.source);
						const age = ago(e.modifiedMs).padStart(4);
						const name =
							e.exploration.name.length > listWidth - 22
								? e.exploration.name.slice(0, listWidth - 25) + ".."
								: e.exploration.name;
						const piMeta = formatPiMeta(e);

						return (
							<Box key={e.sourceSession.id} paddingX={1} flexShrink={0}>
								<Text color="gray">{age} </Text>
								<Text color="cyan">[{src}]</Text>
								<Text bold color={selected ? "cyan" : "white"}>
									{selected ? "▶" : " "}
								</Text>
								<Text color={selected ? "white" : "gray"}>{name}</Text>
								{piMeta && (
									<Text color="gray" dimColor>
										{" "}
										{piMeta}
									</Text>
								)}
							</Box>
						);
					})}
				</Box>

				{/* Footer */}
				<Box
					paddingX={1}
					paddingY={0}
					flexShrink={0}
					borderStyle="single"
					borderColor="gray"
				>
					<Text color="cyan">↑/↓</Text>
					<Text color="gray"> sel · </Text>
					<Text color="cyan">Enter</Text>
					<Text color="gray"> detail · </Text>
					<Text color="cyan">/</Text>
					<Text color="gray"> search</Text>
				</Box>
			</Box>

			{/* ── Right: detail ────────────────────────────────────── */}
			<Box
				flexDirection="column"
				flexGrow={1}
				paddingX={1}
				overflow="hidden"
				borderStyle="single"
				borderColor="gray"
			>
				{/* Header */}
				<Box flexShrink={0} paddingY={0}>
					{current ? (
						<Text>
							<Text bold color="cyan">
								▶{" "}
							</Text>
							<Text color="white" bold>
								{current.exploration.name.slice(0, 70)}
							</Text>
						</Text>
					) : (
						<Text color="gray">↑/↓ select an exploration</Text>
					)}
				</Box>

				{/* Content */}
				<Box flexDirection="column" flexGrow={1} overflow="hidden">
					{current ? (
						<ExplorationDetailView entry={current} compact={rows < 35} />
					) : (
						<Box paddingY={2}>
							<Text color="gray">↑/↓ select to see details.</Text>
							<Box marginTop={1}>
								<Text color="cyan">Enter</Text>
								<Text color="gray"> detail · </Text>
								<Text color="yellow">D</Text>
								<Text color="gray"> digest · </Text>
								<Text color="cyan">v</Text>
								<Text color="gray"> transcript · </Text>
								<Text color="cyan">b</Text>
								<Text color="gray"> beats</Text>
							</Box>
						</Box>
					)}
				</Box>

				{/* Footer */}
				<Box
					flexShrink={0}
					borderStyle="single"
					borderColor="gray"
					paddingY={0}
				>
					<Text color="gray">
						<Text color="cyan">Enter</Text> detail ·
						<Text color="yellow"> D</Text> digest ·<Text color="cyan"> v</Text>{" "}
						transcript ·<Text color="cyan"> b</Text> beats ·
						<Text color="cyan"> q</Text> quit
					</Text>
				</Box>
			</Box>
		</Box>
	);
}

// ── Detail view ──────────────────────────────────────────────────────────

interface ExplorationDetailViewProps {
	entry: ExplorationBrowserEntry;
	compact?: boolean;
}

function ExplorationDetailView({ entry, compact }: ExplorationDetailViewProps) {
	const { digest, sourceSession, analyzedIn } = entry;
	const badge = statusBadge(entry);
	const src = sourceBadge(sourceSession.source);
	const piMeta = formatPiMeta(entry);

	const metrics = digest?.metrics;
	const analysis = digest?.analysis;
	const msgCount = metrics?.messageCount ?? sourceSession.messageCount ?? 0;
	const toolCount =
		metrics?.toolCallCount ?? sourceSession.metrics?.toolCalls ?? 0;
	const cost = metrics?.estimatedCost ?? 0;

	const tags = analysis?.topics ?? [];
	const summary = analysis?.summary ?? "";
	const learnings = analysis?.keyLearnings ?? "";

	const maxSummary = compact ? 120 : 280;
	const maxLearnings = compact ? 100 : 220;

	return (
		<Box flexDirection="column" paddingY={0} overflow="hidden">
			{/* Source + metrics */}
			<Box>
				<Text color="cyan">[{src}]</Text>
				<Text color="gray"> </Text>
				<Text color="yellow">{msgCount} msg</Text>
				<Text color="gray"> · </Text>
				<Text color="yellow">{toolCount} tools</Text>
				{cost > 0 && (
					<>
						<Text color="gray"> · $</Text>
						<Text color="yellow">{cost.toFixed(2)}</Text>
					</>
				)}
				{piMeta && (
					<>
						<Text color="gray"> · </Text>
						<Text color="gray" dimColor>
							{piMeta}
						</Text>
					</>
				)}
			</Box>

			{/* Topics */}
			{tags.length > 0 && (
				<Box>
					<Text color="gray" dimColor>
						topics:{" "}
					</Text>
					<Text color="cyan">{tags.slice(0, compact ? 4 : 8).join(", ")}</Text>
				</Box>
			)}

			{/* Summary */}
			{summary && summary.trim() && (
				<Box>
					<Text color="gray" dimColor>
						summary:{" "}
					</Text>
					<Text color="white" wrap="wrap">
						{summary.length > maxSummary
							? summary.slice(0, maxSummary - 3) + "..."
							: summary}
					</Text>
				</Box>
			)}

			{/* Learnings */}
			{learnings && learnings.trim() && (
				<Box>
					<Text color="magenta">learnings: </Text>
					<Text color="gray" wrap="wrap">
						{learnings.length > maxLearnings
							? learnings.slice(0, maxLearnings - 3) + "..."
							: learnings}
					</Text>
				</Box>
			)}

			{/* Analysis runs */}
			{analyzedIn.length > 0 && (
				<Box>
					<Text color="gray" dimColor>
						analyzed:{" "}
					</Text>
					<Text color="green">{analyzedIn.length} run(s)</Text>
					{analyzedIn[0] && (
						<>
							<Text color="gray"> · </Text>
							<Text color="gray" dimColor>
								{analyzedIn[0].tally.accepted}/{analyzedIn[0].tally.total}{" "}
								accepted
							</Text>
						</>
					)}
				</Box>
			)}

			{/* Status */}
			<Box>
				<Text color="gray" dimColor>
					status:{" "}
				</Text>
				<Text color={badge.color} bold>
					{badge.label}
				</Text>
				{entry.modifiedSinceAnalysis && (
					<Text color="yellow"> · changed since analysis</Text>
				)}
			</Box>

			{/* Key hints */}
			<Box marginTop={1}>
				<Text color="gray" dimColor>
					<Text color="cyan">Enter</Text> detail ·<Text color="yellow"> D</Text>{" "}
					digest ·<Text color="cyan"> v</Text> transcript ·
					<Text color="cyan"> b</Text> beats
				</Text>
			</Box>
		</Box>
	);
}
