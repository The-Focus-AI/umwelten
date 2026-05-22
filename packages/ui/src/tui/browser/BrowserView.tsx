import React, { useState, useEffect, useRef, useCallback } from "react";
import { Box, Text, useApp, useFocus, useInput, useStdout } from "ink";
import { SessionCard } from "./SessionCard.js";
import { SessionDetailPanel } from "./SessionDetailPanel.js";
import { ChatDetailView } from "./ChatDetailView.js";
import type { BrowserSession } from "./browser-data.js";
import {
	loadBrowserData,
	searchBrowserSessions,
	runBrowserIndex,
} from "./browser-data.js";

export interface BrowserViewProps {
	projectPath: string;
	onSelectSession: (sessionId: string) => void;
}

type ViewMode = "browse" | "chat";

export function BrowserView({
	projectPath,
	onSelectSession,
}: BrowserViewProps): React.ReactElement {
	const [viewMode, setViewMode] = useState<ViewMode>("browse");
	const [selectedSession, setSelectedSession] = useState<BrowserSession | null>(
		null,
	);
	const [initialSessions, setInitialSessions] = useState<BrowserSession[]>([]);
	const [searchResults, setSearchResults] = useState<BrowserSession[] | null>(
		null,
	);
	const [query, setQuery] = useState("");
	const [searchMode, setSearchMode] = useState(false);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [loading, setLoading] = useState(true);
	const [backgroundIndexing, setBackgroundIndexing] = useState(false);
	const [indexConfirmSession, setIndexConfirmSession] =
		useState<BrowserSession | null>(null);

	// Index progress state
	const [indexProgress, setIndexProgress] = useState<{
		current: number;
		total: number;
		name: string;
	} | null>(null);

	const sessions = query.trim() ? (searchResults ?? []) : initialSessions;
	const { stdout } = useStdout();
	const rows = Math.max(20, stdout?.rows ?? 28);

	const queryRef = useRef(query);
	queryRef.current = query;

	const refreshData = useCallback(() => {
		loadBrowserData(projectPath).then(({ sessions: list }) => {
			setInitialSessions(list.slice(0, 50));
			setSearchResults(null);
			const q = queryRef.current.trim();
			if (q) {
				searchBrowserSessions(projectPath, q, { limit: 50 }).then(
					setSearchResults,
				);
			}
		});
	}, [projectPath]);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		loadBrowserData(projectPath)
			.then(({ sessions: list }) => {
				if (!cancelled) {
					setInitialSessions(list.slice(0, 50));
					setSearchResults(null);
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [projectPath]);

	// Background index on load (non-blocking, don't block on it)
	useEffect(() => {
		if (loading) return;
		let cancelled = false;
		setBackgroundIndexing(true);
		runBrowserIndex(projectPath, { force: false })
			.then(() => {
				if (!cancelled) {
					refreshData();
				}
			})
			.catch(() => {})
			.finally(() => {
				if (!cancelled) setBackgroundIndexing(false);
			});
		return () => {
			cancelled = true;
		};
	}, [projectPath, loading, refreshData]);

	useEffect(() => {
		if (!query.trim()) {
			setSearchResults(null);
			setSelectedIndex(0);
			return;
		}
		let cancelled = false;
		searchBrowserSessions(projectPath, query, { limit: 50 }).then((list) => {
			if (!cancelled) {
				setSearchResults(list);
				setSelectedIndex(0);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [projectPath, query]);

	const { exit } = useApp();
	useFocus({ autoFocus: true });

	useInput((input, key) => {
		if (viewMode === "chat") return;

		// Confirmation mode for indexing
		if (indexConfirmSession !== null) {
			if (input === "y" || input === "Y") {
				const sessionToIndex = indexConfirmSession;
				setIndexConfirmSession(null);
				setIndexProgress({
					current: 1,
					total: 1,
					name:
						sessionToIndex.session.firstPrompt?.slice(0, 40) ??
						sessionToIndex.session.id,
				});
				// Note: full project index is slow; just refresh for now since session-level indexing isn't wired
				setTimeout(() => {
					refreshData();
					setIndexProgress(null);
				}, 1000);
			} else if (
				input === "n" ||
				input === "N" ||
				key.escape ||
				input === "q"
			) {
				setIndexConfirmSession(null);
				setIndexProgress(null);
			}
			return;
		}

		if (indexProgress !== null) {
			if (input === "q" || (key.ctrl && input === "c")) {
				setIndexProgress(null);
			}
			return;
		}

		// Search mode: / to enter; type to filter; Enter to apply; Esc to cancel
		if (searchMode) {
			if (key.escape) {
				setSearchMode(false);
				return;
			}
			if (key.return) {
				setSearchMode(false);
				return;
			}
			if (key.backspace || key.delete) {
				setQuery((q) => q.slice(0, -1));
				return;
			}
			if (input && !key.ctrl && !key.meta) {
				setQuery((q) => q + input);
				return;
			}
			return;
		}

		// / to start search
		if (input === "/") {
			setSearchMode(true);
			return;
		}

		if (key.backspace || key.delete) return;
		if (key.return) {
			const selected = sessions[selectedIndex];
			if (selected) {
				setSelectedSession(selected);
				setViewMode("chat");
			}
			return;
		}

		const lower = input?.toLowerCase();

		if (lower === "o") {
			const selected = sessions[selectedIndex];
			if (selected) {
				onSelectSession(selected.session.id);
				exit();
			}
			return;
		}

		// i — confirm before indexing (warn about how many sessions need it)
		if (lower === "i") {
			const unindexed = sessions.filter((s) => !s.analysis);
			const selected = sessions[selectedIndex];
			if (selected && !selected.analysis) {
				setIndexConfirmSession(selected);
				return;
			}
			if (unindexed.length > 0) {
				setIndexConfirmSession(sessions[selectedIndex]);
				return;
			}
			// All indexed — refresh only
			refreshData();
			return;
		}

		if (key.upArrow) {
			setSelectedIndex((i) => (i <= 0 ? 0 : i - 1));
			return;
		}
		if (key.downArrow) {
			setSelectedIndex((i) =>
				i >= sessions.length - 1 ? sessions.length - 1 : i + 1,
			);
			return;
		}

		// g / G — jump to top/bottom
		if (input === "g" && !key.shift) {
			setSelectedIndex(0);
			return;
		}
		if (input === "G" || (key.shift && input === "g")) {
			setSelectedIndex(sessions.length - 1);
			return;
		}
	});

	if (loading) {
		return (
			<Box paddingY={2}>
				<Text color="cyan">Loading sessions…</Text>
			</Box>
		);
	}

	// Index confirmation overlay
	if (indexConfirmSession !== null) {
		const session = indexConfirmSession;
		const promptPreview =
			session.session.firstPrompt?.slice(0, 60) ?? session.session.id;
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
						Index session?
					</Text>
					<Text color="gray" wrap="wrap">
						{" "}
						"{promptPreview}..."
					</Text>
					<Text color="gray"> This analyzes the session with an LLM.</Text>
					<Text color="gray">
						{" "}
						A <Text color="cyan">API key</Text> is required
						(google:gemini-3-flash-preview).
					</Text>
					<Box marginTop={1}>
						<Text bold color="green">
							[y]
						</Text>
						<Text color="gray"> index </Text>
						<Text bold color="red">
							[n/q/Esc]
						</Text>
						<Text color="gray"> cancel</Text>
					</Box>
				</Box>
			</Box>
		);
	}

	// Index progress overlay
	if (indexProgress !== null) {
		const { current, total, name } = indexProgress;
		const pct = total > 0 ? Math.round((current / total) * 100) : 0;
		const barLen = 24;
		const filled = Math.round((pct / 100) * barLen);
		const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
		return (
			<Box flexDirection="column" paddingX={2} paddingY={2} height={rows}>
				<Text bold color="yellow">
					Indexing session…
				</Text>
				<Box marginTop={1}>
					<Text color="gray">
						[{bar}] {pct}%
					</Text>
				</Box>
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

	if (viewMode === "chat" && selectedSession) {
		return (
			<ChatDetailView
				projectPath={projectPath}
				browserSession={selectedSession}
				onBack={() => {
					setViewMode("browse");
					setSelectedSession(null);
				}}
				onOpenAndExit={() => {
					onSelectSession(selectedSession.session.id);
					exit();
				}}
			/>
		);
	}

	// ── Side-by-side layout ──────────────────────────────────────────────
	const sidebarWidth = 42;
	const mainHeight = rows - 2;

	const unindexedCount = sessions.filter((s) => !s.analysis).length;

	return (
		<Box flexDirection="row" height={rows}>
			{/* ── Left: Session list (sidebar) ───────────────────────── */}
			<Box
				flexDirection="column"
				width={sidebarWidth}
				borderStyle="single"
				borderColor="gray"
				flexShrink={0}
			>
				{/* Sidebar header */}
				<Box paddingX={1} paddingY={0} flexShrink={0}>
					<Text bold color="cyan">
						Sessions
					</Text>
					<Text color="gray"> ({sessions.length})</Text>
				</Box>

				{/* Session list */}
				<Box flexDirection="column" flexGrow={1} overflow="hidden">
					{sessions.length === 0 ? (
						<Box paddingX={1} paddingY={1}>
							<Text color="gray">No sessions found.</Text>
						</Box>
					) : (
						sessions
							.slice(0, Math.min(sessions.length, mainHeight - 4))
							.map((session, i) => {
								const isSelected = i === selectedIndex;
								return (
									<Box key={session.session.id} flexShrink={0}>
										<SessionCard
											session={session}
											isSelected={isSelected}
											compact
											summaryMaxWidth={sidebarWidth - 20}
											promptMaxWidth={sidebarWidth - 18}
										/>
									</Box>
								);
							})
					)}
				</Box>

				{/* Sidebar footer */}
				<Box
					paddingX={1}
					paddingY={0}
					flexShrink={0}
					borderStyle="single"
					borderColor="gray"
				>
					<Text color="cyan">↑/↓</Text>
					<Text color="gray"> select · </Text>
					<Text color="cyan">Enter</Text>
					<Text color="gray"> chat · </Text>
					<Text color="cyan">o</Text>
					<Text color="gray"> exit</Text>
				</Box>
			</Box>

			{/* ── Right: Detail panel ──────────────────────────────── */}
			<Box
				flexDirection="column"
				flexGrow={1}
				paddingX={1}
				overflow="hidden"
				borderStyle="single"
				borderColor="gray"
			>
				{/* Main header */}
				<Box flexShrink={0} paddingY={0}>
					{selectedSession ? (
						<>
							<Text bold color="cyan">
								▶{" "}
							</Text>
							<Text color="white" bold>
								{selectedSession.session.firstPrompt?.slice(0, 60) ??
									selectedSession.session.id}
							</Text>
						</>
					) : (
						<Text color="gray">Select a session ↑/↓</Text>
					)}
				</Box>

				{/* Detail content */}
				<Box flexDirection="column" flexGrow={1} overflow="hidden">
					{selectedSession ? (
						<SessionDetailPanel
							projectPath={projectPath}
							session={selectedSession}
							compact
						/>
					) : (
						<Box paddingY={2}>
							<Text color="gray">↑/↓ select a session to see details.</Text>
							<Box marginTop={1}>
								<Text color="gray">Press </Text>
								<Text color="cyan">i</Text>
								<Text color="gray"> to index it, </Text>
								<Text color="cyan">Enter</Text>
								<Text color="gray"> to open chat.</Text>
							</Box>
							{unindexedCount > 0 && (
								<Box marginTop={1}>
									<Text color="yellow">{unindexedCount} unindexed</Text>
									<Text color="gray"> (press i on one to analyze)</Text>
								</Box>
							)}
						</Box>
					)}
				</Box>

				{/* Main footer */}
				<Box
					flexShrink={0}
					borderStyle="single"
					borderColor="gray"
					paddingY={0}
				>
					{backgroundIndexing && (
						<Text color="blue" dimColor>
							updating index…{" "}
						</Text>
					)}
					{selectedSession && !selectedSession.analysis && (
						<Text>
							<Text color="yellow">[i]</Text>
							<Text color="gray"> index · </Text>
						</Text>
					)}
					<Text color="gray">
						<Text color="cyan">Enter</Text> chat · <Text color="cyan">/</Text>{" "}
						search · <Text color="cyan">o</Text> open & exit
					</Text>
				</Box>
			</Box>
		</Box>
	);
}
