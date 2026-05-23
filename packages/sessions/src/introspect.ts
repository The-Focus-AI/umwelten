/**
 * Session browser CLI.
 *
 * `umwelten browse` (top-level) and `umwelten introspect browse` (alias)
 * both open the session-first TUI in `src/ui/tui/introspect/`. The old
 * "introspect as a distinct LLM pipeline" concept is gone — everything
 * LLM-powered routes through the digester in `src/interaction/analysis/`.
 */

import { Command } from "commander";
import { cwd } from "node:process";
import { resolve, join } from "node:path";
import { stat } from "node:fs/promises";
import chalk from "chalk";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import { initializeAdapters } from "@umwelten/core/interaction/adapters/index.js";
import type { AdapterRegistry } from "@umwelten/core/interaction/adapters/adapter.js";
import {
	projectSessions,
	type ProjectionResult,
} from "@umwelten/core/interaction/projection/index.js";

/**
 * Options for loading the browse projection.
 *
 * The optional `registry` lets tests pass an isolated AdapterRegistry; in
 * production callers omit it and the global registry is used (initialized
 * via initializeAdapters).
 */
export interface LoadBrowseProjectionOptions {
	projectPath: string;
	registry?: AdapterRegistry;
}

/**
 * Initialize adapters (when using the global registry) and project every
 * discovered Source Session into an Exploration.
 *
 * This is the contract behind `pnpm run cli browse -p <project>` — sessions
 * from every registered adapter (claude-code, pi, cursor, plus any
 * dynamically-registered habitat adapter) must be discoverable here before
 * the dashboard mounts.
 */
export async function loadBrowseProjection(
	opts: LoadBrowseProjectionOptions,
): Promise<ProjectionResult> {
	if (!opts.registry) {
		initializeAdapters();
	}
	return projectSessions(opts.projectPath, { registry: opts.registry });
}

interface BrowseOptions {
	project: string;
	target?: string;
	sessionsDir?: string;
	model: string;
}

function parseModel(spec: string): ModelDetails {
	const idx = spec.indexOf(":");
	if (idx < 0)
		throw new Error(`Invalid --model: ${spec} (expected "provider:name")`);
	return { provider: spec.slice(0, idx), name: spec.slice(idx + 1) };
}

/**
 * Resolve the primary memory-file target. Prefers explicit --target, falls back
 * to <project>/CLAUDE.md (or AGENTS.md if that's what the project uses).
 */
async function resolveTarget(
	targetPath: string | undefined,
	projectPath: string,
): Promise<{ primaryTarget: string }> {
	if (targetPath) return { primaryTarget: resolve(targetPath) };
	const claudeMd = join(projectPath, "CLAUDE.md");
	const agentsMd = join(projectPath, "AGENTS.md");
	try {
		await stat(claudeMd);
		return { primaryTarget: claudeMd };
	} catch {
		// fall through
	}
	try {
		await stat(agentsMd);
		return { primaryTarget: agentsMd };
	} catch {
		// default to CLAUDE.md even if missing — callers create it when writing
		return { primaryTarget: claudeMd };
	}
}

export async function runBrowseAction(options: BrowseOptions): Promise<void> {
	try {
		const projectPath = resolve(options.project);
		const { primaryTarget } = await resolveTarget(options.target, projectPath);
		const model = parseModel(options.model);
		// Touch every adapter source via loadBrowseProjection so initialization
		// happens before the TUI mounts. The returned projection is recomputed
		// inside runExploreBrowseTui via buildExploreBrowse — calling it here
		// surfaces adapter errors (missing dirs, malformed sessions) on stderr
		// before the alt-screen takes over.
		await loadBrowseProjection({ projectPath });
		const { runExploreBrowseTui } = await import(
			"@umwelten/ui/tui/introspect/browse.js"
		);
		await runExploreBrowseTui({
			projectPath,
			targetPath: primaryTarget,
			sessionsDir: options.sessionsDir
				? resolve(options.sessionsDir)
				: undefined,
			model,
		});
	} catch (err) {
		console.error(
			chalk.red("Error:"),
			err instanceof Error ? err.message : err,
		);
		process.exit(1);
	}
}

function registerBrowseOptions(cmd: Command): Command {
	return cmd
		.description(
			"Browse every session with its digest (topics, learnings, phases, facts) and actions. Default 30d; press 4 for all.",
		)
		.option("-p, --project <path>", "Project path", cwd())
		.option("--target <path>", "Memory file (default: CLAUDE.md)")
		.option(
			"--sessions-dir <path>",
			"Habitat sessions directory (each subdir contains transcript.jsonl)",
		)
		.option(
			"-m, --model <spec>",
			"Model for digest / analysis (provider:name)",
			"google:gemini-3-flash-preview",
		);
}

/** `umwelten introspect browse` — namespaced alias. */
export const introspectCommand = new Command("introspect").description(
	"Session analysis tools. `umwelten introspect browse` is an alias for `umwelten browse`.",
);
registerBrowseOptions(introspectCommand.command("browse")).action(
	runBrowseAction,
);

/** `umwelten browse` — top-level, primary entry. */
export const browseCommand = registerBrowseOptions(
	new Command("browse"),
).action(runBrowseAction);
