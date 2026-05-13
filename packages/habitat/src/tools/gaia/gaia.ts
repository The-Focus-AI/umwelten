/**
 * Gaia — habitat-orchestrator factory.
 *
 * `Gaia.start()` owns end-to-end boot of the orchestrator:
 *   - data dir + fnox bootstrap + secret resolution
 *   - default STIMULUS.md / config.json from templates
 *   - registry / vault / docker / catalog / audit instantiation
 *   - Habitat.create with container + Gaia tools
 *   - container HTTP server with Gaia routes
 *   - SIGINT/SIGTERM teardown
 *
 * The CLI / web entry just calls `Gaia.start({...})`.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Habitat } from "../../habitat.js";
import { fileExists, loadConfig } from "../../config.js";
import { containerToolSets } from "../../tool-sets.js";
import {
	startContainerServer,
	type StartedContainerServer,
} from "../../container-server.js";
import { GaiaRegistryManager } from "./registry.js";
import { GaiaSecretVault } from "./secrets.js";
import { DockerManager } from "./docker.js";
import { CredentialCatalog } from "./credential-catalog.js";
import { CredentialAuditLogger } from "./credential-audit.js";
import { createGaiaToolSet } from "./gaia-tools.js";
import { handleGaiaRoute } from "./routes.js";
import { FnoxResolver } from "./fnox.js";

export interface GaiaStartOptions {
	dataDir: string;
	port?: number;
	host?: string;
	provider?: string;
	model?: string;
	/** Disable SIGINT/SIGTERM auto-handlers (useful for embedding). */
	noSignalHandlers?: boolean;
}

export interface StartedGaia {
	server: StartedContainerServer;
	habitat: Habitat;
	dataDir: string;
}

/**
 * Resolve the templates directory shipped with the habitat package.
 * Templates live at `packages/habitat/templates/` (one level up from `src/`).
 */
function templatesDir(): string {
	const here = fileURLToPath(import.meta.url);
	// here = .../packages/habitat/src/tools/gaia/gaia.ts
	return pathResolve(here, "..", "..", "..", "..", "templates");
}

async function readTemplate(
	name: string,
	vars: Record<string, string>,
): Promise<string> {
	const raw = await readFile(pathResolve(templatesDir(), name), "utf-8");
	return raw.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

export class Gaia {
	static async start(options: GaiaStartOptions): Promise<StartedGaia> {
		const dataDir = pathResolve(options.dataDir);
		const port = options.port ?? 7420;
		const host = options.host ?? "0.0.0.0";
		const provider = options.provider ?? "google";
		const model = options.model ?? "gemini-3-flash-preview";

		await mkdir(dataDir, { recursive: true });

		// ── fnox bootstrap ────────────────────────────────────────────────
		const fnox = new FnoxResolver(dataDir);
		const templateWritten = await fnox.writeTemplateIfMissing();
		if (templateWritten) {
			console.log(`[gaia] Wrote fnox.toml template to ${fnox.configPath}`);
		}
		const fnoxResult = await fnox.resolve();
		switch (fnoxResult.mode) {
			case "fnox":
				console.log(
					`[gaia] Secrets resolved via fnox (${Object.keys(fnoxResult.secrets).length} secrets)`,
				);
				if (fnoxResult.bootstrapToken) {
					console.log(
						`[gaia] Bootstrap token: ${fnoxResult.bootstrapToken.envVar} → ${fnoxResult.bootstrapToken.provider}`,
					);
				}
				break;
			case "env":
				console.log(
					`[gaia] Secrets loaded from environment (${Object.keys(fnoxResult.secrets).length} secrets)`,
				);
				if (!(await fnox.isAvailable()) && fnox.hasConfig()) {
					console.log(
						"[gaia] Tip: install fnox to resolve secrets from fnox.toml (https://fnox.jdx.dev)",
					);
				}
				break;
			case "none":
				console.log(
					"[gaia] No secrets found. Set API keys via environment or configure fnox.toml.",
				);
				break;
		}
		for (const warning of fnoxResult.warnings) {
			console.warn(`[gaia] ${warning}`);
		}

		// ── default STIMULUS.md / config.json from templates ──────────────
		const stimulusPath = pathResolve(dataDir, "STIMULUS.md");
		if (!(await fileExists(stimulusPath))) {
			await writeFile(
				stimulusPath,
				await readTemplate("gaia-stimulus.md", { provider, model }),
			);
		}
		const configPath = pathResolve(dataDir, "config.json");
		if (!(await fileExists(configPath))) {
			await writeFile(
				configPath,
				await readTemplate("gaia-config.json", { provider, model }),
			);
		}
		const gaiaConfig = await loadConfig(configPath);

		// ── Gaia components ───────────────────────────────────────────────
		const registry = new GaiaRegistryManager(dataDir);
		await registry.load();
		const vault = new GaiaSecretVault(dataDir);
		await vault.load();
		for (const [name, value] of Object.entries(fnoxResult.secrets)) {
			if (!vault.get(name)) {
				await vault.set(name, value);
			}
		}

		// projectRoot = repo root, used by docker for build context
		const projectRoot = pathResolve(
			fileURLToPath(import.meta.url),
			"..",
			"..",
			"..",
			"..",
			"..",
			"..",
		);
		const docker = new DockerManager(dataDir, projectRoot);
		await docker.ensureNetwork().catch(() => {});

		const catalog = new CredentialCatalog(dataDir);
		await catalog.load();
		const audit = new CredentialAuditLogger(dataDir);

		const gaiaToolSet = createGaiaToolSet({
			registry,
			vault,
			docker,
			catalog,
			audit,
			gaiaDataDir: dataDir,
			gaiaProvider: provider,
			gaiaModel: model,
			gaiaConfig,
		});

		const habitat = await Habitat.create({
			workDir: dataDir,
			sessionsDir: pathResolve(dataDir, "sessions"),
			envPrefix: "HABITAT",
			toolSets: [...containerToolSets, gaiaToolSet],
		});
		habitat.setRuntimeModelDetails({ provider, name: model });

		const routeCtx = { registry, vault, docker, catalog, audit };
		const server = await startContainerServer({
			habitat,
			port,
			host,
			name: "Gaia Orchestrator",
			extraRawHandler: (req, res) => handleGaiaRoute(routeCtx, req, res),
		});

		if (!options.noSignalHandlers) {
			const shutdown = () => {
				console.log("\n[container] Shutting down...");
				server.close();
				process.exit(0);
			};
			process.on("SIGINT", shutdown);
			process.on("SIGTERM", shutdown);
		}

		return { server, habitat, dataDir };
	}
}
