/**
 * Per-session detail view. Opened from browse with Enter.
 *
 * Tabbed full-screen view over a session's digest content:
 *   Overview · Beats · Phases · Facts · Diff
 *
 * Keys:
 *   tab / shift-tab   cycle tabs
 *   1..5              jump directly to a tab
 *   j/k · up/down     scroll the active tab
 *   g/G               top/bottom of active tab
 *   D                 run the digester live (if no digest yet, or refresh)
 *   q · esc           back to browser
 */

import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import type { SessionBrowserEntry } from "@umwelten/evaluation/introspection/browse.js";
import { loadDigest } from "@umwelten/evaluation/introspection/browse.js";
import type { SessionDigest } from "@umwelten/core/interaction/analysis/analysis-types.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";

export interface RunDigestDetailTuiOptions {
	projectPath: string;
	targetPath: string;
	entry: SessionBrowserEntry;
	model: ModelDetails;
}

type Tab = "overview" | "beats" | "phases" | "facts" | "diff";
const TABS: Tab[] = ["overview", "beats", "phases", "facts", "diff"];
const TAB_LABELS: Record<Tab, string> = {
	overview: "Overview",
	beats: "Beats",
	phases: "Phases",
	facts: "Facts",
	diff: "Diff",
};

/** Split a paragraph into approximately `width`-column lines, preserving words. */
function wrap(text: string, width: number): string[] {
	const out: string[] = [];
	const paragraphs = text.split(/\n/);
	for (const p of paragraphs) {
		if (p === "") {
			out.push("");
			continue;
		}
		const words = p.split(/\s+/);
		let line = "";
		for (const w of words) {
			if ((line + " " + w).trim().length > width) {
				if (line) out.push(line);
				line = w;
			} else {
				line = line ? line + " " + w : w;
			}
		}
		if (line) out.push(line);
	}
	return out;
}

function formatAge(ms: number): string {
	const diff = Date.now() - ms;
	const mins = Math.floor(diff / 60_000);
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 48) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	return `${days}d ago`;
}

function formatDuration(ms: number): string {
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
}

interface DetailAppProps {
	entry: SessionBrowserEntry;
	initialDigest: SessionDigest | null;
	onRunDigest: () => Promise<SessionDigest | null>;
}

