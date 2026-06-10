/**
 * Runner that mounts the SessionSearchTui in a real terminal.
 *
 * `runSessionSearchTui(initialQuery, opts)` is the single entry point used by
 * `umwelten search [query]` (registered in @umwelten/sessions). It mounts
 * the Ink TUI with the given initial query (which may be empty), runs scans
 * on every debounced query change, and resolves when the user presses Esc.
 *
 * Slice 5 (#87): the runner no longer pre-scans before mounting; the TUI
 * owns the query and re-runs the scanner from inside on every debounced
 * change. An empty `initialQuery` produces an empty TUI waiting for input.
 *
 * Slice 6 (#88): pressing Enter on a hit unmounts the search TUI and launches
 * the Exploration Browser dashboard scoped to the hit's project, with the
 * hit's session pre-selected as the highlighted row.
 *
 * Slice 7 (#89): the search ↔ dashboard trip is a round trip. The dashboard
 * is launched with `returnToCaller`, so `q` resolves it with `"return"`
 * instead of exiting; the loop then re-mounts search with the snapshot
 * captured at selection time (same query, same hit list, same highlight) and
 * without re-running the scan. Ctrl+C in the dashboard — or quitting the
 * search TUI itself with Esc — still ends the whole run.
 */
import React from "react";
import { render } from "ink";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import {
	searchSessions,
	type SearchOptions,
	type SessionHit,
} from "@umwelten/core/interaction/search/index.js";
import {
	SessionSearchTui,
	type SearchTuiSnapshot,
} from "./SessionSearchTui.js";

export interface RunSessionSearchTuiOptions {
	/** Forwarded to `searchSessions` on every scan. */
	scan?: SearchOptions;
	/**
	 * Model used by the Exploration Browser dashboard when the user opens a
	 * hit and triggers actions like digest (D) or reflect (R). Defaults to
	 * `google:gemini-3-flash-preview`, matching `umwelten browse`'s default.
	 */
	model?: ModelDetails;
}

const DEFAULT_DASHBOARD_MODEL: ModelDetails = {
	provider: "google",
	name: "gemini-3-flash-preview",
};

// ── Round-trip loop (slice 7, #89) ──────────────────────────────────────────

/** A hit the user opened, plus the TUI state to restore on bounce-back. */
export interface SearchSelection {
	hit: SessionHit;
	snapshot: SearchTuiSnapshot;
}

/**
 * Injected seams for `runSearchDashboardLoop`. Production wires these to the
 * Ink mounts; tests drive the loop without a terminal.
 */
export interface SearchLoopDeps {
	/**
	 * Mount the search TUI. Resolves with the user's selection, or null when
	 * the user quit search (Esc / Ctrl+C) — null ends the loop.
	 */
	mountSearch: (mount: {
		query: string;
		restore?: SearchTuiSnapshot;
	}) => Promise<SearchSelection | null>;
	/**
	 * Launch the Exploration Browser dashboard for a hit. Resolves "return"
	 * when the user pressed `q` (bounce back to search) or "exit" when the
	 * dashboard ended for good (Ctrl+C).
	 */
	launchDashboard: (hit: SessionHit) => Promise<"exit" | "return">;
}

/**
 * The search ↔ dashboard round trip: search until the user opens a hit,
 * show the dashboard, and on `q` re-mount search with the preserved
 * snapshot. Repeats until the user quits search itself or hard-exits the
 * dashboard.
 */
export async function runSearchDashboardLoop(
	initialQuery: string,
	deps: SearchLoopDeps,
): Promise<void> {
	let restore: SearchTuiSnapshot | undefined;
	while (true) {
		const selection = await deps.mountSearch({
			query: restore?.query ?? initialQuery,
			restore,
		});
		if (!selection) return;
		restore = selection.snapshot;
		const outcome = await deps.launchDashboard(selection.hit);
		if (outcome === "exit") return;
	}
}

// ── Production wiring ────────────────────────────────────────────────────────

export async function runSessionSearchTui(
	initialQuery: string,
	opts: RunSessionSearchTuiOptions = {},
): Promise<void> {
	const scanOpts = opts.scan ?? {};
	const runScan = async (q: string): Promise<SessionHit[]> => {
		return searchSessions(q, scanOpts);
	};

	await runSearchDashboardLoop(initialQuery, {
		mountSearch: async ({ query, restore }) => {
			let selection: SearchSelection | null = null;

			await new Promise<void>((resolve) => {
				let exited = false;
				const handleExit = () => {
					if (exited) return;
					exited = true;
					resolve();
				};

				const app = (
					<SessionSearchTui
						initialQuery={query}
						initialHits={restore?.hits}
						initialCursor={restore?.cursorIndex}
						runScan={runScan}
						onExit={handleExit}
						onSelectHit={(hit, snapshot) => {
							// Remember the hit and the TUI state; the dashboard
							// launch happens after Ink fully unmounts so the
							// alt-screen / raw mode is released before the next
							// TUI takes over.
							selection = { hit, snapshot };
						}}
					/>
				);

				const instance = render(app, {
					stdin: process.stdin,
					stdout: process.stdout,
				});

				void instance.waitUntilExit().then(() => {
					handleExit();
				});
			});

			return selection;
		},
		launchDashboard: async (hit) => {
			const { initializeAdapters } = await import(
				"@umwelten/core/interaction/adapters/index.js"
			);
			initializeAdapters();
			const { runExploreBrowseTui } = await import("../introspect/browse.js");
			return runExploreBrowseTui({
				projectPath: hit.projectPath,
				targetPath: hit.projectPath,
				model: opts.model ?? DEFAULT_DASHBOARD_MODEL,
				preSelectSessionId: hit.sessionId,
				returnToCaller: true,
			});
		},
	});
}
