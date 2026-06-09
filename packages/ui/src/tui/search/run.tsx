/**
 * Runner that mounts the SessionSearchTui in a real terminal.
 *
 * `runSessionSearchTui(query, opts)` is the single entry point used by
 * `umwelten search "query"` (registered in @umwelten/sessions). It runs the
 * scan, mounts the Ink TUI, waits for the user to press `q`, and returns.
 *
 * Slice 4 (#86): pre-scan before mount so the TUI sees a resolved hit list on
 * first frame. Slices 5+ will pass `runScan` straight through and run the
 * scan from inside the component for editable queries.
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
	/** Forwarded to `searchSessions`. */
	scan?: SearchOptions;
}

export async function runSessionSearchTui(
	query: string,
	opts: RunSessionSearchTuiOptions = {},
): Promise<void> {
	// Pre-scan: we resolve the hits before mounting so the first frame has the
	// results. The component still accepts a Promise so it can show the
	// "scanning…" indicator if a future caller passes a pending promise.
	// Errors (e.g. RipgrepNotFoundError) bubble up to search.ts.
	const hits: SessionHit[] = await searchSessions(query, opts.scan ?? {});

	await new Promise<void>((resolve) => {
		let exited = false;
		const handleExit = () => {
			if (exited) return;
			exited = true;
			resolve();
		};

		const app = (
			<SessionSearchTui
				query={query}
				runScan={async () => hits}
				onExit={handleExit}
			/>
		);

		const instance = render(app, {
			stdin: process.stdin,
			stdout: process.stdout,
		});

		void instance.waitUntilExit().then(() => {
			// Ink exited (e.g. via useApp().exit() inside the component). Make
			// sure the outer promise resolves even if onExit wasn't reached.
			handleExit();
		});
	});
}