function DetailApp({
	entry,
	initialDigest,
	onRunDigest,
}: DetailAppProps): React.ReactElement {
	const { exit } = useApp();
	const { stdout } = useStdout();
	const rows = Math.max(24, (stdout?.rows ?? 40) - 1);
	const cols = Math.max(60, (stdout?.columns ?? 120) - 2);

	const [digest, setDigest] = useState<SessionDigest | null>(initialDigest);
	const [tabIdx, setTabIdx] = useState(0);
	const [scroll, setScroll] = useState(0);
	const [refreshing, setRefreshing] = useState(false);

	const tab = TABS[tabIdx];

	// Build the full content (as a string[] of lines) for the active tab.
	// This lets scrolling be a simple window, and the rendering is uniform.
	const contentLines: string[] = useMemo(() => {
		if (!digest) {
			return [
				"",
				`No digest for ${entry.id.slice(0, 8)}.`,
				"",
				"Press D to run the digester on this session.",
				"It extracts: summary, topics, tags, phases, beats, and facts.",
				"Typical runtime: 30-90 seconds.",
			];
		}
		switch (tab) {
			case "overview":
				return buildOverviewLines(digest, cols - 4);
			case "beats":
				return buildBeatsLines(digest, cols - 4);
			case "phases":
				return buildPhasesLines(digest, cols - 4);
			case "facts":
				return buildFactsLines(digest, cols - 4);
			case "diff":
				return [
					"",
					"Diff-against-CLAUDE.md view (coming next).",
					"",
					"This tab will show a unified diff of proposed additions derived",
					"from the digest's key learnings and high-value facts.",
				];
		}
	}, [digest, tab, cols, entry.id]);

	// Clamp scroll whenever tab or content changes.
	const bodyHeight = Math.max(6, rows - 6);
	const maxScroll = Math.max(0, contentLines.length - bodyHeight);
	useEffect(() => {
		setScroll((s) => Math.min(s, maxScroll));
	}, [maxScroll, tab]);

	useInput((input, key) => {
		if (refreshing) return;
		if (input === "q" || key.escape) {
			exit();
			return;
		}
		if (key.tab && key.shift) {
			setTabIdx((i) => (i - 1 + TABS.length) % TABS.length);
			setScroll(0);
			return;
		}
		if (key.tab) {
			setTabIdx((i) => (i + 1) % TABS.length);
			setScroll(0);
			return;
		}
		if (["1", "2", "3", "4", "5"].includes(input)) {
			const i = parseInt(input, 10) - 1;
			if (i >= 0 && i < TABS.length) {
				setTabIdx(i);
				setScroll(0);
			}
			return;
		}
		if (input === "j" || key.downArrow) {
			setScroll((s) => Math.min(maxScroll, s + 1));
		} else if (input === "k" || key.upArrow) {
			setScroll((s) => Math.max(0, s - 1));
		} else if (input === " " || key.pageDown) {
			setScroll((s) => Math.min(maxScroll, s + bodyHeight));
		} else if (key.pageUp) {
			setScroll((s) => Math.max(0, s - bodyHeight));
		} else if (input === "g") {
			setScroll(0);
		} else if (input === "G") {
			setScroll(maxScroll);
		} else if (input === "D") {
			// Refresh / create digest. This exits the TUI, the caller runs the live
			// digest TUI, then we reload on the way back.
			exit();
		}
	});

	const windowLines = contentLines.slice(scroll, scroll + bodyHeight);

	return (
		<Box flexDirection="column" height={rows}>
			{/* Header */}
			<Box borderStyle="single" borderColor="gray" paddingX={1}>
				<Text bold>{entry.id.slice(0, 8)}</Text>
				<Text
					dimColor
				>{`  · ${entry.source} · ${entry.messageCount} msgs · ${entry.gitBranch ?? "-"} · modified ${formatAge(entry.modifiedMs)}`}</Text>
				{digest?.analysis?.successIndicators && (
					<>
						<Text dimColor>{"  · "}</Text>
						{renderSuccessInline(digest.analysis.successIndicators)}
					</>
				)}
			</Box>

			{/* Tab bar */}
			<Box borderStyle="single" borderColor="gray" paddingX={1}>
				{TABS.map((t, i) => {
					const active = i === tabIdx;
					return (
						<Text
							key={t}
							color={active ? "cyan" : undefined}
							bold={active}
							dimColor={!active}
						>
							{` ${i + 1} ${TAB_LABELS[t]} `}
						</Text>
					);
				})}
				{!digest && <Text color="yellow">{"  (no digest yet — press D)"}</Text>}
			</Box>

			{/* Body */}
			<Box
				flexDirection="column"
				flexGrow={1}
				borderStyle="single"
				borderColor="gray"
				paddingX={1}
			>
				{windowLines.length === 0 ? (
					<Text dimColor>(empty)</Text>
				) : (
					windowLines.map((line, i) => (
						<Box key={`${scroll}-${i}`}>
							<Text>{line || " "}</Text>
						</Box>
					))
				)}
			</Box>

			{/* Footer */}
			<Box borderStyle="single" borderColor="gray" paddingX={1}>
				<Text dimColor>
					{`line ${Math.min(scroll + 1, Math.max(1, contentLines.length))}/${contentLines.length}  `}
				</Text>
				<Text dimColor>tab </Text>
				<Text color="cyan">1-5</Text>
				<Text dimColor> · j/k scroll · </Text>
				<Text color="cyan">D</Text>
				<Text dimColor> digest · </Text>
				<Text color="cyan">q</Text>
				<Text dimColor> back</Text>
			</Box>
		</Box>
	);
}

