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
 */
import React from "react";
import { render } from "ink";
import {
	searchSessions,
	type SearchOptions,
	type SessionHit,
} from "@umwelten/core/interaction/search/index.js";
import { SessionSearchTui } from "./SessionSearchTui.js";

export interface RunSessionSearchTuiOptions {
	/** Forwarded to `searchSessions` on every scan. */
	scan?: SearchOptions;
}

export async function runSessionSearchTui(
	initialQuery: string,
	opts: RunSessionSearchTuiOptions = {},
): Promise<void> {
	const scanOpts = opts.scan ?? {};

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
}
