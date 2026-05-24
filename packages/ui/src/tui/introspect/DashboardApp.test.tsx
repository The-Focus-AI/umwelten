/**
 * Tests for the Exploration Browser dashboard TUI (issue #64).
 *
 * Uses ink-testing-library to render the component and assert on the rendered
 * frame string. Tests follow TDD vertical slices: each describe block exercises
 * one slice of behaviour through the public component interface.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import type {
	ExplorationBrowserEntry,
	FilterState,
} from "@umwelten/core/interaction/types/domain-types.js";
import type {
	SourceSession,
	Exploration,
} from "@umwelten/core/interaction/types/domain-types.js";
import type { SessionDigest } from "@umwelten/core/interaction/analysis/analysis-types.js";
import { createDefaultExploration } from "@umwelten/core/interaction/types/domain-types.js";
import { DashboardApp } from "./DashboardApp.js";
import type {
	DashboardStatus,
	DashboardProgressEvent,
} from "./dashboard/types.js";

// ── Helpers ─────────────────────────────────────────────────────────────

function makeSourceSession(
	overrides: Partial<SourceSession> = {},
): SourceSession {
	return {
		id: "src-test-001",
		source: "claude-code",
		sourceId: "test-001",
		title: "Fix database migration timeout",
		created: "2026-05-20T10:00:00.000Z",
		modified: "2026-05-22T11:00:00.000Z",
		messageCount: 24,
		firstPrompt: "Fix database migration timeout",
		...overrides,
	};
}

function makeDigest(sessionId: string, overrides: Partial<SessionDigest> = {}): SessionDigest {
	return {
		sessionId,
		projectPath: "/proj",
		projectName: "proj",
		source: "claude-code",
		created: "2026-05-20T10:00:00.000Z",
		modified: "2026-05-22T11:00:00.000Z",
		digestedAt: "2026-05-22T12:00:00.000Z",
		segments: [],
		overallSummary: "Investigated and fixed migration timeout via index tweak.",
		allFacts: [],
		analysis: {
			summary: "Migration timeout fixed",
			keyLearnings: "use partial indexes",
			topics: ["postgres", "migrations"],
			tags: ["bug-fix"],
			solutionType: "bug-fix",
			successIndicators: "yes",
			codeLanguages: [],
			toolsUsed: [],
			relatedFiles: [],
		},
		extractedFacts: [
			{ type: "decision", text: "Use partial index" },
			{ type: "constraint", text: "Migration must run online" },
		],
		metrics: {
			messageCount: 24,
			segmentCount: 3,
			toolCallCount: 7,
			estimatedCost: 0.12,
			duration: 1800,
		},
		...overrides,
	};
}

function makeEntry(
	id: string,
	overrides: {
		source?: SourceSession["source"];
		modifiedMs?: number;
		title?: string;
		messageCount?: number;
		toolCallCount?: number;
		digest?: SessionDigest | null;
		modifiedSinceAnalysis?: boolean;
		analyzedIn?: ExplorationBrowserEntry["analyzedIn"];
	} = {},
): ExplorationBrowserEntry {
	const session = makeSourceSession({
		id,
		source: overrides.source ?? "claude-code",
		title: overrides.title ?? `Exploration ${id}`,
		firstPrompt: overrides.title ?? `Exploration ${id}`,
		messageCount: overrides.messageCount ?? 5,
		modified: overrides.modifiedMs
			? new Date(overrides.modifiedMs).toISOString()
			: "2026-05-22T11:00:00.000Z",
		metrics:
			overrides.toolCallCount !== undefined
				? {
						userMessages: 0,
						assistantMessages: 0,
						toolCalls: overrides.toolCallCount,
				  }
				: undefined,
	});
	const { exploration } = createDefaultExploration(session);
	return {
		exploration,
		sourceSession: session,
		modifiedMs:
			overrides.modifiedMs ?? new Date(session.modified).getTime(),
		filePath: undefined,
		digest: overrides.digest ?? null,
		analyzedIn: overrides.analyzedIn ?? [],
		modifiedSinceAnalysis: overrides.modifiedSinceAnalysis ?? false,
		everAnalyzed: (overrides.analyzedIn?.length ?? 0) > 0,
	};
}

const DEFAULT_FILTER: FilterState = {
	date: "all",
	status: "all",
	source: "all",
	query: "",
};

function renderDashboard(
	overrides: Partial<React.ComponentProps<typeof DashboardApp>> = {},
) {
	const baseProps: React.ComponentProps<typeof DashboardApp> = {
		projectPath: "/proj",
		targetPath: "/proj",
		entries: [],
		runCount: 0,
		modelLabel: "google:gemini-3-flash-preview",
		concurrency: 1,
		initialFilter: DEFAULT_FILTER,
		// Auto-skip the startup confirmation in tests by default; individual
		// tests can opt-in by passing forceConfirm: true (the prop is honored
		// only inside the test surface, see DashboardApp props).
		startupConfirm: false,
		onExit: () => {},
		onLaunchExtraction: undefined,
	};
	return render(<DashboardApp {...baseProps} {...overrides} />);
}

// ── 1. Dashboard table rendering ─────────────────────────────────────────

describe("DashboardApp — table rendering", () => {
	it("renders an empty-state message when no entries match the filter", () => {
		const { lastFrame } = renderDashboard({ entries: [] });
		expect(lastFrame()).toMatch(/no explorations/i);
	});

	it("renders one row per entry with all required columns", () => {
		const entries = [
			makeEntry("a", {
				title: "Investigate flaky tests",
				messageCount: 10,
				toolCallCount: 4,
			}),
			makeEntry("b", {
				title: "Refactor auth module",
				messageCount: 30,
				toolCallCount: 12,
				source: "pi",
			}),
		];
		const { lastFrame } = renderDashboard({ entries });
		const frame = lastFrame() ?? "";

		// Both topics show
		expect(frame).toMatch(/Investigate flaky tests/);
		expect(frame).toMatch(/Refactor auth module/);

		// Message and tool counts show
		expect(frame).toMatch(/10/); // a.messageCount
		expect(frame).toMatch(/4/); // a.toolCallCount
		expect(frame).toMatch(/30/); // b.messageCount
		expect(frame).toMatch(/12/); // b.toolCallCount

		// Source badges
		expect(frame).toMatch(/\[C\]/); // claude-code badge
		expect(frame).toMatch(/\[P\]/); // pi badge
	});

	it("shows a header row with column labels", () => {
		const entries = [makeEntry("a")];
		const { lastFrame } = renderDashboard({ entries });
		const frame = lastFrame() ?? "";
		// Column labels — these strings are part of the public surface for the
		// dashboard table; if they change, this test should be updated.
		expect(frame).toMatch(/status/i);
		expect(frame).toMatch(/src/i);
		expect(frame).toMatch(/topic/i);
		expect(frame).toMatch(/msgs/i);
		expect(frame).toMatch(/tools/i);
	});

	it("truncates long topics so the row fits the available width", () => {
		const long = "x".repeat(200);
		const entries = [makeEntry("a", { title: long })];
		const { lastFrame } = renderDashboard({ entries });
		const frame = lastFrame() ?? "";
		// The full 200-char title cannot fit on one line; we expect truncation.
		expect(frame).not.toContain(long);
		expect(frame).toMatch(/x+…|x+\.\.\./);
	});

	it("renders many entries without crashing (table handles ~30 rows)", () => {
		const entries = Array.from({ length: 30 }, (_, i) =>
			makeEntry(`row-${i}`, { title: `Row ${i}` }),
		);
		const { lastFrame } = renderDashboard({ entries });
		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/Row 0/);
		// Last row may be scrolled off; check counts header instead
		expect(frame).toMatch(/30/);
	});
});

// ── 2. Status column ─────────────────────────────────────────────────────

describe("DashboardApp — status column", () => {
	it("shows 'new' for entries without a digest", () => {
		const entries = [makeEntry("a")];
		const { lastFrame } = renderDashboard({ entries });
		expect(lastFrame()).toMatch(/\bnew\b/i);
	});

	it("shows 'digested' for entries with an up-to-date digest", () => {
		const e = makeEntry("a", { digest: makeDigest("a") });
		const { lastFrame } = renderDashboard({ entries: [e] });
		expect(lastFrame()).toMatch(/\bdigested\b/i);
	});

	it("shows 'stale' when the source session has changed since digesting", () => {
		const e = makeEntry("a", {
			digest: makeDigest("a", { digestedAt: "2026-04-01T00:00:00.000Z" }),
			modifiedSinceAnalysis: true,
		});
		const { lastFrame } = renderDashboard({ entries: [e] });
		expect(lastFrame()).toMatch(/\bstale\b/i);
	});

	it("prefers the digest summary over the first prompt for digested rows", () => {
		// Source session's firstPrompt = title (used as exploration.name); the
		// digest carries a much better one-line summary. Once a row has a
		// digest, the dashboard should surface that summary in the topic
		// column, not the raw first prompt.
		const e = makeEntry("a", {
			title: "where are the sessions for this project stored?",
			digest: makeDigest("a", {
				overallSummary: "Located pi sessions under <project>/.pi/sessions",
				analysis: {
					summary: "Located pi sessions under <project>/.pi/sessions",
					keyLearnings: "",
					topics: [],
					tags: [],
					solutionType: "other",
					successIndicators: "yes",
					codeLanguages: [],
					toolsUsed: [],
					relatedFiles: [],
				},
			}),
		});
		const { lastFrame } = renderDashboard({ entries: [e] });
		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/Located pi sessions under/);
		expect(frame).not.toMatch(/where are the sessions for this project/);
	});

	it("falls back to the first prompt when no digest summary exists", () => {
		const e = makeEntry("a", {
			title: "Fix migration timeout",
		});
		const { lastFrame } = renderDashboard({ entries: [e] });
		expect(lastFrame()).toMatch(/Fix migration timeout/);
	});

	it("prefers overallSummary over the analyzer's punt summary", () => {
		// Real failure mode from pi sessions: the analyzer fills
		// analysis.summary with "Session with no analyzable conversation
		// content." while overallSummary (compaction output) carries the
		// real recap. The row title must surface the useful one.
		const e = makeEntry("a", {
			title: "raw first prompt",
			digest: makeDigest("a", {
				overallSummary:
					"The user established an automated workflow for transitioning issues from ready to active.",
				analysis: {
					summary: "Session with no analyzable conversation content.",
					keyLearnings: "No user/assistant text to analyze.",
					topics: [],
					tags: [],
					solutionType: "other",
					successIndicators: "unclear",
					codeLanguages: [],
					toolsUsed: [],
					relatedFiles: [],
				},
			}),
		});
		const { lastFrame } = renderDashboard({ entries: [e] });
		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/established an automated workflow/);
		expect(frame).not.toMatch(/no analyzable conversation/i);
		expect(frame).not.toMatch(/raw first prompt/);
	});

	it("pending progress events show rows as 'queued', not 'digesting'", async () => {
		// Regression: the engine emits `pending` for every input up front before
		// it starts sequential work. Rendering those as `digesting` lies to the
		// user about what's actually running — with concurrency=1 only one row
		// should ever be `digesting` at a time.
		const entries = [
			makeEntry("a", { title: "Alpha" }),
			makeEntry("b", { title: "Bravo" }),
			makeEntry("c", { title: "Charlie" }),
		];
		let emit: (e: DashboardProgressEvent) => void = () => {};
		const subscribe = (cb: (e: DashboardProgressEvent) => void) => {
			emit = cb;
			return () => {};
		};
		const { lastFrame } = renderDashboard({
			entries,
			subscribeToExtractionEvents: subscribe,
		});

		// Engine pre-emits pending for everything.
		for (const e of entries) {
			emit({
				explorationId: e.exploration.id,
				sessionId: e.sourceSession.id,
				phase: "pending",
			});
		}
		// Engine then starts the first row.
		emit({
			explorationId: entries[0].exploration.id,
			sessionId: entries[0].sourceSession.id,
			phase: "digesting",
			detail: "loading",
		});

		await new Promise((r) => setTimeout(r, 250));
		const frame = lastFrame() ?? "";

		// In rows the status is lowercased; in the bottom status bar it's
		// capitalized ("Digesting <topic>"). We want to assert that exactly one
		// row reads "digesting" and the others read "queued".
		const lowercaseDigesting = frame.match(/\bdigesting\b/g) ?? [];
		expect(lowercaseDigesting.length).toBe(1);
		const queuedMatches = frame.match(/\bqueued\b/g) ?? [];
		expect(queuedMatches.length).toBeGreaterThanOrEqual(2);
	});
});

// ── 3. Live status updates on progress events ────────────────────────────

describe("DashboardApp — live status updates", () => {
	it("flips a row to 'digesting' when a progress event fires for that exploration", async () => {
		const entries = [
			makeEntry("a", { title: "Alpha" }),
			makeEntry("b", { title: "Bravo" }),
		];

		let emit: (e: DashboardProgressEvent) => void = () => {};
		const subscribe = (cb: (e: DashboardProgressEvent) => void) => {
			emit = cb;
			return () => {};
		};

		const { lastFrame, rerender } = renderDashboard({
			entries,
			subscribeToExtractionEvents: subscribe,
		});

		// Both start as "new"
		expect(lastFrame()).toMatch(/\bnew\b/i);

		// Fire a digesting event for the first entry's session.
		emit({
			explorationId: entries[0].exploration.id,
			sessionId: entries[0].sourceSession.id,
			phase: "digesting",
			detail: "extracting alpha",
		});

		// Allow the dashboard's throttle/flush to drain.
		await new Promise((r) => setTimeout(r, 250));
		rerender(
			<DashboardApp
				projectPath="/proj"
				targetPath="/proj"
				entries={entries}
				runCount={0}
				modelLabel="google:gemini-3-flash-preview"
				concurrency={1}
				initialFilter={DEFAULT_FILTER}
				startupConfirm={false}
				onExit={() => {}}
				subscribeToExtractionEvents={subscribe}
			/>,
		);

		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/\bdigesting\b/i);
	});

	it("renders the current item in the bottom status bar from digesting events", async () => {
		const entries = [makeEntry("a", { title: "Investigate flaky tests" })];

		let emit: (e: DashboardProgressEvent) => void = () => {};
		const subscribe = (cb: (e: DashboardProgressEvent) => void) => {
			emit = cb;
			return () => {};
		};

		const { lastFrame } = renderDashboard({
			entries,
			subscribeToExtractionEvents: subscribe,
		});

		emit({
			explorationId: entries[0].exploration.id,
			sessionId: entries[0].sourceSession.id,
			phase: "digesting",
			detail: "Investigate flaky tests",
		});

		await new Promise((r) => setTimeout(r, 250));
		const frame = lastFrame() ?? "";
		// Bottom status bar shows what's currently being processed.
		expect(frame).toMatch(/(Digesting|Extracting).+Investigate flaky tests/i);
	});

	it("transitions a row from digesting → digested on a digested event", async () => {
		const entries = [makeEntry("a", { title: "Alpha" })];
		let emit: (e: DashboardProgressEvent) => void = () => {};
		const subscribe = (cb: (e: DashboardProgressEvent) => void) => {
			emit = cb;
			return () => {};
		};

		const { lastFrame } = renderDashboard({
			entries,
			subscribeToExtractionEvents: subscribe,
		});

		emit({
			explorationId: entries[0].exploration.id,
			sessionId: entries[0].sourceSession.id,
			phase: "digesting",
		});
		await new Promise((r) => setTimeout(r, 200));
		expect(lastFrame()).toMatch(/\bdigesting\b/i);

		emit({
			explorationId: entries[0].exploration.id,
			sessionId: entries[0].sourceSession.id,
			phase: "digested",
		});
		await new Promise((r) => setTimeout(r, 200));
		expect(lastFrame()).toMatch(/\bdigested\b/i);
	});

	it("transitions a row to failed on a failed event", async () => {
		const entries = [makeEntry("a", { title: "Alpha" })];
		let emit: (e: DashboardProgressEvent) => void = () => {};
		const subscribe = (cb: (e: DashboardProgressEvent) => void) => {
			emit = cb;
			return () => {};
		};

		const { lastFrame } = renderDashboard({
			entries,
			subscribeToExtractionEvents: subscribe,
		});

		emit({
			explorationId: entries[0].exploration.id,
			sessionId: entries[0].sourceSession.id,
			phase: "failed",
			detail: "model returned no JSON",
		});
		await new Promise((r) => setTimeout(r, 200));
		expect(lastFrame()).toMatch(/\bfailed\b/i);
	});
});

// ── 4. Confirmation overlay ──────────────────────────────────────────────

describe("DashboardApp — confirmation overlay", () => {
	it("shows an overlay at startup when there are undigested entries", () => {
		const entries = [
			makeEntry("a", { title: "Undigested A" }),
			makeEntry("b", { title: "Undigested B" }),
		];
		const { lastFrame } = renderDashboard({
			entries,
			startupConfirm: true,
		});
		const frame = lastFrame() ?? "";
		// Overlay calls out the count and the model.
		expect(frame).toMatch(/extract|digest/i);
		expect(frame).toMatch(/2/);
		expect(frame).toMatch(/gemini-3-flash-preview/);
	});

	it("the overlay surfaces a cost warning so the user is not surprised", () => {
		const entries = [makeEntry("a", { title: "Undigested" })];
		const { lastFrame } = renderDashboard({
			entries,
			startupConfirm: true,
		});
		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/llm|cost|api/i);
	});

	it("does NOT show the overlay at startup when every entry is already digested and fresh", () => {
		const entries = [
			makeEntry("a", {
				digest: makeDigest("a", {
					overallSummary: "Summary for A",
					analysis: {
						summary: "Summary for A",
						keyLearnings: "",
						topics: [],
						tags: [],
						solutionType: "other",
						successIndicators: "yes",
						codeLanguages: [],
						toolsUsed: [],
						relatedFiles: [],
					},
				}),
				title: "Done A",
			}),
			makeEntry("b", {
				digest: makeDigest("b", {
					overallSummary: "Summary for B",
					analysis: {
						summary: "Summary for B",
						keyLearnings: "",
						topics: [],
						tags: [],
						solutionType: "other",
						successIndicators: "yes",
						codeLanguages: [],
						toolsUsed: [],
						relatedFiles: [],
					},
				}),
				title: "Done B",
			}),
		];
		const { lastFrame } = renderDashboard({
			entries,
			startupConfirm: true,
		});
		const frame = lastFrame() ?? "";
		// We see the rows (digest summaries take priority over the raw title),
		// not the overlay.
		expect(frame).toMatch(/Summary for A/);
		expect(frame).toMatch(/Summary for B/);
		// The overlay text "Launch extraction" should not appear when nothing
		// needs extracting.
		expect(frame).not.toMatch(/Launch extraction/i);
	});
});

// ── 5. Keyboard navigation ───────────────────────────────────────────────

describe("DashboardApp — keyboard navigation", () => {
	it("quits and calls onExit when q is pressed", async () => {
		const onExit = vi.fn();
		const entries = [makeEntry("a")];
		const { stdin } = renderDashboard({ entries, onExit });
		stdin.write("q");
		await new Promise((r) => setTimeout(r, 50));
		expect(onExit).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "none" }),
		);
	});

	it("calls onExit with detail intent on Enter", async () => {
		const onExit = vi.fn();
		const entries = [makeEntry("a", { title: "Alpha" })];
		const { stdin } = renderDashboard({ entries, onExit });
		stdin.write("\r");
		await new Promise((r) => setTimeout(r, 50));
		expect(onExit).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "detail" }),
		);
	});

	it("calls onExit with transcript intent on v", async () => {
		const onExit = vi.fn();
		const entries = [makeEntry("a", { title: "Alpha" })];
		const { stdin } = renderDashboard({ entries, onExit });
		stdin.write("v");
		await new Promise((r) => setTimeout(r, 50));
		expect(onExit).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "transcript" }),
		);
	});

	it("calls onExit with beats intent on b", async () => {
		const onExit = vi.fn();
		const entries = [makeEntry("a", { title: "Alpha" })];
		const { stdin } = renderDashboard({ entries, onExit });
		stdin.write("b");
		await new Promise((r) => setTimeout(r, 50));
		expect(onExit).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "beats" }),
		);
	});

	it("calls onExit with digest intent on D", async () => {
		const onExit = vi.fn();
		const entries = [makeEntry("a", { title: "Alpha" })];
		const { stdin } = renderDashboard({ entries, onExit });
		// "D" must be uppercase per the spec.
		stdin.write("D");
		await new Promise((r) => setTimeout(r, 50));
		expect(onExit).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "digest" }),
		);
	});

	it("calls onExit with reflect intent on R", async () => {
		const onExit = vi.fn();
		const entries = [makeEntry("a", { title: "Alpha" })];
		const { stdin } = renderDashboard({ entries, onExit });
		stdin.write("R");
		await new Promise((r) => setTimeout(r, 50));
		expect(onExit).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "reflect" }),
		);
	});

	it("calls onExit with promote intent on P", async () => {
		const onExit = vi.fn();
		const entries = [makeEntry("a", { title: "Alpha" })];
		const { stdin } = renderDashboard({ entries, onExit });
		stdin.write("P");
		await new Promise((r) => setTimeout(r, 50));
		expect(onExit).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "promote" }),
		);
	});

	it("opens search mode and filters the table when text is typed", async () => {
		const entries = [
			makeEntry("a", { title: "Investigate flaky tests" }),
			makeEntry("b", { title: "Refactor auth module" }),
		];
		const { stdin, lastFrame } = renderDashboard({ entries });
		// Both rows show before search
		expect(lastFrame()).toMatch(/Investigate flaky tests/);
		expect(lastFrame()).toMatch(/Refactor auth module/);

		stdin.write("/");
		await new Promise((r) => setTimeout(r, 30));
		stdin.write("flaky");
		await new Promise((r) => setTimeout(r, 50));

		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/Investigate flaky tests/);
		expect(frame).not.toMatch(/Refactor auth module/);
	});
});

// ── 6. Confirmation overlay interactions ─────────────────────────────────

describe("DashboardApp — confirmation overlay interactions", () => {
	it("calls onLaunchExtraction when the user confirms 'y' on the startup overlay", async () => {
		const onLaunchExtraction = vi.fn();
		const entries = [makeEntry("a", { title: "Undigested" })];
		const { stdin } = renderDashboard({
			entries,
			startupConfirm: true,
			onLaunchExtraction,
		});
		stdin.write("y");
		await new Promise((r) => setTimeout(r, 50));
		expect(onLaunchExtraction).toHaveBeenCalled();
	});

	it("dismisses the overlay without launching when user presses n", async () => {
		const onLaunchExtraction = vi.fn();
		const entries = [makeEntry("a", { title: "Undigested" })];
		const { stdin, lastFrame } = renderDashboard({
			entries,
			startupConfirm: true,
			onLaunchExtraction,
		});

		stdin.write("n");
		await new Promise((r) => setTimeout(r, 50));
		expect(onLaunchExtraction).not.toHaveBeenCalled();
		// After dismissal, the table is visible.
		expect(lastFrame()).toMatch(/Undigested/);
	});

	it("suspends dashboard keys while the overlay is open", async () => {
		const onExit = vi.fn();
		const onLaunchExtraction = vi.fn();
		const entries = [makeEntry("a", { title: "Undigested" })];
		const { stdin } = renderDashboard({
			entries,
			startupConfirm: true,
			onExit,
			onLaunchExtraction,
		});

		// q should NOT exit while the overlay is open — overlay owns input.
		stdin.write("q");
		await new Promise((r) => setTimeout(r, 50));
		expect(onExit).not.toHaveBeenCalled();
	});
});
