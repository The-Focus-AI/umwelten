import React from "react";
import { render } from "ink";
import { resolve } from "node:path";
import chalk from "chalk";
import { BrowseApp, type BrowseIntent } from "./BrowseApp.js";
import {
	ExploreBrowseApp,
	type ExploreBrowseIntent,
} from "./ExploreBrowseApp.js";
import {
	buildBrowse,
	buildExploreBrowse,
} from "@umwelten/evaluation/introspection/browse.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";

export interface RunBrowseTuiOptions {
	projectPath: string;
	targetPath: string;
	sessionsDir?: string;
	model: ModelDetails;
}

/**
 * Show the browse TUI and resolve with the user's exit intent.
 * The TUI tears down before the promise resolves, so follow-up actions
 * (LLM calls, launching another TUI) run with a clean terminal.
 */
async function showBrowseTui(args: {
	projectPath: string;
	targetPath: string;
	entries: Awaited<ReturnType<typeof buildBrowse>>["entries"];
	runCount: number;
}): Promise<BrowseIntent> {
	let intent: BrowseIntent = { kind: "none" };

	const app = (
		<BrowseApp
			projectPath={args.projectPath}
			targetPath={args.targetPath}
			entries={args.entries}
			runCount={args.runCount}
			onExit={(i) => {
				intent = i;
			}}
		/>
	);

	const renderOpts = { stdin: process.stdin, stdout: process.stdout };
	if (process.env.UMWELTEN_TUI_NO_FULLSCREEN === "1") {
		const instance = render(app, renderOpts);
		await instance.waitUntilExit();
		return intent;
	}
	try {
		const { withFullScreen } = await import("fullscreen-ink");
		const ink = withFullScreen(app, renderOpts);
		ink.start();
		await ink.waitUntilExit();
		return intent;
	} catch {
		const instance = render(app, renderOpts);
		await instance.waitUntilExit();
		return intent;
	}
}

export async function runIntrospectBrowseTui(
	opts: RunBrowseTuiOptions,
): Promise<void> {
	const {
		projectPath: rawProject,
		targetPath: rawTarget,
		sessionsDir,
		model,
	} = opts;
	const projectPath = resolve(rawProject);
	const targetPath = resolve(rawTarget);

	// Event loop: show browse → act on intent → rebuild data → show browse again.
	// Keeps the terminal coherent across digest/detail launches.
	while (true) {
		const { entries, runs } = await buildBrowse({ projectPath, sessionsDir });

		if (entries.length === 0) {
			console.log(chalk.yellow("No sessions found for this project."));
			console.log(chalk.dim(`Project: ${projectPath}`));
			if (sessionsDir) console.log(chalk.dim(`Sessions dir: ${sessionsDir}`));
			return;
		}

		const intent = await showBrowseTui({
			projectPath,
			targetPath,
			entries,
			runCount: runs.length,
		});

		if (intent.kind === "none") return;

		if (intent.kind === "transcript") {
			const { runSessionTui } = await import("../index.js");
			await runSessionTui({
				projectPath,
				filePath: intent.entry.filePath,
				hasStdin: false,
			});
			// Loop back to browse after transcript viewer exits.
			continue;
		}

		if (intent.kind === "detail") {
			const { runDigestDetailTui } = await import("./detail.js");
			await runDigestDetailTui({
				projectPath,
				targetPath,
				entry: intent.entry,
				model,
			});
			continue;
		}

		if (intent.kind === "digest") {
			const { runDigestLiveTui } = await import("./digest-live.js");
			await runDigestLiveTui({
				projectPath,
				entry: intent.entry,
				model,
			});
			continue;
		}

		if (intent.kind === "beats") {
			const { runBeatsTui } = await import("./beats.js");
			try {
				await runBeatsTui({ entry: intent.entry });
			} catch (err) {
				console.error(
					chalk.red(
						`[beats] failed: ${err instanceof Error ? err.message : String(err)}`,
					),
				);
			}
		}
	}
}

// ── Exploration-oriented browser (v2) ───────────────────────────────────

/**
 * Show the Exploration browse TUI and resolve with the user's exit intent.
 */
async function showExploreBrowseTui(args: {
	projectPath: string;
	targetPath: string;
	entries: Awaited<ReturnType<typeof buildExploreBrowse>>["entries"];
	runCount: number;
}): Promise<ExploreBrowseIntent> {
	let intent: ExploreBrowseIntent = { kind: "none" };

	const app = (
		<ExploreBrowseApp
			projectPath={args.projectPath}
			targetPath={args.targetPath}
			entries={args.entries}
			runCount={args.runCount}
			onExit={(i) => {
				intent = i;
			}}
		/>
	);

	const renderOpts = { stdin: process.stdin, stdout: process.stdout };
	if (process.env.UMWELTEN_TUI_NO_FULLSCREEN === "1") {
		const instance = render(app, renderOpts);
		await instance.waitUntilExit();
		return intent;
	}
	try {
		const { withFullScreen } = await import("fullscreen-ink");
		const ink = withFullScreen(app, renderOpts);
		ink.start();
		await ink.waitUntilExit();
		return intent;
	} catch {
		const instance = render(app, renderOpts);
		await instance.waitUntilExit();
		return intent;
	}
}