function renderSuccessInline(indicator: string): React.ReactElement {
	const map: Record<string, { label: string; color: string }> = {
		yes: { label: "✓ success", color: "green" },
		partial: { label: "◐ partial", color: "yellow" },
		no: { label: "✗ failed", color: "red" },
		unclear: { label: "? unclear", color: "gray" },
	};
	const v = map[indicator] ?? { label: indicator, color: "gray" };
	return (
		<Text color={v.color as "green" | "yellow" | "red" | "gray"}>
			{v.label}
		</Text>
	);
}

// ─── Tab content builders ───────────────────────────────────────────────────

function buildOverviewLines(digest: SessionDigest, width: number): string[] {
	const lines: string[] = [];
	const a = digest.analysis;

	lines.push("SUMMARY");
	lines.push(...wrap(digest.overallSummary || "(empty)", width));
	lines.push("");

	if (a.keyLearnings) {
		lines.push("KEY LEARNING");
		lines.push(...wrap(a.keyLearnings, width));
		lines.push("");
	}

	if (a.topics.length) {
		lines.push("TOPICS");
		lines.push(`  ${a.topics.join("  ·  ")}`);
		lines.push("");
	}
	if (a.tags.length) {
		lines.push("TAGS");
		lines.push(`  ${a.tags.join("  ·  ")}`);
		lines.push("");
	}

	lines.push("CLASSIFICATION");
	lines.push(`  Solution type: ${a.solutionType}`);
	lines.push(`  Success:       ${a.successIndicators}`);
	if (a.codeLanguages?.length) {
		lines.push(`  Languages:     ${a.codeLanguages.join(", ")}`);
	}
	if (a.toolsUsed?.length) {
		lines.push(`  Tools used:    ${a.toolsUsed.join(", ")}`);
	}
	lines.push("");

	if (digest.metrics) {
		lines.push("METRICS");
		lines.push(`  Messages:      ${digest.metrics.messageCount}`);
		lines.push(`  Segments:      ${digest.metrics.segmentCount}`);
		lines.push(`  Tool calls:    ${digest.metrics.toolCallCount}`);
		if (digest.metrics.duration) {
			lines.push(`  Duration:      ${formatDuration(digest.metrics.duration)}`);
		}
		if (digest.metrics.estimatedCost) {
			lines.push(
				`  Est. cost:     $${digest.metrics.estimatedCost.toFixed(3)}`,
			);
		}
		lines.push("");
	}

	lines.push("DIGEST META");
	lines.push(`  Digested at: ${digest.digestedAt}`);
	lines.push(`  Beats:       ${digest.beats?.length ?? 0}`);
	lines.push(`  Phases:      ${digest.phases?.length ?? 0}`);
	lines.push(`  Facts:       ${digest.extractedFacts?.length ?? 0}`);

	return lines;
}

function buildBeatsLines(digest: SessionDigest, width: number): string[] {
	if (!digest.beats?.length) {
		return [
			"(no beats in this digest)",
			"",
			"This digest was generated without beat extraction.",
		];
	}
	const lines: string[] = [];
	for (const b of digest.beats) {
		lines.push("");
		lines.push(`━━ Beat ${b.index + 1} of ${digest.beats.length} ━━`);
		lines.push("");
		lines.push("USER");
		lines.push(
			...wrap(b.userRequest || "(no prompt)", width - 2).map((l) => `  ${l}`),
		);
		if (b.toolsUsed?.length) {
			lines.push("");
			lines.push(
				`TOOLS  ${b.toolsUsed.map((t) => (t.count > 1 ? `${t.name}×${t.count}` : t.name)).join("  ")}`,
			);
		}
		if (b.outcome) {
			lines.push("");
			lines.push("OUTCOME");
			lines.push(
				...wrap(b.outcome.slice(0, 800), width - 2).map((l) => `  ${l}`),
			);
		}
		if (b.narrative) {
			lines.push("");
			lines.push("NARRATIVE");
			lines.push(...wrap(b.narrative, width - 2).map((l) => `  ${l}`));
		}
		if (b.keyFacts?.length) {
			lines.push("");
			lines.push("KEY FACTS");
			for (const f of b.keyFacts) {
				lines.push(
					...wrap(`  · ${f}`, width).map((l, i) => (i === 0 ? l : `    ${l}`)),
				);
			}
		}
	}
	return lines;
}

