import React from "react";
import { render } from "ink";
import { resolve } from "node:path";
import chalk from "chalk";
import {
	DashboardApp,
	type DashboardIntent,
	type DashboardProgressEvent,
} from "./DashboardApp.js";
import { buildExploreBrowse } from "@umwelten/sessions/introspection/browse.js";
import { loadDigest } from "@umwelten/core/interaction/analysis/digest-persistence.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import type { ExplorationBrowserEntry } from "@umwelten/core/interaction/types/domain-types.js";

export interface RunBrowseTuiOptions {
	projectPath: string;
	targetPath: string;
	sessionsDir?: string;
	model: ModelDetails;
	/** When true, the extraction pass re-digests every session even if it
	 * already has a fresh digest on disk. */
	force?: boolean;
	/**
	 * Pre-select the row matching this source-session id when the dashboard
	 * first mounts. Used by the Session Search → "open hit" flow (issue #88)
	 * so the row the user clicked through to is the first one highlighted.
	 * Applied only on the first mount of this run; subsequent re-mounts
	 * after detail/transcript/digest views start with the cursor at the top.
	 */
	preSelectSessionId?: string;
	/**
	 * When true, `q` in the dashboard resolves the browse loop with the
	 * "return" outcome instead of "exit", so the caller (the search TUI,
	 * slice 7 #89) can re-take the terminal. Direct launches (`umwelten
	 * browse`) leave this unset — `q` exits as before.
	 */
	returnToCaller?: boolean;
}

/**
 * How the browse loop ended:
 * - `exit`   — the user quit (q on a direct launch, or Ctrl+C anywhere).
 * - `return` — the user pressed `q` in a dashboard launched with
 *   `returnToCaller`; the caller should resume (e.g. re-mount search).
 */
export type BrowseTuiOutcome = "exit" | "return";

// ── Exploration-oriented browser (v2) — command-center dashboard ────────

/**
 * Mount the new command-center dashboard. Wires extraction progress events
 * from a host-owned bus into the dashboard's `subscribeToExtractionEvents`
 * prop, and resolves with the user's exit intent.
 */
/**
 * Shared extraction bus that survives across dashboard re-mounts.
 *
 * The TUI loop unmounts and remounts the dashboard on every detail-view /
 * transcript / beats round trip. The extraction pass, however, keeps
 * running in the background once launched. This bus lets that long-lived
 * pass keep emitting events that the *current* dashboard subscriber sees,
 * and caches the most recent phase per session so a freshly-mounted
 * dashboard can render the correct state immediately on render.
 */
interface ExtractionBus {
	subscribe: (
		listener: (event: DashboardProgressEvent) => void,
	) => () => void;
	emit: (event: DashboardProgressEvent) => void;
	/** Snapshot of the latest non-pending phase observed for each sessionId. */
	cachedPhases: Map<string, DashboardProgressEvent>;
	/** Latest synthetic "currentItem" text from a kickoff/digesting event. */
	cachedCurrentItem: { text: string | null };
	/** Loaded digest summary per session (populated when a digested event lands). */
	liveTitles: Map<string, string>;
	/** Subscribe to live-title updates (called when a digest summary is loaded). */
	subscribeToTitles: (listener: (sessionId: string, title: string) => void) => () => void;
}

