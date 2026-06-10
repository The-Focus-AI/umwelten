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
 * Slice 7 (#89): the handoff is now a round trip. The dashboard is launched
 * with `returnToCaller`, so `q` resolves it with the "return" outcome and the
 * search TUI re-mounts with its prior state preserved — same query, same hit
 * list, same highlighted row, no re-scan. The user can open hit → q → open
 * another hit → q → … indefinitely; Esc/Ctrl+C in search (or Ctrl+C in the
 * dashboard) ends the loop. The loop itself (`runSearchDashboardLoop`) takes
 * injected deps so it is unit-testable without Ink.
 */
import React from "react";
import { render } from "ink";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import {
	searchSessions,
	type SearchOptions,
	type SessionHit,
} from "@umwelten/core/interaction/search/index.js";
import type { BrowseTuiOutcome } from "../introspect/browse.js";
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

// ── Loop orchestrator (unit-testable, no Ink) ───────────────────────────────

/** State a search mount starts from — fresh (query only) or restored. */
export interface SearchMountState {
	query: string;
	/** Restored hit list from a prior mount; skips the initial scan. */
	hits?: SessionHit[];
	/** Restored highlight index, paired with `hits`. */
	cursor?: number;
}

/** What the user did in a search mount: picked a hit (+ state snapshot). */
export interface SearchSelection {
	hit: SessionHit;
	snapshot: SearchTuiSnapshot;
}

export interface SearchLoopDeps {
	/**
	 * Mount the search TUI with the given state. Resolves with the selected
	 * hit + snapshot when the user presses Enter, or null when the user quits
	 * search (Esc / Ctrl+C).
	 */
	mountSearch: (state: SearchMountState) => Promise<SearchSelection | null>;
	/**
	 * Launch the Exploration Browser dashboard for the hit. Resolves with
	 * "return" when the user pressed `q` (bounce back to search) or "exit"
	 * for a hard quit (Ctrl+C).
	 */
	launchDashboard: (hit: SessionHit) => Promise<BrowseTuiOutcome>;
}

/**
 * Search ↔ dashboard round-trip loop (slice 7, #89). Pure orchestration:
 * mounts search, launches the dashboard on selection, and re-mounts search
 * with the preserved snapshot for as long as the dashboard keeps resolving
 * with "return".
 */
export async function runSearchDashboardLoop(
	initialQuery: string,
	deps: SearchLoopDeps,
): Promise<void> {
	let state: SearchMountState = { query: initialQuery };

	while (true) {
		const selection = await deps.mountSearch(state);
		if (!selection) return; // Esc / Ctrl+C in search — exit cleanly.

		const outcome = await deps.launchDashboard(selection.hit);
		if (outcome !== "return") return; // hard quit from the dashboard.

		// `q` bounced back: restore search exactly where the user left it.
		state = {
			query: selection.snapshot.query,
			hits: selection.snapshot.hits,
			cursor: selection.snapshot.cursor,
		};
	}
}

// ── Real-terminal wiring ────────────────────────────────────────────────────

async function mountSearchTui(
	state: SearchMountState,
	runScan: (q: string) => Promise<SessionHit[]>,
): Promise<SearchSelection | null> {
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
				initialQuery={state.query}
				initialHits={state.hits}
				initialCursor={state.cursor}
				runScan={runScan}
				onExit={handleExit}
				onSelectHit={(hit, snapshot) => {
					// Remember the hit; the dashboard launch happens after Ink
					// fully unmounts so the alt-screen / raw mode is released
					// before the next TUI takes over.
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
}

export async function runSessionSearchTui(
	initialQuery: string,
	opts: RunSessionSearchTuiOptions = {},
): Promise<void> {
	const scanOpts = opts.scan ?? {};
	const runScan = async (q: string): Promise<SessionHit[]> => {
		return searchSessions(q, scanOpts);
	};

	await runSearchDashboardLoop(initialQuery, {
		mountSearch: (state) => mountSearchTui(state, runScan),
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
