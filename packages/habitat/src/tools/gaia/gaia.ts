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
import { DockerManager, resolveChildAddress } from "./docker.js";
import { CredentialCatalog } from "./credential-catalog.js";
import { CredentialAuditLogger } from "./credential-audit.js";
import { createGaiaToolSet } from "./gaia-tools.js";
import { handleGaiaRoute } from "./routes.js";
import { startIdleReaper, resolveReaperConfig } from "./reaper.js";
import { FnoxResolver } from "./fnox.js";
import { resolveGithubAppConfig } from "./github/app-config.js";
import { createGithubTokenService } from "./github/token-service.js";
import { createGithubAdministration } from "./github/admin.js";
import { HabitatWaker } from "./waker.js";
import { PreviewControl } from "./preview-control.js";
import { startHabitatContainer } from "./gaia-tools/habitats.js";
import { postToContainer } from "./proxy.js";
import {
	createStorageTokenService,
	resolveStorageRelayConfig,
} from "./storage/token-service.js";
import { sampleHostResources } from "./host-resources.js";
import { GaiaOperations, telemetrySchema } from "./operations.js";
import { announceHabitat, resolveSaasRegistryConfig } from "./saas-registry.js";
import { fetchOperationsJson } from "../../operational-telemetry.js";

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
		const provider = options.provider ?? "mycel";
		const model = options.model ?? "default";

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

		// GitHub App token minting (ADR 0004). The private key stays in its own
		// file (GITHUB_APP_PRIVATE_KEY_FILE), read at mint time — never loaded
		// into the vault or config. Unconfigured ⇒ a disabled service: mints
		// return null, the token route answers 501, boot injection is skipped.
		const githubAppConfig = resolveGithubAppConfig(process.env);
		const githubTokens = createGithubTokenService(githubAppConfig);
		const githubAdministration = createGithubAdministration(process.env);
		if (githubAppConfig) {
			console.log(
				`[gaia] GitHub App configured (app ${githubAppConfig.appId}, installation ${githubAppConfig.installationId}) — scoped token minting enabled`,
			);
		}

		// Backing-storage token relay (habitats ADR 0005). Unconfigured ⇒ a
		// disabled service: the /storage/token route answers 501.
		const storageRelayConfig = resolveStorageRelayConfig(process.env);
		const storageTokens = createStorageTokenService(storageRelayConfig);
		if (storageRelayConfig) {
			console.log(
				`[gaia] Storage token relay configured (${storageRelayConfig.tokenUrl}) — backing-storage tokens enabled`,
			);
		}

		const operations = new GaiaOperations({
			file: pathResolve(dataDir, "operations.json"),
			listEntries: () => registry.list(),
			getStatus: (id) => docker.getStatus(id),
			getHealthStatus: (id) => docker.getHealthStatus(id),
			resources: () => sampleHostResources({ diskPath: dataDir }),
			telemetry: async (entry) => {
				const address = resolveChildAddress(entry);
				return telemetrySchema.parse(await fetchOperationsJson(`http://${address.hostname}:${address.port}/internal/operations/telemetry`, entry.apiKey));
			},
			registryConfig: () => resolveSaasRegistryConfig(),
			announce: (entry, config) => announceHabitat(entry, config, { fetch: globalThis.fetch, timeoutMs: 3_000 }),
			recoveryEnabled: process.env.GAIA_AUTO_RECOVERY === "1",
			restart: (id) => docker.restartUnhealthyContainer(id),
			log: (message) => console.warn(message),
		});
		let operationsReady = false;
		try { await operations.load(); operationsReady = true; }
		catch { console.error("[operations] Cannot read durable state; monitoring and recovery disabled. Restore operations.json before restarting Gaia."); }
		const toolsContext = {
			operations: operationsReady ? operations : undefined,
			registry,
			vault,
			docker,
			catalog,
			audit,
			githubTokens,
			githubAdministration,
			gaiaDataDir: dataDir,
			gaiaProvider: provider,
			gaiaModel: model,
			gaiaConfig,
		};
		const gaiaToolSet = createGaiaToolSet(toolsContext);
		const waker = new HabitatWaker({
			getEntry: (id) => registry.get(id),
			getStatus: (id) => docker.getStatus(id),
			start: (id) => startHabitatContainer(toolsContext, id),
		});
		const previewControl = new PreviewControl({
			registry,
			waker,
			audit,
			wakeKey: process.env.GAIA_PREVIEW_WAKE_KEY,
			activityKey: process.env.GAIA_PREVIEW_ACTIVITY_KEY,
			touchHabitat: async (id, worktreeId) => {
				const entry = registry.get(id);
				if (!entry?.containerPort) return;
				await postToContainer(
					entry,
					`/internal/preview-activity/${encodeURIComponent(worktreeId)}`,
				);
			},
		});

		const habitat = await Habitat.create({
			workDir: dataDir,
			sessionsDir: pathResolve(dataDir, "sessions"),
			envPrefix: "HABITAT",
			toolSets: [...containerToolSets, gaiaToolSet],
		});
		habitat.setRuntimeModelDetails({ provider, name: model });

		const routeCtx = {
			...toolsContext,
			storageTokens,
			previewControl,
			hostResources: async () => {
				try {
					return await sampleHostResources({ diskPath: dataDir });
				} catch (error) {
					return {
						error: error instanceof Error ? error.message : String(error),
					};
				}
			},
		};
		const server = await startContainerServer({
			habitat,
			port,
			host,
			name: "Gaia Orchestrator",
			// Gaia's dashboard is an assembly (#408): the fleet panel rides the
			// standard shell as a host-contributed entry, and from there mounts
			// each running habitat's status as a foreign component.
			shellEntries: [
				{ id: "habitats", url: "./components/habitats.js" },
				{ id: "operations", url: "./components/operations.js" },
			],
			extraRawHandler: (req, res) => handleGaiaRoute(routeCtx, req, res),
			statusDetails: async () => ({
				hostResources: await routeCtx.hostResources(),
			}),
		});

		// ── Idle reaper (#278) ────────────────────────────────────────────
		// The runtime plane is one 16 GB host with no swap; a fleet that is
		// mostly asleep is the only shape that fits. Habitats holding work in
		// flight are never stopped — see reaper.ts.
		const reaper = startIdleReaper({
			registry,
			docker,
			config: resolveReaperConfig(process.env),
		});
		// One health/recovery owner; do not run the old restart loop alongside it.
		if (operationsReady) operations.start();

		if (!options.noSignalHandlers) {
			const shutdown = async () => {
				console.log("\n[container] Shutting down...");
				reaper.stop();
				await operations.stop().catch(() => {});
				server.close();
				process.exit(0);
			};
			process.on("SIGINT", shutdown);
			process.on("SIGTERM", shutdown);
		}

		return { server, habitat, dataDir };
	}
}
