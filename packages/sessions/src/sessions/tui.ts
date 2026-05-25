/**
 * `umwelten sessions tui` + `umwelten sessions browse` — TUI launchers.
 *
 * Both lazy-import their React Ink components from @umwelten/ui to
 * keep cold startup fast (the Ink runtime is heavy).
 */

import { cwd } from "node:process";
import { resolve } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";

export function registerTuiCommands(parent: Command): void {
// TUI subcommand
interface TuiOptions {
	project: string;
	file?: string;
	session?: string;
}

parent
	.command("tui")
	.description(
		"Interactive session TUI: overview, live stream, file, or session by ID",
	)
	.argument(
		"[file-or-session-id]",
		"Session JSONL file path or session ID to open",
	)
	.option(
		"-p, --project <path>",
		"Project path (defaults to current directory)",
		cwd(),
	)
	.option("--file <path>", "Open session from JSONL file path")
	.option("--session <id>", "Open session by ID (from sessions list)")
	.action(async (fileOrSessionId: string | undefined, options: TuiOptions) => {
		try {
			const { stdin } = await import("node:process");
			const projectPath = resolve(options.project);
			const hasStdin = !stdin.isTTY;

			let filePath: string | undefined = options.file;
			let sessionId: string | undefined = options.session;

			if (fileOrSessionId) {
				if (options.file) filePath = options.file;
				else if (options.session) sessionId = options.session;
				else if (
					fileOrSessionId.includes("/") ||
					fileOrSessionId.endsWith(".jsonl")
				) {
					filePath = resolve(fileOrSessionId);
				} else {
					sessionId = fileOrSessionId;
				}
			}

			const { runSessionTui } = await import("@umwelten/ui/tui/index.js");
			await runSessionTui({
				projectPath,
				filePath,
				sessionId,
				hasStdin,
			});
		} catch (error) {
			console.error(chalk.red("Error starting TUI:"), error);
			process.exit(1);
		}
	});

// Browse subcommand (session browser: search, first messages, index summary)
interface BrowseOptions {
	project: string;
}

parent
	.command("browse")
	.description(
		"Session browser: search, first messages, and index summary (Enter to open detail)",
	)
	.option(
		"-p, --project <path>",
		"Project path (defaults to current directory)",
		cwd(),
	)
	.action(async (options: BrowseOptions) => {
		try {
			const projectPath = resolve(options.project);
			const { runBrowserTui } = await import(
				"@umwelten/ui/tui/browser/index.js"
			);
			const selectedId = await runBrowserTui({
				projectPath,
				onSelectSession: (_id) => {
					// selectedId is returned; print after TUI exits
				},
			});
			if (selectedId) {
				console.log(chalk.dim("\nTo view full session:"));
				console.log(chalk.cyan(`  umwelten sessions show ${selectedId}`));
			}
		} catch (error) {
			console.error(chalk.red("Error starting browser:"), error);
			process.exit(1);
		}
	});

}
