/**
 * `umwelten search` — system-wide full-content search across every
 * Source Session on disk.
 *
 * Slice 1 (this slice): supports only `--json` output. The two-pane
 * TUI, `--no-tui` plaintext output, editable query, etc. land in
 * slices 4-9. For slice 1 the command must be runnable end-to-end:
 *
 *   umwelten search "score the industry" --json
 *
 * prints a JSON array of SessionHits to stdout.
 *
 * If `--json` is omitted, the command currently errors with a
 * friendly hint pointing at the not-yet-built TUI. Once slice 4
 * lands, the same code path mounts the TUI.
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
		"Search query. Required when --json is used. " +
			"In future slices, omitting the query opens an interactive TUI.",
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
					"  Usage: umwelten search 'your query' --json\n" +
					"  (Interactive TUI lands in a later slice.)\n",
			);
			process.exit(2);
		}

		try {
			const hits = await searchSessions(query, {
				caseSensitive: options.caseSensitive ?? false,
			});

			if (options.json) {
				process.stdout.write(JSON.stringify(hits, null, 2) + "\n");
				return;
			}

			// Non-JSON output without --json is reserved for the TUI in
			// slice 4. For slice 1 we error out clearly rather than
			// silently fall back to JSON.
			process.stderr.write(
				`Found ${hits.length} hit(s). Pass --json to print them, ` +
					"or wait for slice 4 which adds the interactive TUI.\n",
			);
			process.exit(2);
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
