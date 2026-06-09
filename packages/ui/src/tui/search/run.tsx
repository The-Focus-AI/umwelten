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
 * hit's session pre-selected as the highlighted row. `q` in the launched
 * dashboard exits the process (slice 7 will change that to bounce back to
 * search). When the dashboard returns, this runner returns — search is a
 * one-way trip in slice 6.
 */
import React from "react";
import { render } from "ink";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import {
	searchSessions,
	type SearchOptions,
	type SessionHit,
} from "@umwelten/core/interaction/search/index.js";
import { SessionSearchTui } from "./SessionSearchTui.js";

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

export async function runSessionSearchTui(
	initialQuery: string,
	opts: RunSessionSearchTuiOptions = {},
): Promise<void> {
	const scanOpts = opts.scan ?? {};

	let selectedHit: SessionHit | null = null;

	await new Promise<void>((resolve) => {
		let exited = false;
		const handleExit = () => {
			if (exited) return;
			exited = true;
			resolve();
		};

		const runScan = async (q: string): Promise<SessionHit[]> => {
			return searchSessions(q, scanOpts);
		};

		const app = (
			<SessionSearchTui
				initialQuery={initialQuery}
				runScan={runScan}
				onExit={handleExit}
				onSelectHit={(hit) => {
					// Remember the hit; the dashboard launch happens after Ink
					// fully unmounts so the alt-screen / raw mode is released
					// before the next TUI takes over.
					selectedHit = hit;
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

	if (!selectedHit) return;

	// Slice 6 (#88): the user picked a hit. Hand off to the Exploration
	// Browser dashboard, scoped to the hit's project with the hit's session
	// pre-selected. The dashboard runs its own event loop until the user
	// quits with `q` (slice 7 will make `q` bounce back to search results).
	const { initializeAdapters } = await import(
		"@umwelten/core/interaction/adapters/index.js"
	);
	initializeAdapters();
	const { runExploreBrowseTui } = await import("../introspect/browse.js");
	const hit: SessionHit = selectedHit;
	await runExploreBrowseTui({
		projectPath: hit.projectPath,
		targetPath: hit.projectPath,
		model: opts.model ?? DEFAULT_DASHBOARD_MODEL,
		preSelectSessionId: hit.sessionId,
	});
}
