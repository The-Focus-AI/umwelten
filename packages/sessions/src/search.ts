/**
 * `umwelten search` — system-wide full-content search across every
 * Source Session on disk.
 *
 * Slice 5 (#87): the no-arg form drops into the TUI with an empty query;
 * the TUI's query is now editable with debounced live re-scan. `--json`
 * still requires a query and short-circuits to stdout output.
 *
 * Output matrix per PRD #82:
 *
 *   umwelten search               → empty TUI w/ editable query (slice 5)
 *   umwelten search "q"           → pre-populated TUI (slice 4)
 *   umwelten search "q" --json    → JSON to stdout, no TUI
 *   umwelten search "q" --no-tui  → plain rows to stdout, no TUI (slice 9)
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
		"Optional search query. When omitted, the TUI launches with an empty " +
			"editable query. Required with --json.",
	)
	.option("--json", "Print results as a JSON array to stdout, no TUI.")
	.option(
		"--case-sensitive",
		"Match the query case-sensitively (default: case-insensitive).",
	)
	.action(async (query: string | undefined, options: SearchActionOptions) => {
		try {
			if (options.json) {
				// JSON path needs a query — there's nothing to scan otherwise.
				if (!query) {
					process.stderr.write(
						"umwelten search --json: a query argument is required.\n" +
							"  Usage: umwelten search 'your query' --json\n",
					);
					process.exit(2);
				}
				const hits = await searchSessions(query, {
					caseSensitive: options.caseSensitive ?? false,
				});
				process.stdout.write(JSON.stringify(hits, null, 2) + "\n");
				return;
			}

			// Default: mount the TUI. An empty query is fine — the TUI launches
			// with an empty editable field and waits for the user to type.
			const { runSessionSearchTui } = await import(
				"@umwelten/ui/tui/search/run.js"
			);
			await runSessionSearchTui(query ?? "", {
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
