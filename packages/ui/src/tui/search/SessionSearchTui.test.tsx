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
import { describe, it, expect } from "vitest";
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
