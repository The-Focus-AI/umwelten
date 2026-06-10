/**
 * Tests for the search ↔ dashboard round-trip loop (slice 7, #89).
 *
 * `runSearchDashboardLoop` is the pure orchestrator behind
 * `runSessionSearchTui`: mount search → user selects a hit → launch the
 * dashboard → if the dashboard returns with "return" (q pressed while
 * `returnToCaller` is set), re-mount search with the prior state preserved;
 * any other outcome ends the loop. Deps are injected so the loop is testable
 * without Ink.
 */
import { describe, it, expect, vi } from "vitest";
import type { SessionHit } from "@umwelten/core/interaction/search/index.js";
import {
	runSearchDashboardLoop,
	type SearchMountState,
	type SearchSelection,
} from "./run.js";

function makeHit(overrides: Partial<SessionHit> = {}): SessionHit {
	return {
		projectPath: "/Users/me/projects/alpha",
		projectName: "alpha",
		sessionId: "aaa",
		filePath: "/Users/me/.claude/projects/-Users-me-projects-alpha/aaa.jsonl",
		messageTimestamp: "2026-05-22T11:00:00.000Z",
		role: "user",
		snippet: "…alpha…",
		fullMessageContent: "Alpha body",
		...overrides,
	};
}

const HIT_A = makeHit({ sessionId: "aaa" });
const HIT_B = makeHit({ sessionId: "bbb", projectName: "beta" });

function selection(
	hit: SessionHit,
	snapshot: Partial<SearchSelection["snapshot"]> = {},
): SearchSelection {
	return {
		hit,
		snapshot: {
			query: "alpha",
			hits: [HIT_A, HIT_B],
			cursor: 0,
			...snapshot,
		},
	};
}

describe("runSearchDashboardLoop", () => {
	it("exits without launching the dashboard when search resolves null (Esc)", async () => {
		const mountSearch = vi.fn(async () => null);
		const launchDashboard = vi.fn(async () => "exit" as const);

		await runSearchDashboardLoop("alpha", { mountSearch, launchDashboard });

		expect(mountSearch).toHaveBeenCalledTimes(1);
		expect(mountSearch).toHaveBeenCalledWith({ query: "alpha" });
		expect(launchDashboard).not.toHaveBeenCalled();
	});

	it("launches the dashboard for the selected hit and ends on 'exit'", async () => {
		const mountSearch = vi.fn(async () => selection(HIT_A));
		const launchDashboard = vi.fn(async () => "exit" as const);

		await runSearchDashboardLoop("alpha", { mountSearch, launchDashboard });

		expect(launchDashboard).toHaveBeenCalledTimes(1);
		expect(launchDashboard).toHaveBeenCalledWith(HIT_A);
		expect(mountSearch).toHaveBeenCalledTimes(1);
	});

	it("re-mounts search with the preserved snapshot when the dashboard returns", async () => {
		const states: SearchMountState[] = [];
		const mountSearch = vi.fn(async (state: SearchMountState) => {
			states.push(state);
			// First mount: select a hit; second mount: quit search.
			return states.length === 1
				? selection(HIT_B, { query: "alp", cursor: 1 })
				: null;
		});
		const launchDashboard = vi.fn(async () => "return" as const);

		await runSearchDashboardLoop("alp", { mountSearch, launchDashboard });

		expect(mountSearch).toHaveBeenCalledTimes(2);
		// First mount: fresh — just the initial query.
		expect(states[0]).toEqual({ query: "alp" });
		// Second mount: same query, same hit list, same highlighted row.
		expect(states[1]).toEqual({
			query: "alp",
			hits: [HIT_A, HIT_B],
			cursor: 1,
		});
	});

	it("supports repeated round trips: open → return → open → return → quit", async () => {
		let mounts = 0;
		const mountSearch = vi.fn(async () => {
			mounts++;
			if (mounts === 1) return selection(HIT_A, { cursor: 0 });
			if (mounts === 2) return selection(HIT_B, { cursor: 1 });
			return null; // third mount: user quits search
		});
		const launchDashboard = vi.fn(async () => "return" as const);

		await runSearchDashboardLoop("alpha", { mountSearch, launchDashboard });

		expect(launchDashboard).toHaveBeenCalledTimes(2);
		expect(launchDashboard).toHaveBeenNthCalledWith(1, HIT_A);
		expect(launchDashboard).toHaveBeenNthCalledWith(2, HIT_B);
		expect(mountSearch).toHaveBeenCalledTimes(3);
	});

	it("ends the loop when the dashboard outcome is 'exit' (Ctrl+C in dashboard)", async () => {
		const mountSearch = vi.fn(async () => selection(HIT_A));
		const launchDashboard = vi.fn(async () => "exit" as const);

		await runSearchDashboardLoop("alpha", { mountSearch, launchDashboard });

		expect(mountSearch).toHaveBeenCalledTimes(1);
		expect(launchDashboard).toHaveBeenCalledTimes(1);
	});
});