function createExtractionBus(projectPath: string): ExtractionBus {
	const listeners = new Set<(event: DashboardProgressEvent) => void>();
	const titleListeners = new Set<
		(sessionId: string, title: string) => void
	>();
	const cachedPhases = new Map<string, DashboardProgressEvent>();
	const cachedCurrentItem: { text: string | null } = { text: null };
	const liveTitles = new Map<string, string>();

	return {
		subscribe(cb) {
			listeners.add(cb);
			return () => {
				listeners.delete(cb);
			};
		},
		subscribeToTitles(cb) {
			titleListeners.add(cb);
			return () => {
				titleListeners.delete(cb);
			};
		},
		emit(event) {
			// Cache per-row phase so re-mounted dashboards can backfill.
			if (event.sessionId && !event.sessionId.startsWith("__")) {
				cachedPhases.set(event.sessionId, event);
			}
			// Track the synthetic kickoff/current-item text.
			if (event.sessionId.startsWith("__")) {
				if (event.phase === "digested") {
					cachedCurrentItem.text = null;
				} else if (event.detail) {
					cachedCurrentItem.text = event.detail;
				}
			} else if (event.phase === "digesting" && event.detail) {
				cachedCurrentItem.text = event.detail;
			} else if (event.phase === "digested") {
				// Clear when no row is actively in flight; the next digesting
				// event will overwrite.
				cachedCurrentItem.text = null;
			}
			for (const cb of listeners) cb(event);

			// On digested → load the fresh summary from disk and notify
			// title-listeners. Prefer overallSummary (compaction output) over
			// analysis.summary because the analyzer often punts on pi sessions
			// with "no analyzable conversation content".
			if (
				event.phase === "digested" &&
				event.sessionId &&
				!event.sessionId.startsWith("__")
			) {
				void loadDigest(projectPath, event.sessionId).then((digest) => {
					if (!digest) return;
					const overall = digest.overallSummary?.trim();
					const analysisSummary = digest.analysis?.summary?.trim();
					const punt = /^session with no analyzable/i;
					const summary =
						overall && !punt.test(overall)
							? overall
							: analysisSummary && !punt.test(analysisSummary)
								? analysisSummary
								: null;
					if (!summary) return;
					liveTitles.set(event.sessionId, summary);
					for (const cb of titleListeners) cb(event.sessionId, summary);
				});
			}
		},
		cachedPhases,
		cachedCurrentItem,
		liveTitles,
	};
}

