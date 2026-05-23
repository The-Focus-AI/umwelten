/**
 * Exploration Browser dashboard TUI — command-center view (issue #64).
 *
 * Replaces the previous side-by-side ExploreBrowseApp layout. Shows all
 * Explorations in a top-down table; rows update inline as the extraction
 * workflow engine emits progress events; a confirmation overlay gates the
 * launch of an LLM-backed extraction run.
 */
import React, {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type {
	ExplorationBrowserEntry,
	FilterState,
} from "@umwelten/sessions/introspection/browse.js";
import { applyExploreFilter } from "@umwelten/sessions/introspection/browse.js";
import {
	ago,
	countExtractable,
	projectEntries,
	sourceBadge,
	statusColor,
	truncate,
	type DashboardEntryView,
} from "./dashboard/utils.js";
import type {
	DashboardIntent,
	DashboardProgressEvent,
	DashboardStatus,
	ExtractionEventSubscriber,
} from "./dashboard/types.js";

export type {
	DashboardIntent,
	DashboardProgressEvent,
	DashboardStatus,
} from "./dashboard/types.js";

// ── Props ─────────────────────────────────────────────────────────────────

export interface DashboardAppProps {
	projectPath: string;
	targetPath: string;
	entries: ExplorationBrowserEntry[];
	runCount: number;
	/** Display label for the model used in extraction (shown in the overlay). */
	modelLabel: string;
	/** Concurrency the engine will use; shown in the overlay. */
	concurrency: number;
	initialFilter?: FilterState;
	/** When true, show the confirmation overlay at startup if work exists. */
	startupConfirm?: boolean;
	onExit: (intent: DashboardIntent) => void;
	/** Called when the user confirms 'y' on the extraction overlay. */
	onLaunchExtraction?: () => void;
	/** Optional subscription to a live progress event stream. */
	subscribeToExtractionEvents?: ExtractionEventSubscriber;
}

const DEFAULT_FILTER: FilterState = {
	date: "all",
	status: "all",
	source: "all",
	query: "",
};

// ── Phases reducer ────────────────────────────────────────────────────────

interface PhasesState {
	bySession: Record<
		string,
		{ status: DashboardStatus; detail?: string }
	>;
	currentItem: string | null;
}

type PhasesAction =
	| { type: "PATCH"; sessionId: string; status: DashboardStatus; detail?: string; topic?: string }
	| { type: "CLEAR_CURRENT" };

function phasesReducer(state: PhasesState, action: PhasesAction): PhasesState {
	switch (action.type) {
		case "PATCH": {
			const prev = state.bySession[action.sessionId];
			if (prev?.status === action.status && prev.detail === action.detail) {
				return state;
			}
			const next: PhasesState["bySession"] = {
				...state.bySession,
				[action.sessionId]: { status: action.status, detail: action.detail },
			};
			const currentItem =
				action.status === "digesting" && action.topic
					? `Digesting ${action.topic}`
					: action.status === "digested"
						? null
						: state.currentItem;
			return { bySession: next, currentItem };
		}
		case "CLEAR_CURRENT":
			return { ...state, currentItem: null };
		default:
			return state;
	}
}

// ── Mapping ─────────────────────────────────────────────────────────────

function progressPhaseToStatus(
	phase: DashboardProgressEvent["phase"],
): DashboardStatus | null {
	switch (phase) {
		case "pending":
			return null; // pending isn't a row-status, leave derived status alone
		case "digesting":
			return "digesting";
		case "digested":
			return "digested";
		case "failed":
			return "failed";
		default:
			return null;
	}
}

// ── Component ────────────────────────────────────────────────────────────

export function DashboardApp(props: DashboardAppProps): React.ReactElement {
	const {
		projectPath: _projectPath,
		targetPath: _targetPath,
		entries,
		runCount: _runCount,
		modelLabel,
		concurrency,
		initialFilter,
		startupConfirm = false,
		onExit,
		onLaunchExtraction,
		subscribeToExtractionEvents,
	} = props;

	const { exit } = useApp();
	const { stdout } = useStdout();
	const totalCols = Math.max(80, stdout?.columns ?? 100);
	const totalRows = Math.max(20, (stdout?.rows ?? 30) - 1);

	const [filter, setFilter] = useState<FilterState>(
		initialFilter ?? DEFAULT_FILTER,
	);
	const [cursor, setCursor] = useState(0);
	const [searchMode, setSearchMode] = useState(false);
	const [query, setQuery] = useState(filter.query);

	const initialExtractable = useMemo(
		() => countExtractable(entries),
		[entries],
	);
	const [overlayOpen, setOverlayOpen] = useState(
		startupConfirm && initialExtractable > 0,
	);

	// Phases: id-keyed live status overrides.
	const [phases, dispatch] = useReducer(phasesReducer, {
		bySession: {},
		currentItem: null,
	} as PhasesState);

	// Pending event buffer flushed every 150ms to avoid flicker (see report).
	const pendingRef = useRef<DashboardProgressEvent[]>([]);

	// Subscribe to extraction events.
	useEffect(() => {
		if (!subscribeToExtractionEvents) return undefined;
		const unsub = subscribeToExtractionEvents((event) => {
			pendingRef.current.push(event);
		});
		const handle = setInterval(() => {
			if (pendingRef.current.length === 0) return;
			const events = pendingRef.current;
			pendingRef.current = [];
			for (const event of events) {
				const status = progressPhaseToStatus(event.phase);
				if (!status) continue;
				const topic = entries.find(
					(e) => e.sourceSession.id === event.sessionId,
				)?.exploration.name;
				dispatch({
					type: "PATCH",
					sessionId: event.sessionId,
					status,
					detail: event.detail,
					topic,
				});
			}
		}, 150);
		return () => {
			clearInterval(handle);
			unsub();
		};
	}, [subscribeToExtractionEvents, entries]);

	const filtered = useMemo(
		() => applyExploreFilter(entries, { ...filter, query }),
		[entries, filter, query],
	);

	const liveMap = useMemo(() => {
		return new Map(
			Object.entries(phases.bySession).map(([id, v]) => [id, v]),
		);
	}, [phases.bySession]);

	const views: DashboardEntryView[] = useMemo(
		() => projectEntries(filtered, liveMap),
		[filtered, liveMap],
	);

	const bounded =
		views.length === 0 ? 0 : Math.min(cursor, views.length - 1);
	const current = views[bounded]?.entry;

	// ── Input ────────────────────────────────────────────────────────────

	const launch = useCallback(() => {
		setOverlayOpen(false);
		onLaunchExtraction?.();
	}, [onLaunchExtraction]);

	useInput(
		(input, key) => {
			if (input === "y" || input === "Y") {
				launch();
				return;
			}
			if (
				input === "n" ||
				input === "N" ||
				key.escape ||
				(key.ctrl && input === "c")
			) {
				setOverlayOpen(false);
			}
		},
		{ isActive: overlayOpen },
	);

	useInput(
		(input, key) => {
			if (key.return || key.escape) {
				setSearchMode(false);
				setFilter((f) => ({ ...f, query }));
				return;
			}
			if (key.backspace || key.delete) {
				setQuery((q) => q.slice(0, -1));
				return;
			}
			if (input && !key.ctrl && !key.meta) {
				const printable = input.replace(/[^\x20-\x7e]/g, "");
				if (printable.length > 0) {
					setQuery((q) => q + printable);
				}
			}
		},
		{ isActive: searchMode && !overlayOpen },
	);

	useInput(
		(input, key) => {
			if (input === "q" || (key.ctrl && input === "c")) {
				onExit({ kind: "none" });
				exit();
				return;
			}
			if (input === "j" || key.downArrow) {
				setCursor((c) => Math.min(views.length - 1, c + 1));
				return;
			}
			if (input === "k" || key.upArrow) {
				setCursor((c) => Math.max(0, c - 1));
				return;
			}
			if (input === "/") {
				setSearchMode(true);
				setQuery(filter.query);
				return;
			}
			if (key.return) {
				if (!current) return;
				onExit({ kind: "detail", entry: current });
				exit();
				return;
			}
			if (input === "v") {
				if (!current) return;
				onExit({ kind: "transcript", entry: current });
				exit();
				return;
			}
			if (input === "b") {
				if (!current) return;
				onExit({ kind: "beats", entry: current });
				exit();
				return;
			}
			if (input === "D") {
				if (!current) return;
				onExit({ kind: "digest", entry: current });
				exit();
				return;
			}
			if (input === "R") {
				if (!current) return;
				onExit({ kind: "reflect", entry: current });
				exit();
				return;
			}
			if (input === "P") {
				if (!current) return;
				onExit({ kind: "promote", entry: current });
				exit();
				return;
			}
		},
		{ isActive: !overlayOpen && !searchMode },
	);

	// ── Render ───────────────────────────────────────────────────────────

	if (overlayOpen) {
		return (
			<ConfirmOverlay
				extractable={initialExtractable}
				model={modelLabel}
				concurrency={concurrency}
				totalRows={totalRows}
			/>
		);
	}

	return (
		<Box flexDirection="column" height={totalRows}>
			<Header
				totalShown={views.length}
				totalAll={entries.length}
				filter={{ ...filter, query }}
				searchMode={searchMode}
			/>
			<TableHeader width={totalCols} />
			<Box flexDirection="column" flexGrow={1} overflow="hidden">
				{views.length === 0 ? (
					<Box paddingX={1} paddingY={1}>
						<Text color="gray">
							No explorations match the current filter.
						</Text>
					</Box>
				) : (
					views.map((v, i) => (
						<Row
							key={v.entry.sourceSession.id}
							view={v}
							selected={i === bounded}
							width={totalCols}
						/>
					))
				)}
			</Box>
			<StatusBar
				currentItem={phases.currentItem}
				keysHint={
					searchMode
						? "Type to filter · Enter/Esc commit"
						: "↑/↓ select · Enter detail · D digest · v transcript · b beats · R reflect · P promote · / search · q quit"
				}
			/>
		</Box>
	);
}

// ── Pieces ───────────────────────────────────────────────────────────────

function Header(props: {
	totalShown: number;
	totalAll: number;
	filter: FilterState;
	searchMode: boolean;
}): React.ReactElement {
	return (
		<Box paddingX={1} flexShrink={0}>
			<Text bold color="cyan">
				Explorations
			</Text>
			<Text color="gray">
				{" "}
				({props.totalShown}/{props.totalAll})
			</Text>
			<Text color="gray"> · </Text>
			<Text color="cyan">{props.filter.date}</Text>
			{props.searchMode ? (
				<>
					<Text color="gray"> · </Text>
					<Text color="magenta">/{props.filter.query || ""}</Text>
					<Text color="yellow">_</Text>
				</>
			) : props.filter.query ? (
				<>
					<Text color="gray"> · </Text>
					<Text color="magenta">"{props.filter.query}"</Text>
				</>
			) : null}
		</Box>
	);
}

// Column widths — sum to a sensible total. Topic gets the slack.
const COL_STATUS_WIDTH = 11;
const COL_SOURCE_WIDTH = 4;
const COL_MSGS_WIDTH = 6;
const COL_TOOLS_WIDTH = 7;
const COL_CANDS_WIDTH = 7;
const COL_AGE_WIDTH = 6;
const COL_FIXED_TOTAL =
	COL_STATUS_WIDTH +
	COL_SOURCE_WIDTH +
	COL_MSGS_WIDTH +
	COL_TOOLS_WIDTH +
	COL_CANDS_WIDTH +
	COL_AGE_WIDTH;

function topicWidth(totalWidth: number): number {
	// 4 for selection marker + outer padding/gutter
	return Math.max(15, totalWidth - COL_FIXED_TOTAL - 6);
}

function TableHeader({ width }: { width: number }): React.ReactElement {
	const topicW = topicWidth(width);
	return (
		<Box paddingX={1} flexShrink={0}>
			<Box width={2}>
				<Text> </Text>
			</Box>
			<Box width={COL_STATUS_WIDTH}>
				<Text color="gray" bold>
					status
				</Text>
			</Box>
			<Box width={COL_SOURCE_WIDTH}>
				<Text color="gray" bold>
					src
				</Text>
			</Box>
			<Box width={topicW}>
				<Text color="gray" bold>
					topic
				</Text>
			</Box>
			<Box width={COL_MSGS_WIDTH}>
				<Text color="gray" bold>
					msgs
				</Text>
			</Box>
			<Box width={COL_TOOLS_WIDTH}>
				<Text color="gray" bold>
					tools
				</Text>
			</Box>
			<Box width={COL_CANDS_WIDTH}>
				<Text color="gray" bold>
					cand
				</Text>
			</Box>
			<Box width={COL_AGE_WIDTH}>
				<Text color="gray" bold>
					age
				</Text>
			</Box>
		</Box>
	);
}

interface RowProps {
	view: DashboardEntryView;
	selected: boolean;
	width: number;
}

const Row = React.memo(function Row({
	view,
	selected,
	width,
}: RowProps): React.ReactElement {
	const { entry, status, messageCount, toolCount, candidateCount } = view;
	const topicW = topicWidth(width);
	const topic = truncate(entry.exploration.name, topicW - 1);
	const src = sourceBadge(entry.sourceSession.source);

	return (
		<Box paddingX={1} flexShrink={0}>
			<Box width={2}>
				<Text bold color="cyan">
					{selected ? "▶" : " "}
				</Text>
			</Box>
			<Box width={COL_STATUS_WIDTH}>
				<Text color={statusColor(status)} bold>
					{status}
				</Text>
			</Box>
			<Box width={COL_SOURCE_WIDTH}>
				<Text color="cyan">[{src}]</Text>
			</Box>
			<Box width={topicW}>
				<Text color={selected ? "white" : "gray"}>{topic}</Text>
			</Box>
			<Box width={COL_MSGS_WIDTH}>
				<Text color="yellow">{messageCount}</Text>
			</Box>
			<Box width={COL_TOOLS_WIDTH}>
				<Text color="yellow">{toolCount}</Text>
			</Box>
			<Box width={COL_CANDS_WIDTH}>
				<Text color="magenta">{candidateCount}</Text>
			</Box>
			<Box width={COL_AGE_WIDTH}>
				<Text color="gray">{ago(entry.modifiedMs)}</Text>
			</Box>
		</Box>
	);
});

function StatusBar(props: {
	currentItem: string | null;
	keysHint: string;
}): React.ReactElement {
	return (
		<Box
			flexShrink={0}
			borderStyle="single"
			borderColor="gray"
			paddingX={1}
			flexDirection="column"
		>
			<Text color={props.currentItem ? "yellow" : "gray"}>
				{props.currentItem ?? "idle"}
			</Text>
			<Text color="gray" dimColor>
				{props.keysHint}
			</Text>
		</Box>
	);
}

// ── Confirmation overlay ─────────────────────────────────────────────────

interface ConfirmOverlayProps {
	extractable: number;
	model: string;
	concurrency: number;
	totalRows: number;
}

function ConfirmOverlay({
	extractable,
	model,
	concurrency,
	totalRows,
}: ConfirmOverlayProps): React.ReactElement {
	return (
		<Box flexDirection="column" paddingX={2} paddingY={2} height={totalRows}>
			<Box
				borderStyle="round"
				borderColor="yellow"
				paddingX={2}
				paddingY={1}
				flexDirection="column"
			>
				<Text bold color="yellow">
					Launch extraction?
				</Text>
				<Box marginTop={1}>
					<Text color="gray">
						{extractable} exploration{extractable === 1 ? "" : "s"} need
						{extractable === 1 ? "s" : ""} extraction
					</Text>
				</Box>
				<Box>
					<Text color="gray">model: </Text>
					<Text color="cyan">{model}</Text>
				</Box>
				<Box>
					<Text color="gray">concurrency: </Text>
					<Text color="cyan">{concurrency}</Text>
				</Box>
				<Box marginTop={1}>
					<Text color="yellow">⚠ Uses an LLM (API cost will apply).</Text>
				</Box>
				<Box marginTop={1}>
					<Text bold color="green">
						[y]
					</Text>
					<Text color="gray"> launch </Text>
					<Text bold color="red">
						[n/Esc]
					</Text>
					<Text color="gray"> cancel</Text>
				</Box>
			</Box>
		</Box>
	);
}
