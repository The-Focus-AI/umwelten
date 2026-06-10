/**
 * Tests for the search ↔ dashboard round-trip loop (slice 7, #89).
 *
 * `runSearchDashboardLoop` is the orchestration seam inside run.tsx: it
 * mounts the search TUI, launches the dashboard for a selected hit, and —
 * when the dashboard resolves with "return" — re-mounts search with the
 * snapshot captured at selection time (same query, same hit list, same
 * highlight). The deps are injected so these tests never touch Ink.
 */
import { describe, it, expect, vi } from "vitest";
import type { SessionHit } from "@umwelten/core/interaction/search/index.js";
import {
	runSearchDashboardLoop,
	type SearchSelection,
} from "./run.js";
import type { SearchTuiSnapshot } from "./SessionSearchTui.js";

function makeHit(overrides: Partial<SessionHit> = {}): SessionHit {
	return {
		projectPath: "/Users/me/projects/alpha",
		projectName: "alpha",
		sessionId: "aaa",
		filePath:
			"/Users/me/.claude/projects/-Users-me-projects-alpha/aaa.jsonl",
		messageTimestamp: "2026-05-22T11:00:00.000Z",
		role: "user",
		snippet: "…score industry alpha…",
		fullMessageContent: "Full body for ALPHA hit.",
		...overrides,
	};
}

function makeSelection(
	hit: SessionHit,
	snapshot: Partial<SearchTuiSnapshot> = {},
): SearchSelection {
	return {
		hit,
		snapshot: {
			query: "score industry",
			hits: [hit],
			cursorIndex: 0,
			...snapshot,
		},
	};
}

describe("runSearchDashboardLoop (slice 7, #89)", () => {
	it("exits cleanly when the user quits the search TUI without selecting", async () => {
		const mountSearch = vi.fn().mockResolvedValue(null);
		const launchDashboard = vi.fn();
		await runSearchDashboardLoop("foo", { mountSearch, launchDashboard });
		expect(mountSearch).toHaveBeenCalledTimes(1);
		expect(mountSearch).toHaveBeenCalledWith({
			query: "foo",
			restore: undefined,
		});
		expect(launchDashboard).not.toHaveBeenCalled();
	});

	it("re-mounts search with the preserved snapshot when the dashboard returns", async () => {
		const hit = makeHit();
		const selection = makeSelection(hit, {
			query: "score industry",
			cursorIndex: 2,
		});
		const mountSearch = vi
			.fn()
			.mockResolvedValueOnce(selection)
			.mockResolvedValueOnce(null);
		const launchDashboard = vi.fn().mockResolvedValue("return");

		await runSearchDashboardLoop("score industry", {
			mountSearch,
			launchDashboard,
		});

		expect(launchDashboard).toHaveBeenCalledTimes(1);
		expect(launchDashboard).toHaveBeenCalledWith(hit);
		expect(mountSearch).toHaveBeenCalledTimes(2);
		// Second mount restores the state captured at selection time.
		expect(mountSearch).toHaveBeenNthCalledWith(2, {
			query: "score industry",
			restore: selection.snapshot,
		});
	});

	it("ends the loop without re-mounting search when the dashboard hard-exits", async () => {
		const mountSearch = vi
			.fn()
			.mockResolvedValue(makeSelection(makeHit()));
		const launchDashboard = vi.fn().mockResolvedValue("exit");

		await runSearchDashboardLoop("foo", { mountSearch, launchDashboard });

		expect(mountSearch).toHaveBeenCalledTimes(1);
		expect(launchDashboard).toHaveBeenCalledTimes(1);
	});

	it("supports repeated open → return → open round trips", async () => {
		const hitA = makeHit({ sessionId: "aaa" });
		const hitB = makeHit({ sessionId: "bbb", projectName: "beta" });
		const selA = makeSelection(hitA, { query: "q1", cursorIndex: 0 });
		const selB = makeSelection(hitB, { query: "q2", cursorIndex: 1 });
		const mountSearch = vi
			.fn()
			.mockResolvedValueOnce(selA)
			.mockResolvedValueOnce(selB)
			.mockResolvedValueOnce(null);
		const launchDashboard = vi.fn().mockResolvedValue("return");

		await runSearchDashboardLoop("q1", { mountSearch, launchDashboard });

		expect(launchDashboard).toHaveBeenCalledTimes(2);
		expect(launchDashboard).toHaveBeenNthCalledWith(1, hitA);
		expect(launchDashboard).toHaveBeenNthCalledWith(2, hitB);
		expect(mountSearch).toHaveBeenCalledTimes(3);
		// Each re-mount restores the most recent selection's snapshot.
		expect(mountSearch).toHaveBeenNthCalledWith(2, {
			query: "q1",
			restore: selA.snapshot,
		});
		expect(mountSearch).toHaveBeenNthCalledWith(3, {
			query: "q2",
			restore: selB.snapshot,
		});
	});
});