async function showDashboardTui(args: {
	projectPath: string;
	targetPath: string;
	entries: ExplorationBrowserEntry[];
	runCount: number;
	modelLabel: string;
	concurrency: number;
	/** When false, suppress the startup confirmation overlay — used on
	 * re-entries to the dashboard after the user has already answered (or
	 * after an extraction pass has been launched). */
	startupConfirm: boolean;
	/** Shared bus that survives unmount. */
	bus: ExtractionBus;
	/** Called from the dashboard's overlay confirm. */
	onLaunchExtraction: () => void;
	/** Pre-select the matching row on mount (Session Search → open hit). */
	preSelectSessionId?: string;
	/** `q` emits a "return" intent instead of exiting (slice 7, #89). */
	returnToCaller?: boolean;
}): Promise<DashboardIntent> {
	let intent: DashboardIntent = { kind: "none" };

	// On (re-)mount, drain the cached phases into the new subscriber so the
	// freshly rendered table reflects everything that happened while the
	// dashboard was unmounted.
	const subscribeAndReplay = (
		cb: (event: DashboardProgressEvent) => void,
	) => {
		for (const cached of args.bus.cachedPhases.values()) cb(cached);
		if (args.bus.cachedCurrentItem.text) {
			cb({
				explorationId: "",
				sessionId: "__kickoff__",
				phase: "digesting",
				detail: args.bus.cachedCurrentItem.text,
			});
		}
		return args.bus.subscribe(cb);
	};

	const app = (
		<DashboardApp
			projectPath={args.projectPath}
			targetPath={args.targetPath}
			entries={args.entries}
			runCount={args.runCount}
			modelLabel={args.modelLabel}
			concurrency={args.concurrency}
			startupConfirm={args.startupConfirm}
			onExit={(i) => {
				intent = i;
			}}
			onLaunchExtraction={args.onLaunchExtraction}
			subscribeToExtractionEvents={subscribeAndReplay}
			subscribeToTitleUpdates={args.bus.subscribeToTitles}
			initialTitles={args.bus.liveTitles}
			preSelectSessionId={args.preSelectSessionId}
			returnToCaller={args.returnToCaller}
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
	/** When true, ignore on-disk digests so determineScope picks every row up. */
	force?: boolean;
}): Promise<void> {
	const { projectPath, entries, model, concurrency, emit, force = false } =
		args;
	const { ExtractionEngine } = await import(
		"@umwelten/core/interaction/analysis/extraction-engine.js"
	);
	const projectName = projectPath.split("/").slice(-2).join("/");

	// Build ExtractionInputs from entries. We always include the source on the
	// SessionIndexEntry so the digester can branch to the adapter for pi /
	// cursor / habitat sessions. Claude-code sessions additionally need a
	// resolved fullPath since they go through the legacy file parser.
	const inputs = entries
		.filter((e) => e.sourceSession.source !== "claude-code" || e.filePath)
		.map((e) => ({
			explorationId: e.exploration.id,
			sessionId: e.sourceSession.id,
			modified: e.sourceSession.modified,
			source: e.sourceSession.source,
			sessionEntry: {
				sessionId: e.sourceSession.id,
				fullPath: e.filePath,
				fileMtime: e.modifiedMs,
				firstPrompt: e.exploration.name,
				messageCount: e.sourceSession.messageCount,
				created: e.sourceSession.created,
				modified: e.sourceSession.modified,
				gitBranch: e.sourceSession.gitBranch ?? "",
				projectPath,
				isSidechain: false,
				source: e.sourceSession.source,
			},
		}));

	// Load existing digests so the engine can detect scope correctly. When
	// --force is set, hand the engine an empty map so every row counts as
	// undigested and gets re-processed.
	const digestInfos = new Map<
		string,
		{ digestedAt: string; schemaVersion?: number }
	>();
	if (!force) {
		await Promise.all(
			entries.map(async (e) => {
				const d = await loadDigest(projectPath, e.sourceSession.id);
				if (d?.digestedAt) {
					digestInfos.set(e.sourceSession.id, { digestedAt: d.digestedAt });
				}
			}),
		);
	}

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
): Promise<BrowseTuiOutcome> {
	const {
		projectPath: rawProject,
		targetPath: rawTarget,
		sessionsDir,
		model,
		force = false,
		preSelectSessionId,
		returnToCaller = false,
	} = opts;
	const projectPath = resolve(rawProject);
	const targetPath = resolve(rawTarget);

	// Per-CLI-invocation state. We only ask "extract?" once; once the user
	// has answered, subsequent loop iterations remount the dashboard without
	// the overlay. `extractionLaunched` gates a second pass — if one is
	// already in flight from this session, don't kick another.
	let askedAtLeastOnce = false;
	let extractionLaunched = false;
	// preSelectSessionId is consumed on the first iteration only; subsequent
	// remounts (after detail/transcript views) start at the top.
	let pendingPreSelect: string | undefined = preSelectSessionId;

	// Long-lived bus: extraction runs in the background and emits into this
	// bus regardless of which TUI is on screen. Cached phases let a freshly
	// remounted dashboard backfill the table.
	const bus = createExtractionBus(projectPath);

	while (true) {
		const { entries, runs } = await buildExploreBrowse({
			projectPath,
			sessionsDir,
		});

		if (entries.length === 0) {
			console.log(chalk.yellow("No explorations found for this project."));
			console.log(chalk.dim(`Project: ${projectPath}`));
			if (sessionsDir) console.log(chalk.dim(`Sessions dir: ${sessionsDir}`));
			return "exit";
		}

		const modelLabel = `${model.provider}:${model.name}`;
		const intent = await showDashboardTui({
			projectPath,
			targetPath,
			entries,
			runCount: runs.length,
			modelLabel,
			concurrency: 1,
			startupConfirm: !askedAtLeastOnce,
			bus,
			preSelectSessionId: pendingPreSelect,
			returnToCaller,
			onLaunchExtraction: () => {
				askedAtLeastOnce = true;
				if (extractionLaunched) {
					bus.emit({
						explorationId: "",
						sessionId: "__kickoff__",
						phase: "digesting",
						detail: "Extraction already in progress in this session.",
					});
					return;
				}
				extractionLaunched = true;
				// Fire and forget — events flow back through the bus.
				void runExtractionPass({
					projectPath,
					entries,
					model,
					concurrency: 1,
					emit: bus.emit,
					force,
				});
			},
		});

		askedAtLeastOnce = true;
		// preSelect is a first-mount-only signal; clear so subsequent
		// re-mounts (after detail/transcript views) don't keep snapping the
		// cursor back to the same row.
		pendingPreSelect = undefined;

		if (intent.kind === "none") return "exit";
		if (intent.kind === "return") return "return";

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
