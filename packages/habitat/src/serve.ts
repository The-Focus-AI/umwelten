/**
 * `serveHabitat` — boot a Habitat and start the appropriate HTTP server.
 *
 * Modes:
 *   - "standalone": container server (MCP + chat + web UI), full toolset (default)
 *   - "managed":    container server, managed-toolset (no secrets — Gaia owns them)
 *   - "mcp-only":   MCP-local server only (no chat, no web UI)
 *
 * If `mode` is omitted, it is inferred from `HABITAT_API_KEY`:
 *   - set     → "managed"
 *   - unset   → "standalone"
 *
 * `allTools` overrides the toolset selection and uses the full standard set.
 */

import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import { Habitat } from "./habitat.js";
import {
	standardToolSets,
	containerToolSets,
	managedContainerToolSets,
	type ToolSet,
} from "./tool-sets.js";

export type ServeMode = "standalone" | "managed" | "mcp-only";

export interface ServeOptions {
	workDir?: string;
	sessionsDir?: string;
	envPrefix?: string;
	defaultWorkDirName?: string;
	port?: number;
	host?: string;
	mode?: ServeMode;
	allTools?: boolean;
	model?: ModelDetails;
	skipOnboard?: boolean;
	/** Disable SIGINT/SIGTERM handlers (useful for embedding/tests). */
	noSignalHandlers?: boolean;
}

export interface ServedHabitat {
	habitat: Habitat;
	close(): Promise<void> | void;
	mode: ServeMode;
	port: number;
	host: string;
}

function pickToolSets(
	mode: ServeMode,
	allTools: boolean | undefined,
): ToolSet[] | undefined {
	if (allTools) return standardToolSets;
	if (mode === "managed") return managedContainerToolSets;
	if (mode === "standalone") return containerToolSets;
	// mcp-only: default tool sets
	return undefined;
}

export async function serveHabitat(
	options: ServeOptions,
): Promise<ServedHabitat> {
	const mode: ServeMode =
		options.mode ?? (process.env.HABITAT_API_KEY ? "managed" : "standalone");
	const port = options.port ?? (mode === "mcp-only" ? 7430 : 7430);
	const host = options.host ?? "0.0.0.0";

	const habitat = await Habitat.create({
		workDir: options.workDir,
		sessionsDir: options.sessionsDir,
		envPrefix: options.envPrefix ?? "HABITAT",
		defaultWorkDirName: options.defaultWorkDirName ?? "habitats",
		toolSets: pickToolSets(mode, options.allTools),
	});

	if (!options.skipOnboard && !(await habitat.isOnboarded())) {
		console.log("[habitat] Work directory not set up. Running onboarding...");
		const result = await habitat.onboard();
		if (result.created.length > 0)
			console.log("[habitat] Created:", result.created.join(", "));
		console.log(`[habitat] Work directory: ${result.workDir}`);
	}

	if (options.model) {
		habitat.setRuntimeModelDetails(options.model);
	}

	const name = habitat.getConfig().name ?? (mode === "mcp-only" ? "habitat-mcp" : "habitat");

	let close: () => void;
	if (mode === "mcp-only") {
		const { startHabitatMcpServer } = await import("./mcp-local-server.js");
		const server = await startHabitatMcpServer({ habitat, port, host, name });
		close = () => server.close();
	} else {
		const { startContainerServer } = await import("./container-server.js");
		const server = await startContainerServer({ habitat, port, host, name });
		close = () => server.close();
	}

	if (!options.noSignalHandlers) {
		const tag = mode === "mcp-only" ? "habitat-mcp" : "container";
		const shutdown = () => {
			console.log(`\n[${tag}] Shutting down...`);
			close();
			process.exit(0);
		};
		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);
	}

	return { habitat, close, mode, port, host };
}
