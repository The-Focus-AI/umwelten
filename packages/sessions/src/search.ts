/**
 * `umwelten search` — system-wide full-content search across every
 * Source Session on disk.
 *
 * Slice 9 (#91) finalizes the CLI contract per PRD #82:
 *
 *   umwelten search               → empty TUI w/ editable query (slice 5)
 *   umwelten search "q"           → pre-populated TUI (slice 4)
 *   umwelten search "q" --json    → structured SessionHit[] to stdout, no TUI
 *   umwelten search "q" --no-tui  → flat human-readable rows to stdout, no TUI
 *
 * `--no-tui` prints one `timestamp · project · role · snippet` row per hit
 * (grep/less-friendly); `--json` is the programmatic shape. Both require a
 * query and never mount the TUI.
 *
 * Every invocation preflights for ripgrep before doing anything else, so a
 * missing `rg` produces the install hint on a clean stderr (exit 127)
 * instead of dying after the TUI owns the terminal.
 */

import { Command } from "commander";
import {
	ripgrepAvailable,
	RipgrepNotFoundError,
	searchSessions,
} from "@umwelten/core/interaction/search/index.js";
import { formatHitRows } from "./search-format.js";

interface SearchActionOptions {
	json?: boolean;
	/** Commander negated flag: `--no-tui` sets this to false. */
	tui?: boolean;
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
			"editable query. Required with --json or --no-tui.",
	)
	.option(
		"--json",
		"Print results as a structured JSON array (SessionHit[]) to stdout, " +
			"no TUI. For programmatic consumers.",
	)
	.option(
		"--no-tui",
		"Print human-readable rows (timestamp · project · role · snippet), " +
			"one per line, to stdout — no TUI. Suitable for grep/less piping.",
	)
	.option(
		"--case-sensitive",
		"Match the query case-sensitively (default: case-insensitive).",
	)
	.addHelpText(
		"after",
		[
			"",
			"Output modes:",
			"  umwelten search                     empty TUI, type to search",
			'  umwelten search "query"             TUI pre-populated, scan pre-run',
			'  umwelten search "query" --json      SessionHit[] JSON to stdout',
			'  umwelten search "query" --no-tui    flat rows: timestamp · project · role · snippet',
			"",
			"In the TUI: type to refine the query, ↑/↓ to move, Enter opens the",
			"hit in the Exploration Browser dashboard (q there bounces back to",
			"your results), Esc/Ctrl+C exits.",
			"",
			"Requires ripgrep (`rg`) on PATH — e.g. `brew install ripgrep`.",
			"More: https://github.com/BurntSushi/ripgrep#installation",
		].join("\n"),
	)
	.action(async (query: string | undefined, options: SearchActionOptions) => {
		try {
			// Preflight once per invocation, before any scan or TUI mount,
			// so the install hint never fights a half-mounted alt screen.
			if (!(await ripgrepAvailable())) {
				process.stderr.write(new RipgrepNotFoundError().message + "\n");
				process.exit(127); // conventional "command not found" exit
			}

			const noTui = options.tui === false;

			if (options.json && noTui) {
				process.stderr.write(
					"umwelten search: --json and --no-tui are mutually exclusive.\n",
				);
				process.exit(2);
			}

			if (options.json || noTui) {
				// Both stdout modes need a query — there's nothing to scan
				// otherwise.
				if (!query) {
					const flag = options.json ? "--json" : "--no-tui";
					process.stderr.write(
						`umwelten search ${flag}: a query argument is required.\n` +
							`  Usage: umwelten search 'your query' ${flag}\n`,
					);
					process.exit(2);
				}
				const hits = await searchSessions(query, {
					caseSensitive: options.caseSensitive ?? false,
				});
				process.stdout.write(
					options.json
						? JSON.stringify(hits, null, 2) + "\n"
						: formatHitRows(hits),
				);
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
				process.exit(127);
			}
			process.stderr.write(
				`umwelten search failed: ${err instanceof Error ? err.message : String(err)}\n`,
			);
			process.exit(1);
		}
	});