function buildPhasesLines(digest: SessionDigest, width: number): string[] {
	if (!digest.phases?.length) {
		return [
			"(no phases)",
			"",
			"Phases are detected from beats; a digest without beats cannot have phases.",
		];
	}
	const lines: string[] = [];
	for (const [i, p] of digest.phases.entries()) {
		lines.push("");
		lines.push(`━━ Phase ${i + 1}: ${p.name} ━━`);
		lines.push(`  Beats ${p.beatRange[0] + 1}–${p.beatRange[1] + 1}`);
		lines.push("");
		lines.push(
			...wrap(p.description || "(no description)", width - 2).map(
				(l) => `  ${l}`,
			),
		);
	}
	return lines;
}

function buildFactsLines(digest: SessionDigest, width: number): string[] {
	if (!digest.extractedFacts?.length && !digest.allFacts?.length) {
		return ["(no facts extracted)"];
	}
	const lines: string[] = [];

	if (digest.extractedFacts?.length) {
		// Group by type
		const byType = new Map<string, string[]>();
		for (const f of digest.extractedFacts) {
			const type = f.type || "miscellaneous";
			if (!byType.has(type)) byType.set(type, []);
			byType.get(type)!.push(f.text);
		}
		for (const [type, facts] of byType.entries()) {
			lines.push(`━━ ${type.toUpperCase()} (${facts.length}) ━━`);
			for (const text of facts) {
				lines.push(
					...wrap(`  · ${text}`, width).map((l, i) =>
						i === 0 ? l : `    ${l}`,
					),
				);
			}
			lines.push("");
		}
	}

	if (digest.allFacts?.length) {
		lines.push("━━ RAW FACTS (FROM COMPACTION SEGMENTS) ━━");
		for (const text of digest.allFacts) {
			lines.push(
				...wrap(`  · ${text}`, width).map((l, i) => (i === 0 ? l : `    ${l}`)),
			);
		}
	}
	return lines;
}

// ─── Entry point ────────────────────────────────────────────────────────────

export async function runDigestDetailTui(
	opts: RunDigestDetailTuiOptions,
): Promise<void> {
	const { projectPath, entry, model } = opts;

	// Load digest once; the detail view lets the user press D to refresh by exiting
	// and re-entering (the browser event loop handles re-opening).
	const initialDigest = await loadDigest(projectPath, entry.id);

	const onRunDigest = async (): Promise<SessionDigest | null> => {
		// Not wired here — D exits and the browser's intent loop handles digest.
		return initialDigest;
	};

	const app = (
		<DetailApp
			entry={entry}
			initialDigest={initialDigest}
			onRunDigest={onRunDigest}
		/>
	);

	const renderOpts = { stdin: process.stdin, stdout: process.stdout };
	if (process.env.UMWELTEN_TUI_NO_FULLSCREEN === "1") {
		const instance = render(app, renderOpts);
		await instance.waitUntilExit();
		return;
	}
	try {
		const { withFullScreen } = await import("fullscreen-ink");
		const ink = withFullScreen(app, renderOpts);
		ink.start();
		await ink.waitUntilExit();
	} catch {
		const instance = render(app, renderOpts);
		await instance.waitUntilExit();
	}

	// Silence unused — model is passed through for future use (e.g. diff tab).
	void model;
}
