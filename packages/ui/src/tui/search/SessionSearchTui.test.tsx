/**
 * Tests for the Session Search TUI (slice 4, #86 + slice 5, #87).
 *
 * Uses ink-testing-library to render the component and assert on the rendered
 * frame string. The component takes:
 *   - `initialQuery`: optional starting query; can be empty
 *   - `runScan(q)`: async function — called on initial mount (if non-empty)
 *     and on every debounced query change
 *   - `onExit`: invoked on Esc / Ctrl+C
 *   - `debounceMs`: debounce window (overridable so tests don't wait 200 ms)
 *
 * Tests use a short `debounceMs` (10) to keep wall-clock cheap. The
 * `flush()` helper waits long enough for the debounce + the async scan
 * promise + Ink's render scheduler to settle.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import type { SessionHit } from "@umwelten/core/interaction/search/index.js";
import { SessionSearchTui } from "./SessionSearchTui.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeHit(overrides: Partial<SessionHit> = {}): SessionHit {
	return {
		projectPath: "/Users/me/projects/alpha",
		projectName: "alpha",
		sessionId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
		filePath:
			"/Users/me/.claude/projects/-Users-me-projects-alpha/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.jsonl",
		messageTimestamp: "2026-05-22T11:00:00.000Z",
		role: "user",
		snippet: "…score the industry on its safety record…",
		fullMessageContent:
			"Can you score the industry on its safety record? I'd like a per-pillar breakdown.",
		...overrides,
	};
}

const TWO_HITS: SessionHit[] = [
	makeHit({
		projectName: "alpha",
		sessionId: "aaa",
		role: "user",
		snippet: "…score industry alpha…",
		fullMessageContent: "Full body for ALPHA hit — score industry alpha discussion.",
		messageTimestamp: "2026-05-22T11:00:00.000Z",
	}),
	makeHit({
		projectName: "beta",
		sessionId: "bbb",
		role: "assistant",
		snippet: "…score industry beta…",
		fullMessageContent: "Full body for BETA hit — score industry beta long context with more text.",
		messageTimestamp: "2026-05-21T10:00:00.000Z",
	}),
];

const ONE_HIT: SessionHit[] = [
	makeHit({
		projectName: "gamma",
		sessionId: "ggg",
		role: "user",
		snippet: "…queue management…",
		fullMessageContent: "Body for GAMMA hit — queue management notes.",
	}),
];

// Helper: wait for the debounce timer + the runScan promise + Ink's
// scheduler. `setTimeout(50)` is enough when `debounceMs` is 10.
async function flush(ms: number = 60): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

// Default debounce for tests — keep wall clock tight.
const TEST_DEBOUNCE_MS = 10;

// Terminal control sequences — written into the stdin stream that
// ink-testing-library feeds to useInput. ESC is 0x1b, backspace is 0x7f,
// Ctrl+C is 0x03.
const ESC = "\x1b";
const ARROW_UP = ESC + "[A";
const ARROW_DOWN = ESC + "[B";
const BACKSPACE = "\x7f";
const CTRL_C = "\x03";

// ── 1. Pre-scan / scanning state (slice 4) ─────────────────────────────────

describe("SessionSearchTui — scanning state", () => {
	it("renders the query in the header before/while scanning", () => {
		const { lastFrame } = render(
			<SessionSearchTui
				initialQuery="score industry"
				runScan={() => new Promise(() => {})}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/score industry/);
	});

	it('shows a "scanning…" indicator while the scan promise is pending', async () => {
		const { lastFrame } = render(
			<SessionSearchTui
				initialQuery="x"
				runScan={() => new Promise(() => {})}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		expect(lastFrame() ?? "").toMatch(/scanning/i);
	});
});

// ── 2. Results rendering (slice 4) ─────────────────────────────────────────

describe("SessionSearchTui — results rendering", () => {
	it("renders one row per hit with project name, role, and snippet", async () => {
		const { lastFrame } = render(
			<SessionSearchTui
				initialQuery="score industry"
				runScan={async () => TWO_HITS}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/alpha/);
		expect(frame).toMatch(/beta/);
		expect(frame).toMatch(/user|usr/i);
		expect(frame).toMatch(/assistant|asst/i);
		expect(frame).toMatch(/score industry alpha/);
		expect(frame).toMatch(/score industry beta/);
	});

	it("renders the full message body of the highlighted hit in the detail pane", async () => {
		const { lastFrame } = render(
			<SessionSearchTui
				initialQuery="score industry"
				runScan={async () => TWO_HITS}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/Full body for ALPHA hit/);
	});

	it("hides the scanning indicator once results arrive", async () => {
		const { lastFrame } = render(
			<SessionSearchTui
				initialQuery="x"
				runScan={async () => TWO_HITS}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		expect(lastFrame() ?? "").not.toMatch(/scanning/i);
	});
});

// ── 3. Empty results (slice 4) ─────────────────────────────────────────────

describe("SessionSearchTui — empty results", () => {
	it("renders a friendly empty-state when the scan returns no hits", async () => {
		const { lastFrame } = render(
			<SessionSearchTui
				initialQuery="zzz-no-hits"
				runScan={async () => []}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/no hits/i);
		expect(frame).toMatch(/zzz-no-hits/);
		expect(frame).not.toMatch(/scanning/i);
	});
});

// ── 4. Keyboard navigation (slice 4) ───────────────────────────────────────

describe("SessionSearchTui — keyboard navigation", () => {
	it("moves the highlight down on ↓ and updates the detail pane", async () => {
		const { lastFrame, stdin } = render(
			<SessionSearchTui
				initialQuery="x"
				runScan={async () => TWO_HITS}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		expect(lastFrame() ?? "").toMatch(/Full body for ALPHA hit/);
		stdin.write(ARROW_DOWN);
		await flush();
		expect(lastFrame() ?? "").toMatch(/Full body for BETA hit/);
	});

	it("moves the highlight back up on ↑", async () => {
		const { lastFrame, stdin } = render(
			<SessionSearchTui
				initialQuery="x"
				runScan={async () => TWO_HITS}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		stdin.write(ARROW_DOWN);
		await flush();
		expect(lastFrame() ?? "").toMatch(/Full body for BETA hit/);
		stdin.write(ARROW_UP);
		await flush();
		expect(lastFrame() ?? "").toMatch(/Full body for ALPHA hit/);
	});

	it("clamps the cursor at the top and bottom of the list", async () => {
		const { lastFrame, stdin } = render(
			<SessionSearchTui
				initialQuery="x"
				runScan={async () => TWO_HITS}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		stdin.write(ARROW_UP);
		stdin.write(ARROW_UP);
		await flush();
		expect(lastFrame() ?? "").toMatch(/Full body for ALPHA hit/);
		stdin.write(ARROW_DOWN);
		stdin.write(ARROW_DOWN);
		stdin.write(ARROW_DOWN);
		await flush();
		expect(lastFrame() ?? "").toMatch(/Full body for BETA hit/);
	});
});

// ── 5. Exit (slice 5: Esc / Ctrl+C, not q) ─────────────────────────────────

describe("SessionSearchTui — exit", () => {
	it("calls onExit when Esc is pressed", async () => {
		let exited = false;
		const { stdin, unmount } = render(
			<SessionSearchTui
				initialQuery="x"
				runScan={async () => TWO_HITS}
				onExit={() => {
					exited = true;
				}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		stdin.write(ESC); // Esc
		await flush();
		expect(exited).toBe(true);
		unmount();
	});

	it("calls onExit when Ctrl+C is pressed", async () => {
		let exited = false;
		const { stdin, unmount } = render(
			<SessionSearchTui
				initialQuery="x"
				runScan={async () => TWO_HITS}
				onExit={() => {
					exited = true;
				}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		stdin.write(CTRL_C); // Ctrl+C
		await flush();
		expect(exited).toBe(true);
		unmount();
	});

	it("does NOT exit on `q` (q is a search character now)", async () => {
		let exited = false;
		const { stdin, unmount } = render(
			<SessionSearchTui
				initialQuery=""
				runScan={async () => []}
				onExit={() => {
					exited = true;
				}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		stdin.write("q");
		await flush();
		expect(exited).toBe(false);
		unmount();
	});
});

// ── 5b. Detail pane shows path + file ─────────────────────────────────────

describe("SessionSearchTui — detail pane path/file", () => {
	it("shows the decoded project path and the session file path", async () => {
		const hits: SessionHit[] = [
			makeHit({
				projectPath: "/Users/me/projects/alpha",
				projectName: "alpha",
				filePath:
					"/Users/me/.claude/projects/-Users-me-projects-alpha/abc.jsonl",
				fullMessageContent: "Body content",
			}),
		];
		const { lastFrame } = render(
			<SessionSearchTui
				initialQuery="x"
				runScan={async () => hits}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/path:/);
		expect(frame).toMatch(/\/Users\/me\/projects\/alpha/);
		expect(frame).toMatch(/file:/);
		expect(frame).toMatch(/abc\.jsonl/);
	});
});

// ── 6. Header behaviour ────────────────────────────────────────────────────

describe("SessionSearchTui — header", () => {
	it("renders a hit count after the scan resolves", async () => {
		const { lastFrame } = render(
			<SessionSearchTui
				initialQuery="x"
				runScan={async () => TWO_HITS}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/2\s*(hits?|matches?|results?)|\(2\)/i);
	});

	it("shows a visible cursor character", () => {
		const { lastFrame } = render(
			<SessionSearchTui
				initialQuery=""
				runScan={async () => []}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		const frame = lastFrame() ?? "";
		// We render "_" as the cursor inside the quoted query.
		expect(frame).toContain("_");
	});
});

// ── 7. Editable query (slice 5) ────────────────────────────────────────────

describe("SessionSearchTui — editable query", () => {
	it("launches with an empty query and an empty hit list (no error, no scan)", async () => {
		let scanCalls = 0;
		const { lastFrame } = render(
			<SessionSearchTui
				initialQuery=""
				runScan={async () => {
					scanCalls++;
					return [];
				}}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		const frame = lastFrame() ?? "";
		expect(frame).not.toMatch(/scanning/i);
		expect(frame).toMatch(/type to search/i);
		expect(scanCalls).toBe(0);
	});

	it("keystrokes extend the visible query in the header", async () => {
		const { lastFrame, stdin } = render(
			<SessionSearchTui
				initialQuery=""
				runScan={async () => []}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		stdin.write("foo");
		await flush();
		expect(lastFrame() ?? "").toMatch(/"foo/);
	});

	it("backspace removes the last character of the query", async () => {
		const { lastFrame, stdin } = render(
			<SessionSearchTui
				initialQuery="bar"
				runScan={async () => []}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		stdin.write(BACKSPACE); // backspace
		await flush();
		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/"ba/);
		expect(frame).not.toMatch(/"bar_"/);
	});
});

// ── 8. Debounced re-scan (slice 5) ─────────────────────────────────────────

describe("SessionSearchTui — debounced re-scan", () => {
	// Helper: build a runScan that records calls and resolves a promise the
	// caller can `await` to know the scan actually happened. More reliable
	// than wall-clock waits on busy CI.
	function makeRecordingScan(
		impl: (q: string) => SessionHit[],
	): {
		runScan: (q: string) => Promise<SessionHit[]>;
		calls: string[];
		nextCall: () => Promise<string>;
	} {
		const calls: string[] = [];
		const waiters: Array<(q: string) => void> = [];
		return {
			calls,
			runScan: async (q: string) => {
				calls.push(q);
				const w = waiters.shift();
				if (w) w(q);
				return impl(q);
			},
			nextCall: () =>
				new Promise<string>((resolve) => {
					waiters.push(resolve);
				}),
		};
	}

	it("re-runs the scanner with the new query after the debounce window", async () => {
		const { runScan, calls, nextCall } = makeRecordingScan((q) =>
			q === "foo" ? ONE_HIT : [],
		);
		const waiter = nextCall();
		const { stdin, lastFrame } = render(
			<SessionSearchTui
				initialQuery=""
				runScan={runScan}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		expect(calls).toEqual([]); // empty query: no scan
		stdin.write("foo");
		await waiter; // resolves the moment runScan is called
		await flush(); // let setState propagate
		expect(calls).toContain("foo");
		expect(lastFrame() ?? "").toMatch(/queue management/);
	});

	it("only fires once after rapid keystrokes within the debounce window", async () => {
		const { runScan, calls, nextCall } = makeRecordingScan(() => []);
		const waiter = nextCall();
		const { stdin } = render(
			<SessionSearchTui
				initialQuery=""
				runScan={runScan}
				onExit={() => {}}
				debounceMs={50}
			/>,
		);
		await flush();
		stdin.write("f");
		stdin.write("o");
		stdin.write("o");
		await waiter;
		// Give any pending timers a chance to fire.
		await flush(150);
		expect(calls).toEqual(["foo"]);
	});

	it("clears the hit list and stops scanning when the query becomes empty again", async () => {
		const { runScan, nextCall } = makeRecordingScan(() => ONE_HIT);
		const firstScan = nextCall();
		const { stdin, lastFrame } = render(
			<SessionSearchTui
				initialQuery=""
				runScan={runScan}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		stdin.write("foo");
		await firstScan;
		await flush();
		expect(lastFrame() ?? "").toMatch(/queue management/);

		stdin.write(BACKSPACE);
		stdin.write(BACKSPACE);
		stdin.write(BACKSPACE);
		// No await on the scanner here — query went back to "" so no scan
		// should fire. Wall-clock wait is fine since we're asserting absence.
		await flush(150);
		const frame = lastFrame() ?? "";
		expect(frame).not.toMatch(/queue management/);
		expect(frame).not.toMatch(/scanning/i);
		expect(frame).toMatch(/type to search/i);
	});

	it("resets the highlight to the first row on each new result set", async () => {
		let scanCallCount = 0;
		const { runScan, nextCall } = makeRecordingScan(() => {
			scanCallCount++;
			return scanCallCount === 1 ? TWO_HITS : ONE_HIT;
		});
		const firstScan = nextCall();
		const { stdin, lastFrame } = render(
			<SessionSearchTui
				initialQuery="foo"
				runScan={runScan}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await firstScan;
		await flush();
		stdin.write(ARROW_DOWN);
		await flush();
		expect(lastFrame() ?? "").toMatch(/Full body for BETA hit/);

		const secondScan = nextCall();
		stdin.write("x");
		await secondScan;
		await flush();
		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/queue management/);
		expect(frame).toMatch(/Body for GAMMA hit/);
	});
});

// ── 6b. Scrolling ─────────────────────────────────────────────────────────

describe("SessionSearchTui — scroll window", () => {
	// Build many hits with unique, identifiable snippets so we can check
	// which ones are actually in the rendered frame as the cursor moves.
	const MANY_HITS: SessionHit[] = Array.from({ length: 40 }, (_, i) => ({
		projectPath: "/Users/me/projects/proj",
		projectName: "proj",
		sessionId: `s-${i}`,
		filePath: `/Users/me/.claude/projects/-Users-me-projects-proj/s-${i}.jsonl`,
		messageTimestamp: new Date(2026, 0, 1, 12, i).toISOString(),
		role: "user" as const,
		snippet: `unique-snippet-${i}`,
		fullMessageContent: `unique-body-${i}`,
	}));

	it("scrolls the visible window down once the cursor passes the bottom edge", async () => {
		const { lastFrame, stdin } = render(
			<SessionSearchTui
				initialQuery="x"
				runScan={async () => MANY_HITS}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		// Initially the top of the list is visible — snippet-0 shows up.
		expect(lastFrame() ?? "").toMatch(/unique-snippet-0/);

		// Hold down ↓ past the bottom of the visible window. The default
		// terminal in ink-testing-library is ~30 rows, so the list pane is
		// ~13 rows; pressing ↓ 25× definitely scrolls.
		for (let i = 0; i < 25; i++) stdin.write(ARROW_DOWN);
		await flush();

		const frame = lastFrame() ?? "";
		// snippet-0 has scrolled off the top.
		expect(frame).not.toMatch(/unique-snippet-0\b/);
		// The detail pane shows the body of the currently-highlighted (later)
		// hit, proving the cursor moved and the list followed.
		expect(frame).toMatch(/unique-body-25/);
	});

	it("scrolls back to the top when the cursor returns there", async () => {
		const { lastFrame, stdin } = render(
			<SessionSearchTui
				initialQuery="x"
				runScan={async () => MANY_HITS}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		// Scroll down.
		for (let i = 0; i < 25; i++) stdin.write(ARROW_DOWN);
		await flush();
		// Then back to the top.
		for (let i = 0; i < 25; i++) stdin.write(ARROW_UP);
		await flush();

		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/unique-snippet-0/);
		expect(frame).toMatch(/unique-body-0/);
	});
});

// ── 7. Open hit (slice 6, #88) ─────────────────────────────────────────────

describe("SessionSearchTui — open hit on Enter", () => {
	it("calls onSelectHit with the highlighted hit when Enter is pressed", async () => {
		const onSelectHit = vi.fn();
		const { stdin } = render(
			<SessionSearchTui
				initialQuery="x"
				runScan={async () => TWO_HITS}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
				onSelectHit={onSelectHit}
			/>,
		);
		await flush();
		stdin.write("\r"); // Enter
		await flush();
		expect(onSelectHit).toHaveBeenCalledTimes(1);
		expect(onSelectHit).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId: "aaa", projectName: "alpha" }),
			// Slice 7 (#89): a state snapshot rides along for restore-on-return.
			expect.anything(),
		);
	});

	it("calls onSelectHit with the second hit after navigating down", async () => {
		const onSelectHit = vi.fn();
		const { stdin } = render(
			<SessionSearchTui
				initialQuery="x"
				runScan={async () => TWO_HITS}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
				onSelectHit={onSelectHit}
			/>,
		);
		await flush();
		stdin.write(ARROW_DOWN);
		await flush();
		stdin.write("\r"); // Enter
		await flush();
		expect(onSelectHit).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId: "bbb", projectName: "beta" }),
			// Slice 7 (#89): a state snapshot rides along for restore-on-return.
			expect.anything(),
		);
	});

	it("does nothing on Enter when there are no hits", async () => {
		const onSelectHit = vi.fn();
		const { stdin } = render(
			<SessionSearchTui
				initialQuery="x"
				runScan={async () => []}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
				onSelectHit={onSelectHit}
			/>,
		);
		await flush();
		stdin.write("\r");
		await flush();
		expect(onSelectHit).not.toHaveBeenCalled();
	});

	it("does not call onExit when Enter is pressed (Enter is not a quit)", async () => {
		const onExit = vi.fn();
		const onSelectHit = vi.fn();
		const { stdin } = render(
			<SessionSearchTui
				initialQuery="x"
				runScan={async () => TWO_HITS}
				onExit={onExit}
				debounceMs={TEST_DEBOUNCE_MS}
				onSelectHit={onSelectHit}
			/>,
		);
		await flush();
		stdin.write("\r");
		await flush();
		// onSelectHit fires; the search TUI unmounts via Ink's exit() so the
		// caller's runner can drive the next step. The onExit callback is not
		// invoked because Enter is "open hit", not "quit search".
		expect(onSelectHit).toHaveBeenCalled();
		expect(onExit).not.toHaveBeenCalled();
	});
});

// ── 8. Return-to-search state restore (slice 7, #89) ───────────────────────

describe("SessionSearchTui — restore state (slice 7, #89)", () => {
	it("renders initialHits immediately without re-running the scan", async () => {
		let scanCalls = 0;
		const { lastFrame } = render(
			<SessionSearchTui
				initialQuery="score industry"
				initialHits={TWO_HITS}
				runScan={async () => {
					scanCalls++;
					return [];
				}}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush(150);
		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/score industry alpha/);
		expect(frame).not.toMatch(/scanning/i);
		expect(scanCalls).toBe(0);
	});

	it("highlights the row given by initialCursor", async () => {
		const { lastFrame } = render(
			<SessionSearchTui
				initialQuery="x"
				initialHits={TWO_HITS}
				initialCursor={1}
				runScan={async () => TWO_HITS}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		expect(lastFrame() ?? "").toMatch(/Full body for BETA hit/);
	});

	it("editing the query after a restore still triggers a fresh scan", async () => {
		// Await the actual scan call rather than fixed wall-clock waits —
		// Ink's async input processing makes fixed waits flaky under load
		// (same pattern as the debounced re-scan tests above).
		const calls: string[] = [];
		let resolveScanCalled: () => void = () => {};
		const scanCalled = new Promise<void>((r) => {
			resolveScanCalled = r;
		});
		const { stdin, lastFrame } = render(
			<SessionSearchTui
				initialQuery="x"
				initialHits={TWO_HITS}
				runScan={async (q) => {
					calls.push(q);
					resolveScanCalled();
					return ONE_HIT;
				}}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
			/>,
		);
		await flush();
		expect(calls).toEqual([]); // the restore itself did not re-scan
		stdin.write("y");
		await scanCalled; // resolves the moment the re-scan fires
		await flush();
		expect(calls).toEqual(["xy"]);
		expect(lastFrame() ?? "").toMatch(/queue management/);
	});

	it("passes a snapshot (query, hits, cursorIndex) to onSelectHit", async () => {
		const onSelectHit = vi.fn();
		const { stdin, lastFrame } = render(
			<SessionSearchTui
				initialQuery="x"
				runScan={async () => TWO_HITS}
				onExit={() => {}}
				debounceMs={TEST_DEBOUNCE_MS}
				onSelectHit={onSelectHit}
			/>,
		);
		// Poll for each state transition instead of fixed waits — input
		// processing latency varies under parallel test load.
		await waitFor(() => (lastFrame() ?? "").includes("Full body for ALPHA hit"));
		stdin.write(ARROW_DOWN);
		await waitFor(() => (lastFrame() ?? "").includes("Full body for BETA hit"));
		stdin.write("\r");
		await waitFor(() => onSelectHit.mock.calls.length > 0);
		expect(onSelectHit).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId: "bbb" }),
			expect.objectContaining({ query: "x", cursorIndex: 1, hits: TWO_HITS }),
		);
	});
});

// Poll until `cond` is truthy (20 ms interval, 5 s timeout). Throws on
// timeout so failures point at the stalled transition instead of a
// downstream assertion.
async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
	const start = Date.now();
	while (!cond()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error("waitFor: condition not met within timeout");
		}
		await new Promise((r) => setTimeout(r, 20));
	}
}
