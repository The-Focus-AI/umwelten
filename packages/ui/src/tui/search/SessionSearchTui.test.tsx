/**
 * Tests for the Session Search TUI (slice 4, issue #86).
 *
 * Uses ink-testing-library to render the component and assert on the rendered
 * frame string. The component is a passive view — it takes a `runScan` async
 * function (so tests control the scan promise) and a list of `SessionHit`s on
 * resolution. The component manages: scanning indicator, header, hit list,
 * detail pane, keyboard navigation, and exit.
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
		filePath: "/Users/me/.claude/projects/-Users-me-projects-alpha/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.jsonl",
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

// Helper: wait for the runScan promise to settle and Ink to re-render.
// Microtask flushing alone isn't enough — Ink's renderer schedules work on
// macrotasks, so we yield to the event loop for a short tick.
async function flush(ms: number = 50): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

// ── 1. Pre-scan / scanning state ───────────────────────────────────────────

describe("SessionSearchTui — scanning state", () => {
	it("renders the query in the header before/while scanning", () => {
		const { lastFrame } = render(
			<SessionSearchTui
				query="score industry"
				runScan={() => new Promise(() => {})}
				onExit={() => {}}
			/>,
		);
		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/score industry/);
	});

	it('shows a "scanning…" indicator while the scan promise is pending', () => {
		const { lastFrame } = render(
			<SessionSearchTui
				query="x"
				runScan={() => new Promise(() => {})}
				onExit={() => {}}
			/>,
		);
		expect(lastFrame() ?? "").toMatch(/scanning/i);
	});
});

// ── 2. Results rendering ───────────────────────────────────────────────────

describe("SessionSearchTui — results rendering", () => {
	it("renders one row per hit with project name, role, and snippet", async () => {
		const { lastFrame } = render(
			<SessionSearchTui
				query="score industry"
				runScan={async () => TWO_HITS}
				onExit={() => {}}
			/>,
		);
		await flush();
		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/alpha/);
		expect(frame).toMatch(/beta/);
		// roles abbreviated to user / asst — accept either full or short form
		expect(frame).toMatch(/user|usr/i);
		expect(frame).toMatch(/assistant|asst/i);
		expect(frame).toMatch(/score industry alpha/);
		expect(frame).toMatch(/score industry beta/);
	});

	it("renders the full message body of the highlighted hit in the detail pane", async () => {
		const { lastFrame } = render(
			<SessionSearchTui
				query="score industry"
				runScan={async () => TWO_HITS}
				onExit={() => {}}
			/>,
		);
		await flush();
		const frame = lastFrame() ?? "";
		// By default the first hit is highlighted; its fullMessageContent should
		// appear somewhere in the rendered frame (the detail pane).
		expect(frame).toMatch(/Full body for ALPHA hit/);
	});

	it("hides the scanning indicator once results arrive", async () => {
		const { lastFrame } = render(
			<SessionSearchTui
				query="x"
				runScan={async () => TWO_HITS}
				onExit={() => {}}
			/>,
		);
		await flush();
		expect(lastFrame() ?? "").not.toMatch(/scanning/i);
	});
});

// ── 3. Empty results ───────────────────────────────────────────────────────

describe("SessionSearchTui — empty results", () => {
	it("renders a friendly empty-state when the scan returns no hits", async () => {
		const { lastFrame } = render(
			<SessionSearchTui
				query="zzz-no-hits"
				runScan={async () => []}
				onExit={() => {}}
			/>,
		);
		await flush();
		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/no hits/i);
		// Header still shows the query.
		expect(frame).toMatch(/zzz-no-hits/);
		// Scanning indicator is gone.
		expect(frame).not.toMatch(/scanning/i);
	});
});

// ── 4. Keyboard navigation ─────────────────────────────────────────────────

describe("SessionSearchTui — keyboard navigation", () => {
	it("moves the highlight down on ↓ and updates the detail pane", async () => {
		const { lastFrame, stdin } = render(
			<SessionSearchTui
				query="x"
				runScan={async () => TWO_HITS}
				onExit={() => {}}
			/>,
		);
		await flush();
		// Initial: first hit highlighted, alpha body shown.
		expect(lastFrame() ?? "").toMatch(/Full body for ALPHA hit/);

		// Press down arrow.
		stdin.write("[B");
		await flush();
		expect(lastFrame() ?? "").toMatch(/Full body for BETA hit/);
	});

	it("moves the highlight back up on ↑", async () => {
		const { lastFrame, stdin } = render(
			<SessionSearchTui
				query="x"
				runScan={async () => TWO_HITS}
				onExit={() => {}}
			/>,
		);
		await flush();
		stdin.write("[B"); // down
		await flush();
		expect(lastFrame() ?? "").toMatch(/Full body for BETA hit/);
		stdin.write("[A"); // up
		await flush();
		expect(lastFrame() ?? "").toMatch(/Full body for ALPHA hit/);
	});

	it("clamps the cursor at the top and bottom of the list", async () => {
		const { lastFrame, stdin } = render(
			<SessionSearchTui
				query="x"
				runScan={async () => TWO_HITS}
				onExit={() => {}}
			/>,
		);
		await flush();
		// Up from the top is a no-op.
		stdin.write("[A");
		stdin.write("[A");
		await flush();
		expect(lastFrame() ?? "").toMatch(/Full body for ALPHA hit/);
		// Past the bottom is also a no-op.
		stdin.write("[B");
		stdin.write("[B");
		stdin.write("[B");
		await flush();
		expect(lastFrame() ?? "").toMatch(/Full body for BETA hit/);
	});
});

// ── 5. Exit ────────────────────────────────────────────────────────────────

describe("SessionSearchTui — exit", () => {
	it("calls onExit and unmounts when q is pressed", async () => {
		let exited = false;
		const { stdin, unmount } = render(
			<SessionSearchTui
				query="x"
				runScan={async () => TWO_HITS}
				onExit={() => {
					exited = true;
				}}
			/>,
		);
		await flush();
		stdin.write("q");
		await flush();
		expect(exited).toBe(true);
		unmount();
	});

	it("calls onExit when ctrl+c is pressed", async () => {
		let exited = false;
		const { stdin, unmount } = render(
			<SessionSearchTui
				query="x"
				runScan={async () => TWO_HITS}
				onExit={() => {
					exited = true;
				}}
			/>,
		);
		await flush();
		stdin.write(""); // ctrl+c
		await flush();
		expect(exited).toBe(true);
		unmount();
	});
});

// ── 6. Header behaviour ────────────────────────────────────────────────────

describe("SessionSearchTui — header", () => {
	it("renders a hit count after the scan resolves", async () => {
		const { lastFrame } = render(
			<SessionSearchTui
				query="x"
				runScan={async () => TWO_HITS}
				onExit={() => {}}
			/>,
		);
		await flush();
		// "2 hit" / "2 hits" / "(2)" — accept any common form.
		const frame = lastFrame() ?? "";
		expect(frame).toMatch(/2\s*(hits?|matches?|results?)|\(2\)/i);
	});
});
