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
import { resolveProjectDir } from "./config.js";
import { Habitat } from "./habitat.js";
import { PreviewSupervisor } from "./preview/supervisor.js";
import { createPreviewTools } from "./tools/preview-tools.js";
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

const SENSITIVE_ENV_NAME = /(API_KEY|CREDENTIAL|PASSWORD|PRIVATE_KEY|SECRET|TOKEN)/i;

function previewSecrets(habitat: Habitat): string[] {
	const values = habitat
		.listSecretNames()
		.map((name) => habitat.getSecret(name))
		.filter((value): value is string => value !== undefined);
	for (const [name, value] of Object.entries(process.env)) {
		if (value && SENSITIVE_ENV_NAME.test(name)) values.push(value);
	}
	return [...new Set(values)];
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
	const config = habitat.getConfig();
	const previewSuffix = process.env.HABITAT_PREVIEW_SUFFIX;
	let previewSupervisor: PreviewSupervisor | undefined;
	if (mode !== "mcp-only" && config.gitUrl && previewSuffix) {
		previewSupervisor = new PreviewSupervisor({
			projectDir: resolveProjectDir(habitat.getWorkDir(), config),
			projectId: process.env.HABITAT_ID ?? name,
			branch: config.gitBranch ?? "main",
			previewSuffix,
			domain: process.env.HABITAT_PREVIEW_DOMAIN,
			secrets: previewSecrets(habitat),
		});
		habitat.addTools(createPreviewTools(previewSupervisor));
		previewSupervisor.start();
	}

	let closeServer: () => void;
	if (mode === "mcp-only") {
		const { startHabitatMcpServer } = await import("./mcp-local-server.js");
		const server = await startHabitatMcpServer({ habitat, port, host, name });
		closeServer = () => server.close();
	} else {
		const { startContainerServer } = await import("./container-server.js");
		try {
			const server = await startContainerServer({ habitat, port, host, name });
			closeServer = () => server.close();
		} catch (error) {
			await previewSupervisor?.stop();
			throw error;
		}
	}
	const close = async () => {
		await previewSupervisor?.stop();
		closeServer();
	};

	if (!options.noSignalHandlers) {
		const tag = mode === "mcp-only" ? "habitat-mcp" : "container";
		const shutdown = async () => {
			console.log(`\n[${tag}] Shutting down...`);
			await close();
			process.exit(0);
		};
		process.on("SIGINT", () => void shutdown());
		process.on("SIGTERM", () => void shutdown());
	}

	return { habitat, close, mode, port, host };
}
