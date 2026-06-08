/**
 * `umwelten search` — system-wide full-content search across every
 * Source Session on disk.
 *
 * Slice 4 (#86): adds the two-pane TUI as the default behaviour when a
 * query is passed and `--json` is not. `--json` continues to print a flat
 * array to stdout. The no-arg form still errors out for now — slice 5 (#87)
 * lands the empty TUI / editable query.
 *
 * Output matrix per PRD #82:
 *
 *   umwelten search "q"           → mount the two-pane TUI (slice 4)
 *   umwelten search "q" --json    → JSON to stdout, no TUI
 *   umwelten search "q" --no-tui  → plain rows to stdout, no TUI (slice 9)
 *   umwelten search               → empty TUI w/ editable query (slice 5)
 */

import { Command } from "commander";
import {
	searchSessions,
	RipgrepNotFoundError,
} from "@umwelten/core/interaction/search/index.js";

interface SearchActionOptions {
	json?: boolean;
	caseSensitive?: boolean;
}

export const searchCommand = new Command("search")
	.description(
		"Search every Source Session for full-content matches of <query>. " +
			"Scans ~/.claude/projects (Claude Code only in v1). " +
			"Requires ripgrep (`rg`) on PATH.",
	)
	.argument(
		"[query]",
		"Search query. Required in this build. " +
			"In a later slice, omitting the query opens the empty TUI.",
	)
	.option("--json", "Print results as a JSON array to stdout, no TUI.")
	.option(
		"--case-sensitive",
		"Match the query case-sensitively (default: case-insensitive).",
	)
	.action(async (query: string | undefined, options: SearchActionOptions) => {
		if (!query) {
			process.stderr.write(
				"umwelten search: a query argument is required in this build.\n" +
					"  Usage: umwelten search 'your query'\n" +
					"  (Empty-TUI / editable query lands in a later slice.)\n",
			);
			process.exit(2);
		}

		try {
			if (options.json) {
				// JSON path: short-circuit and skip the TUI entirely. Keeps the
				// command scriptable and identical to slice 1 behaviour.
				const hits = await searchSessions(query, {
					caseSensitive: options.caseSensitive ?? false,
				});
				process.stdout.write(JSON.stringify(hits, null, 2) + "\n");
				return;
			}

			// Default: mount the two-pane TUI. The runner does its own scan; we
			// don't pre-scan here because the TUI shows a "scanning…" indicator
			// while it runs and we want that path exercised in production too.
			const { runSessionSearchTui } = await import(
				"@umwelten/ui/tui/search/run.js"
			);
			await runSessionSearchTui(query, {
				scan: { caseSensitive: options.caseSensitive ?? false },
			});
		} catch (err) {
			if (err instanceof RipgrepNotFoundError) {
				process.stderr.write(err.message + "\n");
				process.exit(127); // conventional "command not found" exit
			}
			process.stderr.write(
				`umwelten search failed: ${err instanceof Error ? err.message : String(err)}\n`,
			);
			process.exit(1);
		}
	});
