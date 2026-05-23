import React from "react";
import { render } from "ink";
import { resolve } from "node:path";
import chalk from "chalk";
import { BrowseApp, type BrowseIntent } from "./BrowseApp.js";
import {
	DashboardApp,
	type DashboardIntent,
	type DashboardProgressEvent,
} from "./DashboardApp.js";
import {
	buildBrowse,
	buildExploreBrowse,
	loadDigest,
	saveDigest,
} from "@umwelten/evaluation/introspection/browse.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import type { ExplorationBrowserEntry } from "@umwelten/sessions/introspection/browse.js";

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

// ── Exploration-oriented browser (v2) — command-center dashboard ────────

/**
 * Mount the new command-center dashboard. Wires extraction progress events
 * from a host-owned bus into the dashboard's `subscribeToExtractionEvents`
 * prop, and resolves with the user's exit intent.
 */
async function showDashboardTui(args: {
	projectPath: string;
	targetPath: string;
	entries: ExplorationBrowserEntry[];
	runCount: number;
	modelLabel: string;
	concurrency: number;
	/** Called from the dashboard's overlay confirm. */
	onLaunchExtraction: (
		emit: (event: DashboardProgressEvent) => void,
	) => void;
}): Promise<DashboardIntent> {
	let intent: DashboardIntent = { kind: "none" };

	// Set up a fan-out bus so background extraction can push events to the
	// dashboard subscriber and we can still call onLaunchExtraction with the
	// same emit function.
	const listeners = new Set<(event: DashboardProgressEvent) => void>();
	const subscribe = (cb: (event: DashboardProgressEvent) => void) => {
		listeners.add(cb);
		return () => {
			listeners.delete(cb);
		};
	};
	const emit = (event: DashboardProgressEvent) => {
		for (const cb of listeners) cb(event);
	};

	const app = (
		<DashboardApp
			projectPath={args.projectPath}
			targetPath={args.targetPath}
			entries={args.entries}
			runCount={args.runCount}
			modelLabel={args.modelLabel}
			concurrency={args.concurrency}
			startupConfirm
			onExit={(i) => {
				intent = i;
			}}
			onLaunchExtraction={() => args.onLaunchExtraction(emit)}
			subscribeToExtractionEvents={subscribe}
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
 * Run extraction across all undigested/stale entries, emitting dashboard
 * progress events as it goes.
 *
 * Sequential by default; concurrency may be raised by the caller.
 */
async function runExtractionPass(args: {
	projectPath: string;
	entries: ExplorationBrowserEntry[];
	model: ModelDetails;
	concurrency: number;
	emit: (event: DashboardProgressEvent) => void;
}): Promise<void> {
	const { projectPath, entries, model, concurrency, emit } = args;
	const { ExtractionEngine } = await import(
		"@umwelten/core/interaction/analysis/extraction-engine.js"
	);
	const projectName = projectPath.split("/").slice(-2).join("/");

	// Build ExtractionInputs from entries.
	const inputs = entries
		.filter((e) => e.filePath)
		.map((e) => ({
			explorationId: e.exploration.id,
			sessionId: e.sourceSession.id,
			modified: e.sourceSession.modified,
			source: e.sourceSession.source,
			sessionEntry: {
				sessionId: e.sourceSession.id,
				fullPath: e.filePath as string,
				fileMtime: e.modifiedMs,
				firstPrompt: e.exploration.name,
				messageCount: e.sourceSession.messageCount,
				created: e.sourceSession.created,
				modified: e.sourceSession.modified,
				gitBranch: e.sourceSession.gitBranch ?? "",
				projectPath,
				isSidechain: false,
			},
		}));

	// Load existing digests so the engine can detect scope correctly.
	const digestInfos = new Map<
		string,
		{ digestedAt: string; schemaVersion?: number }
	>();
	await Promise.all(
		entries.map(async (e) => {
			const d = await loadDigest(projectPath, e.sourceSession.id);
			if (d?.digestedAt) {
				digestInfos.set(e.sourceSession.id, { digestedAt: d.digestedAt });
			}
		}),
	);

	const engine = new ExtractionEngine({ concurrency });

	// Surface a kickoff signal immediately so the bottom status bar moves the
	// moment the user confirms — otherwise the dashboard looks idle until the
	// first `digesting` event fires (which can take >10s while the digester
	// loads + beats the first session).
	if (inputs.length === 0) {
		emit({
			explorationId: "",
			sessionId: "",
			phase: "failed",
			detail:
				"No Explorations had a resolvable filePath. Nothing to extract.",
		});
		return;
	}

	emit({
		explorationId: "",
		sessionId: "__kickoff__",
		phase: "digesting",
		detail: `Starting extraction across ${inputs.length} exploration${inputs.length === 1 ? "" : "s"}…`,
	});

	try {
		await engine.run(
			inputs,
			digestInfos,
			projectPath,
			projectName,
			model,
			(event) => {
				emit({
					explorationId: event.explorationId,
					sessionId: event.sessionId,
					phase: event.phase,
					detail: event.detail,
				});
			},
		);
		emit({
			explorationId: "",
			sessionId: "__kickoff__",
			phase: "digested",
			detail: "Extraction pass complete.",
		});
	} catch (err) {
		emit({
			explorationId: "",
			sessionId: "",
			phase: "failed",
			detail: err instanceof Error ? err.message : String(err),
		});
	}
}

/**
 * Run the Exploration-oriented browse TUI with a project.
 *
 * Mounts the command-center dashboard (issue #64). The dashboard discovers
 * Explorations via the projection layer and the per-source adapters. On
 * confirmation, an extraction pass runs in the background and streams
 * progress events into the dashboard.
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

		const modelLabel = `${model.provider}:${model.name}`;
		const intent = await showDashboardTui({
			projectPath,
			targetPath,
			entries,
			runCount: runs.length,
			modelLabel,
			concurrency: 1,
			onLaunchExtraction: (emit) => {
				// Fire and forget — events flow back through `emit`.
				void runExtractionPass({
					projectPath,
					entries,
					model,
					concurrency: 1,
					emit,
				});
			},
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
			continue;
		}

		if (intent.kind === "reflect") {
			console.log(
				chalk.yellow(
					"[reflect] not yet implemented — see follow-up issue tracking the reflect-and-promote workflow.",
				),
			);
			console.log(chalk.dim(`exploration: ${entry.exploration.name}`));
			await new Promise((r) => setTimeout(r, 1500));
			continue;
		}

		if (intent.kind === "promote") {
			console.log(
				chalk.yellow(
					"[promote] not yet implemented — see PRD #56 (out of scope for #64).",
				),
			);
			console.log(chalk.dim(`exploration: ${entry.exploration.name}`));
			await new Promise((r) => setTimeout(r, 1500));
			continue;
		}
	}
}