/**
 * Run the Exploration-oriented browse TUI with a project.
 *
 * Uses the projection layer to discover sessions from all adapters
 * (Claude Code, pi, Cursor) and displays them as Exploration rows.
 * Falls back to the session browser when no projection data is available.
 */
export async function runExploreBrowseTui(
	opts: RunBrowseTuiOptions,
): Promise<void> {
	const {
		projectPath: rawProject,
		targetPath: rawTarget,
		sessionsDir,
		model,
	} = opts;
	const projectPath = resolve(rawProject);
	const targetPath = resolve(rawTarget);

	while (true) {
		const { entries, runs } = await buildExploreBrowse({
			projectPath,
			sessionsDir,
		});

		if (entries.length === 0) {
			console.log(chalk.yellow("No explorations found for this project."));
			console.log(chalk.dim(`Project: ${projectPath}`));
			if (sessionsDir) console.log(chalk.dim(`Sessions dir: ${sessionsDir}`));
			return;
		}

		const intent = await showExploreBrowseTui({
			projectPath,
			targetPath,
			entries,
			runCount: runs.length,
		});

		if (intent.kind === "none") return;

		const entry = intent.entry;

		if (intent.kind === "transcript") {
			if (!entry.filePath) {
				console.log(
					chalk.yellow(
						"Transcript not available — file path unknown for this session.",
					),
				);
				continue;
			}
			const { runSessionTui } = await import("../index.js");
			await runSessionTui({
				projectPath,
				filePath: entry.filePath,
				hasStdin: false,
			});
			continue;
		}

		if (intent.kind === "detail") {
			const { runDigestDetailTui } = await import("./detail.js");
			// Build a synthetic SessionBrowserEntry for the downstream view
			const syntheticEntry = {
				id: entry.sourceSession.id,
				source: entry.sourceSession.source as "claude-code" | "habitat",
				filePath: entry.filePath ?? "",
				modifiedISO: entry.sourceSession.modified,
				modifiedMs: entry.modifiedMs,
				firstPrompt: entry.exploration.name,
				messageCount: entry.sourceSession.messageCount,
				analyzedIn: entry.analyzedIn,
				modifiedSinceAnalysis: entry.modifiedSinceAnalysis,
				everAnalyzed: entry.everAnalyzed,
				digest: entry.digest,
			};
			await runDigestDetailTui({
				projectPath,
				targetPath,
				entry: syntheticEntry,
				model,
			});
			continue;
		}

		if (intent.kind === "digest") {
			const { runDigestLiveTui } = await import("./digest-live.js");
			const syntheticEntry = {
				id: entry.sourceSession.id,
				source: entry.sourceSession.source as "claude-code" | "habitat",
				filePath: entry.filePath ?? "",
				modifiedISO: entry.sourceSession.modified,
				modifiedMs: entry.modifiedMs,
				firstPrompt: entry.exploration.name,
				messageCount: entry.sourceSession.messageCount,
				analyzedIn: entry.analyzedIn,
				modifiedSinceAnalysis: entry.modifiedSinceAnalysis,
				everAnalyzed: entry.everAnalyzed,
			};
			await runDigestLiveTui({ projectPath, entry: syntheticEntry, model });
			continue;
		}

		if (intent.kind === "beats") {
			if (!entry.filePath) {
				console.log(
					chalk.yellow(
						"Beats not available — file path unknown for this session.",
					),
				);
				continue;
			}
			const { runBeatsTui } = await import("./beats.js");
			try {
				const syntheticEntry = {
					id: entry.sourceSession.id,
					source: entry.sourceSession.source as "claude-code" | "habitat",
					filePath: entry.filePath,
					modifiedISO: entry.sourceSession.modified,
					modifiedMs: entry.modifiedMs,
					firstPrompt: entry.exploration.name,
					messageCount: entry.sourceSession.messageCount,
					analyzedIn: entry.analyzedIn,
					modifiedSinceAnalysis: entry.modifiedSinceAnalysis,
					everAnalyzed: entry.everAnalyzed,
				};
				await runBeatsTui({ entry: syntheticEntry });
			} catch (err) {
				console.error(
					chalk.red(
						`[beats] failed: ${err instanceof Error ? err.message : String(err)}`,
					),
				);
			}
		}
	}
}
