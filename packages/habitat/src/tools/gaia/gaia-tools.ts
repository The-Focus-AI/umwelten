/**
 * Gaia Orchestrator ToolSet — AI SDK tools for orchestrating habitats,
 * wrapped as a ToolSet for registration on a Habitat.
 */

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import type { ToolSet } from "../../tool-sets.js";

const execFileAsync = promisify(execFile);
import type { GaiaHabitatEntry } from "./types.js";
import type { GaiaRegistryManager } from "./registry.js";
import type { GaiaSecretVault } from "./secrets.js";
import type { DockerManager } from "./docker.js";
import type { CredentialCatalog } from "./credential-catalog.js";
import { CapabilityResolver } from "./capability-resolver.js";
import {
	type CredentialAuditLogger,
	credentialEntry,
	bindingEntry,
} from "./credential-audit.js";
import {
	fetchAgentCard,
	sendA2AMessage,
	type A2AEndpoint,
	type AgentCardSummary,
} from "@umwelten/protocols";
import {
	seedOrgReadonly,
	seedStandardsAgent,
	STANDARDS_AGENT_ID,
} from "./gaia-seed.js";

export const STANDARDS_AUDIT_MSG =
	"Pull the latest standards from the standards agent at /data/agents/standards/repo. Review the current best-practices against this habitat's own project and configuration. Return a structured findings report with: compliant items, non-compliant items with severity, and suggested remediations.";

/** Result for a single habitat in a standards audit. */
export interface AuditResult {
	habitatId: string;
	name: string;
	status: "responded" | "unresponsive" | "skipped";
	findings?: string;
	error?: string;
}

/** Summary of a standards audit run. */
export interface AuditSummary {
	timestamp: string;
	total: number;
	passed: number;
	findings: number;
	unresponsive: number;
	skipped: number;
	results: AuditResult[];
}

/** Adapt a Gaia registry entry to a generic A2A endpoint. */
export function entryToEndpoint(entry: GaiaHabitatEntry): A2AEndpoint {
	if (!entry.containerPort) {
		throw new Error(`Container ${entry.id} not running`);
	}
	return {
		host: "127.0.0.1",
		port: entry.containerPort,
		apiKey: entry.apiKey,
		label: entry.id,
	};
}

/** Fetch agent cards from all running habitats; failures are reported per-entry. */
async function discoverHabitats(
	entries: GaiaHabitatEntry[],
): Promise<
	Array<{ id: string; card: AgentCardSummary } | { id: string; error: string }>
> {
	const running = entries.filter((e) => e.containerPort);
	const results = await Promise.allSettled(
		running.map(async (entry) => {
			const card = await fetchAgentCard(entryToEndpoint(entry));
			return { id: entry.id, card };
		}),
	);

	return results.map((r, i) =>
		r.status === "fulfilled"
			? r.value
			: { id: running[i].id, error: r.reason?.message ?? "Unknown error" },
	);
}

export interface GaiaToolsContext {
	registry: GaiaRegistryManager;
	vault: GaiaSecretVault;
	docker: DockerManager;
	catalog: CredentialCatalog;
	audit: CredentialAuditLogger;
	/** Gaia's own data directory (where config.json lives). */
	gaiaDataDir: string;
	/** Gaia's provider (for defaulting child habitats). */
	gaiaProvider?: string;
	/** Gaia's model (for defaulting child habitats). */
	gaiaModel?: string;
	/** Gaia's own config (from Gaia data-dir config.json). */
	gaiaConfig?: Pick<
		import("../../types.js").HabitatConfig,
		"standardsRepoUrl" | "standardsRepoBranch"
	>;
}

/** Build the seed files (config.json + secrets.json) for a habitat volume.
 *
 * Skills are NOT seeded as a lock file here — the container entrypoint
 * installs them via `npx skills add` at boot, which generates a proper
 * skills-lock.json with correct skill paths and hashes.
 *
 * If `catalog` is provided and the habitat config has capability bindings,
 * they are resolved into secret values from the master vault and merged
 * into secrets.json alongside direct secretBindings.
 */
export function buildSeedFiles(
	entry: GaiaHabitatEntry,
	vault: GaiaSecretVault,
	catalog?: CredentialCatalog,
): Array<{ path: string; content: string }> {
	const filtered: Record<string, string> = {};

	// Direct secret bindings
	for (const name of entry.secretBindings) {
		const val = vault.get(name);
		if (val) filtered[name] = val;
	}

	// Capability-resolved secrets
	if (catalog && entry.config.capabilities?.length) {
		const resolver = new CapabilityResolver();
		const result = resolver.resolve(entry.config.capabilities, catalog, vault);
		Object.assign(filtered, result.envVars);
		// Warnings are logged by the caller when they surface through tool output
	}

	return [
		{
			path: "config.json",
			content: JSON.stringify(entry.config, null, 2) + "\n",
		},
		{ path: "secrets.json", content: JSON.stringify(filtered, null, 2) + "\n" },
	];
}

/** Minimal context needed to run a standards audit. */
export interface StandardsAuditContext {
	registry: GaiaRegistryManager;
	docker: DockerManager;
}

/**
 * Run a standards audit across habitats with standards agents.
 * Used both by the broadcast_standards tool and the REST API.
 */
export async function runStandardsAudit(
	ctx: StandardsAuditContext,
	options?: { habitatId?: string },
): Promise<AuditSummary> {
	const PER_HABITAT_TIMEOUT_MS = 60_000;
	const { registry, docker } = ctx;

	const entries = registry.list();
	const targets = options?.habitatId
		? entries.filter((e) => e.id === options.habitatId)
		: entries;

	if (targets.length === 0) {
		return {
			timestamp: new Date().toISOString(),
			total: 0,
			passed: 0,
			findings: 0,
			unresponsive: 0,
			skipped: 0,
			results: [],
		};
	}

	const auditTargets: GaiaHabitatEntry[] = [];
	const skipped: AuditResult[] = [];

	for (const entry of targets) {
		const hasStandards =
			entry.config.agents?.some((a) => a.id === STANDARDS_AGENT_ID) ?? false;
		const isRunning =
			entry.containerPort != null &&
			(await docker.getStatus(entry.id)) === "running";

		if (!isRunning) {
			skipped.push({
				habitatId: entry.id,
				name: entry.name,
				status: "skipped",
				error: `Habitat "${entry.id}" is not running — skipped.`,
			});
			continue;
		}
		if (!hasStandards) {
			skipped.push({
				habitatId: entry.id,
				name: entry.name,
				status: "skipped",
				error: `Habitat "${entry.id}" has no standards agent — skipped.`,
			});
			continue;
		}
		auditTargets.push(entry);
	}

	if (auditTargets.length === 0) {
		return {
			timestamp: new Date().toISOString(),
			total: skipped.length,
			passed: 0,
			findings: 0,
			unresponsive: 0,
			skipped: skipped.length,
			results: skipped,
		};
	}

	const results = await Promise.allSettled(
		auditTargets.map(async (entry) => {
			try {
				const result = await Promise.race([
					sendA2AMessage(entryToEndpoint(entry), STANDARDS_AUDIT_MSG),
					new Promise<never>((_, reject) =>
						setTimeout(
							() => reject(new Error("timeout")),
							PER_HABITAT_TIMEOUT_MS,
						),
					),
				]);
				return {
					habitatId: entry.id,
					name: entry.name,
					status: "responded" as const,
					findings: result.text,
				};
			} catch (err: any) {
				const reason =
					err.message === "timeout"
						? `Timed out after ${PER_HABITAT_TIMEOUT_MS / 1000}s`
						: err.message;
				return {
					habitatId: entry.id,
					name: entry.name,
					status: "unresponsive" as const,
					error: reason,
				};
			}
		}),
	);

	const allResults: AuditResult[] = results.map((r) =>
		r.status === "fulfilled"
			? r.value
			: {
					habitatId: "unknown",
					name: "unknown",
					status: "unresponsive" as const,
					error: r.reason?.message ?? "Unknown error",
				},
	);

	const responded = allResults.filter((r) => r.status === "responded");
	const unresponsive = allResults.filter((r) => r.status === "unresponsive");

	return {
		timestamp: new Date().toISOString(),
		total: allResults.length + skipped.length,
		passed: responded.filter(
			(r) => r.findings && !/non-compliant|violation|finding/i.test(r.findings),
		).length,
		findings: responded.filter(
			(r) => r.findings && /non-compliant|violation|finding/i.test(r.findings),
		).length,
		unresponsive: unresponsive.length,
		skipped: skipped.length,
		results: [...allResults, ...skipped],
	};
}

function createGaiaTools(ctx: GaiaToolsContext): Record<string, Tool> {
	const {
		registry,
		vault,
		docker,
		catalog,
		audit,
		gaiaDataDir,
		gaiaProvider,
		gaiaModel,
		gaiaConfig,
	} = ctx;

	return {
		list_habitats: tool({
			description:
				"List all registered habitats with their container status. Includes the web UI URL with auth token for running habitats.",
			inputSchema: z.object({}),
			execute: async () => {
				const entries = registry.list();
				const results = await Promise.all(
					entries.map(async (entry) => {
						const status = await docker.getStatus(entry.id);
						return {
							id: entry.id,
							name: entry.name,
							provider: entry.config.defaultProvider ?? "not set",
							model: entry.config.defaultModel ?? "not set",
							status,
							port: entry.containerPort ?? null,
							url: entry.containerPort
								? `http://localhost:${entry.containerPort}/?token=${entry.apiKey}`
								: null,
							secretBindings: entry.secretBindings,
							createdAt: entry.createdAt,
						};
					}),
				);
				return JSON.stringify(results, null, 2);
			},
		}),

		create_habitat: tool({
			description: `Create a new habitat entry in the registry. Default provider: ${gaiaProvider ?? "google"}, default model: ${gaiaModel ?? "gemini-3-flash-preview"}. IMPORTANT: Always provide provider and model, and bind API key secrets. A habitat without a model or API keys cannot respond to messages.`,
			inputSchema: z.object({
				id: z.string().describe("Slug identifier (e.g. 'jeeves-bot')"),
				name: z.string().describe("Display name"),
				gitUrl: z.string().optional().describe("Git URL for provisioning"),
				gitBranch: z.string().optional().describe("Git branch (default: main)"),
				provider: z
					.string()
					.describe(
						`LLM provider (default: ${gaiaProvider ?? "google"}). Required for the habitat to work.`,
					),
				model: z
					.string()
					.describe(
						`Model name (default: ${gaiaModel ?? "gemini-3-flash-preview"}). Required for the habitat to work.`,
					),
				secretBindings: z
					.array(z.string())
					.optional()
					.describe("Secret names to bind (e.g. GOOGLE_GENERATIVE_AI_API_KEY)"),
				capabilities: z
					.array(
						z.object({
							capability: z
								.string()
								.describe("Capability name (e.g. 'github:read')"),
							credential: z.string().describe("Credential name in the catalog"),
						}),
					)
					.optional()
					.describe("Capability-to-credential bindings"),
				skillsFromGit: z
					.array(z.string())
					.optional()
					.describe(
						"Git repos for skills (e.g. 'typefully/agent-skills'). Cloned on container start.",
					),
			}),
			execute: async (params) => {
				// Validate capability bindings before creating
				if (params.capabilities?.length) {
					const resolver = new CapabilityResolver();
					for (const binding of params.capabilities) {
						resolver.validate(binding, catalog);
					}
				}

				const entry = await registry.create(params);

				// Auto-bind the org-readonly identity if Gaia's master vault has the
				// relevant tokens. Adds a scopeTemplate + a credential-only agent in
				// the new habitat's config and binds the corresponding env vars.
				const seed = seedOrgReadonly(entry.config, vault);
				if (seed.bindings.length > 0) {
					for (const name of seed.bindings) {
						if (!entry.secretBindings.includes(name))
							entry.secretBindings.push(name);
					}
				}
				const standardsSeed = seedStandardsAgent(
					entry.config,
					gaiaConfig ?? {},
				);
				if (seed.bindings.length > 0 || standardsSeed.agentAdded) {
					await registry.update(entry.id, {
						config: entry.config,
						secretBindings: entry.secretBindings,
					});
				}

				await docker.seedVolume(
					entry.id,
					buildSeedFiles(entry, vault, catalog),
				);
				const warnings: string[] = [];
				if (!entry.config.defaultProvider || !entry.config.defaultModel) {
					warnings.push(
						"WARNING: No provider/model set — the habitat cannot respond to messages.",
					);
				}
				if (entry.secretBindings.length === 0) {
					warnings.push(
						"WARNING: No secrets bound — the habitat has no API keys. Use bind_secret to add them.",
					);
				}
				const notes: string[] = [];
				if (seed.scopeAdded || seed.agentAdded) {
					notes.push(
						`Auto-seeded org-readonly identity (${seed.bindings.join(", ")}).`,
					);
				}
				if (standardsSeed.agentAdded) {
					notes.push(`Auto-seeded standards agent (${standardsSeed.repoUrl}).`);
				}
				const seedNote = notes.length > 0 ? `\n\n${notes.join("\n")}` : "";
				const msg = `Created habitat "${entry.id}" (${entry.name}). Volume: gaia-${entry.id}-data${seedNote}`;
				return warnings.length > 0 ? `${msg}\n\n${warnings.join("\n")}` : msg;
			},
		}),

		start_habitat: tool({
			description:
				"Start a habitat container. The habitat must have a provider, model, and bound API key secrets to respond to messages.",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID to start"),
			}),
			execute: async ({ id }) => {
				const entry = registry.get(id);
				if (!entry) return `Habitat "${id}" not found`;

				// Seed volume with fresh config + secrets
				await docker.seedVolume(id, buildSeedFiles(entry, vault, catalog));

				const port = await docker.startContainer(entry, "", registry.list());
				await registry.update(id, { containerPort: port });

				const warnings: string[] = [];
				if (!entry.config.defaultProvider || !entry.config.defaultModel) {
					warnings.push(
						"WARNING: No provider/model configured — the habitat cannot respond to messages.",
					);
				}
				const boundSecretCount = entry.secretBindings.filter((s) =>
					vault.get(s),
				).length;
				if (boundSecretCount === 0) {
					warnings.push(
						"WARNING: No API keys available — the habitat cannot call LLM providers.",
					);
				}
				const url = `http://localhost:${port}/?token=${entry.apiKey}`;
				const msg = `Started habitat "${id}" on port ${port}\nWeb UI: ${url}`;
				return warnings.length > 0 ? `${msg}\n\n${warnings.join("\n")}` : msg;
			},
		}),

		stop_habitat: tool({
			description: "Stop a running habitat container.",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID to stop"),
			}),
			execute: async ({ id }) => {
				const entry = registry.get(id);
				if (!entry) return `Habitat "${id}" not found`;

				await docker.stopContainer(id);
				await registry.update(id, { containerPort: undefined });
				return `Stopped habitat "${id}"`;
			},
		}),

		habitat_status: tool({
			description: "Get detailed status of a habitat container.",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID"),
			}),
			execute: async ({ id }) => {
				const entry = registry.get(id);
				if (!entry) return `Habitat "${id}" not found`;

				const containerStatus = await docker.getStatus(id);
				const result: Record<string, unknown> = {
					id: entry.id,
					name: entry.name,
					containerStatus,
					port: entry.containerPort ?? null,
					url: entry.containerPort
						? `http://localhost:${entry.containerPort}/?token=${entry.apiKey}`
						: null,
					config: entry.config,
					secretBindings: entry.secretBindings,
				};

				// If running, try to get health info
				if (containerStatus === "running" && entry.containerPort) {
					try {
						const { fetchFromContainer } = await import("./proxy.js");
						const health = await fetchFromContainer(entry, "/health");
						result.health = health;
					} catch {
						result.health = "unreachable";
					}
				}

				return JSON.stringify(result, null, 2);
			},
		}),

		habitat_logs: tool({
			description: "Get recent logs from a habitat container.",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID"),
				tail: z.number().optional().describe("Number of lines (default: 50)"),
			}),
			execute: async ({ id, tail }) => {
				return await docker.getLogs(id, tail ?? 50);
			},
		}),

		set_secret: tool({
			description: "Add or update a secret in the master vault.",
			inputSchema: z.object({
				name: z.string().describe("Secret name (env var name)"),
				value: z.string().describe("Secret value"),
			}),
			execute: async ({ name, value }) => {
				await vault.set(name, value);
				return `Secret "${name}" set in master vault.`;
			},
		}),

		list_secrets: tool({
			description: "List all secret names in the master vault (not values).",
			inputSchema: z.object({}),
			execute: async () => {
				const names = vault.listNames();
				if (names.length === 0) return "No secrets stored.";
				return `Secrets: ${names.join(", ")}`;
			},
		}),

		bind_secret: tool({
			description:
				"Bind a master secret to a habitat (add to its secretBindings).",
			inputSchema: z.object({
				habitatId: z.string(),
				secretName: z.string(),
			}),
			execute: async ({ habitatId, secretName }) => {
				const entry = registry.get(habitatId);
				if (!entry) return `Habitat "${habitatId}" not found`;
				if (!vault.listNames().includes(secretName)) {
					return `Secret "${secretName}" not in master vault`;
				}
				if (!entry.secretBindings.includes(secretName)) {
					entry.secretBindings.push(secretName);
					await registry.update(habitatId, {
						secretBindings: entry.secretBindings,
					});
				}
				return `Secret "${secretName}" bound to habitat "${habitatId}"`;
			},
		}),

		ask_habitat: tool({
			description:
				"Send a message to a running habitat via A2A and get the response.",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID"),
				message: z.string().describe("Message to send"),
			}),
			execute: async ({ id, message }) => {
				const entry = registry.get(id);
				if (!entry) return `Habitat "${id}" not found`;
				if (!entry.containerPort) return `Habitat "${id}" is not running`;

				try {
					const response = await sendA2AMessage(
						entryToEndpoint(entry),
						message,
					);
					let result = `Response from ${entry.name}:\n${response.text}`;
					if (response.artifacts?.length) {
						result +=
							"\nArtifacts: " +
							response.artifacts.map((a) => a.name ?? a.uri).join(", ");
					}
					return result;
				} catch (err: any) {
					return `Error querying ${id}: ${err.message}`;
				}
			},
		}),

		discover_habitats: tool({
			description:
				"Fetch agent cards from all running habitats to learn their capabilities.",
			inputSchema: z.object({}),
			execute: async () => {
				const entries = registry.list();
				const results = await discoverHabitats(entries);
				return JSON.stringify(results, null, 2);
			},
		}),

		search_skills: tool({
			description:
				"Search the agent skills ecosystem for skills matching a query. Runs `npx skills find <query>` and returns parsed results with skill names, install counts, and repo URLs. Use this BEFORE calling add_skill — let the user see what's available and pick one.",
			inputSchema: z.object({
				query: z
					.string()
					.describe(
						"Search query (e.g. 'web scraping', 'design', 'firecrawl')",
					),
			}),
			execute: async ({ query }) => {
				try {
					const { stdout } = await execFileAsync(
						"npx",
						["skills", "find", query, "--yes"],
						{ timeout: 30_000, env: { ...process.env, FORCE_COLOR: "0" } },
					);
					// Strip ANSI escape codes
					const clean = stdout.replace(/\x1b\[[0-9;]*m/g, "");
					// Extract skill lines: look for lines with "installs"
					const lines = clean.split("\n");
					const results: { name: string; installs: string; url: string }[] = [];
					for (let i = 0; i < lines.length; i++) {
						const line = lines[i].trim();
						const match = line.match(
							/^(.+?)\s+(\d+\.?\d*[KMB]?\s+installs?)$/i,
						);
						if (match) {
							const name = match[1].trim();
							const installs = match[2].trim();
							// next line has the URL (starts with └)
							let url = "";
							if (i + 1 < lines.length) {
								const nextLine = lines[i + 1].trim();
								const urlMatch = nextLine.match(/https?:\/\/skills\.sh\/\S+/);
								if (urlMatch) url = urlMatch[0];
							}
							results.push({ name, installs, url });
						}
					}
					if (results.length === 0) {
						return `No skills found for "${query}". Try a different query or browse https://skills.sh/.`;
					}
					return JSON.stringify(
						{
							query,
							results,
							hint: "Use add_skill with the 'owner/repo' part of the name (e.g. 'firecrawl/cli'). The '@skill' suffix is optional — omitting it installs all skills in the repo.",
						},
						null,
						2,
					);
				} catch (err: any) {
					return `Skill search failed: ${err.message}. Try browsing https://skills.sh/ directly.`;
				}
			},
		}),

		add_skill: tool({
			description:
				"Add a skill package to a habitat's config. Use 'owner/repo' format (e.g. 'firecrawl/cli'). If no habitat id is specified and no child habitats exist, the skill is added to this orchestrator's own config. Do NOT create a new habitat just to add a skill. The skill is installed via `npx skills` on next rebuild. Call rebuild_habitat afterward to apply.",
			inputSchema: z.object({
				id: z
					.string()
					.optional()
					.describe("Habitat ID (omit to add to this orchestrator itself)"),
				repo: z.string().describe("Skill package (e.g. 'firecrawl/cli')"),
			}),
			execute: async ({ id, repo }) => {
				// Self case: add to Gaia's own config
				if (!id) {
					const configPath = join(gaiaDataDir, "config.json");
					let config: Record<string, any>;
					try {
						config = JSON.parse(await readFile(configPath, "utf-8"));
					} catch {
						config = {};
					}
					if (!config.skillsFromGit) config.skillsFromGit = [];
					if (config.skillsFromGit.includes(repo)) {
						return `Skill "${repo}" is already configured on this orchestrator.`;
					}
					config.skillsFromGit.push(repo);
					await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
					return `Added skill "${repo}" to this orchestrator's config. The skill will be installed on next restart. Restart the Docker container to apply.`;
				}

				// Child habitat case
				const entry = registry.get(id);
				if (!entry)
					return `Habitat "${id}" not found. List habitats to see available IDs.`;

				if (!entry.config.skillsFromGit) {
					entry.config.skillsFromGit = [];
				}
				if (entry.config.skillsFromGit.includes(repo)) {
					return `Skill "${repo}" already configured on habitat "${id}"`;
				}
				entry.config.skillsFromGit.push(repo);
				await registry.update(id, { config: entry.config });
				// Re-seed volume with updated config (skillsFromGit added)
				await docker.seedVolume(id, buildSeedFiles(entry, vault, catalog));
				return `Added skill "${repo}" to habitat "${id}". Rebuild the habitat to install it.`;
			},
		}),

		remove_skill: tool({
			description: "Remove a skill package from a habitat's config.",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID"),
				repo: z.string().describe("Skill package to remove"),
			}),
			execute: async ({ id, repo }) => {
				const entry = registry.get(id);
				if (!entry) return `Habitat "${id}" not found`;

				if (!entry.config.skillsFromGit?.includes(repo)) {
					return `Skill "${repo}" not found in habitat "${id}" config`;
				}
				entry.config.skillsFromGit = entry.config.skillsFromGit.filter(
					(s) => s !== repo,
				);
				await registry.update(id, { config: entry.config });
				// Re-seed volume with updated config (skillsFromGit removed)
				await docker.seedVolume(id, buildSeedFiles(entry, vault, catalog));
				return `Removed skill "${repo}" from habitat "${id}". Rebuild the habitat to apply.`;
			},
		}),

		list_skills: tool({
			description: "List skill packages configured on a habitat.",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID"),
			}),
			execute: async ({ id }) => {
				const entry = registry.get(id);
				if (!entry) return `Habitat "${id}" not found`;

				const skills = entry.config.skillsFromGit ?? [];
				if (skills.length === 0)
					return `No skills configured on habitat "${id}"`;
				return `Skills on "${id}":\n${skills.map((s) => `  - ${s}`).join("\n")}`;
			},
		}),

		update_habitat_config: tool({
			description:
				"Update a habitat's configuration. Can set provider, model, name, gitUrl, gitBranch, or requiredSecrets. Changes are persisted to the registry and the volume is re-seeded. Rebuild the habitat for changes to take effect if it's running.",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID"),
				provider: z
					.string()
					.optional()
					.describe("LLM provider (e.g. google, openrouter)"),
				model: z
					.string()
					.optional()
					.describe("Model name (e.g. gemini-3-flash-preview)"),
				name: z.string().optional().describe("Display name"),
				gitUrl: z.string().optional().describe("Git URL for provisioning"),
				gitBranch: z.string().optional().describe("Git branch"),
			}),
			execute: async ({ id, provider, model, name, gitUrl, gitBranch }) => {
				const entry = registry.get(id);
				if (!entry) return `Habitat "${id}" not found`;

				const changes: string[] = [];
				if (provider !== undefined) {
					entry.config.defaultProvider = provider;
					changes.push(`provider=${provider}`);
				}
				if (model !== undefined) {
					entry.config.defaultModel = model;
					changes.push(`model=${model}`);
				}
				if (name !== undefined) {
					entry.name = name;
					entry.config.name = name;
					changes.push(`name=${name}`);
				}
				if (gitUrl !== undefined) {
					entry.config.gitUrl = gitUrl;
					changes.push(`gitUrl=${gitUrl}`);
				}
				if (gitBranch !== undefined) {
					entry.config.gitBranch = gitBranch;
					changes.push(`gitBranch=${gitBranch}`);
				}

				if (changes.length === 0) return "No changes specified.";

				await registry.update(id, { name: entry.name, config: entry.config });

				// Re-seed volume so next start picks up new config
				await docker.seedVolume(id, buildSeedFiles(entry, vault, catalog));

				const status = await docker.getStatus(id);
				const hint =
					status === "running"
						? " Rebuild the habitat for changes to take effect."
						: "";
				return `Updated habitat "${id}": ${changes.join(", ")}.${hint}`;
			},
		}),

		remove_habitat: tool({
			description:
				"Remove a habitat from the registry. Stops the container if running.",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID to remove"),
			}),
			execute: async ({ id }) => {
				const entry = registry.get(id);
				if (!entry) return `Habitat "${id}" not found`;

				// Stop if running
				await docker.stopContainer(id).catch(() => {});

				await registry.remove(id);
				return `Removed habitat "${id}". Data directory still exists at ${registry.habitatDataDir(id)}.`;
			},
		}),

		rebuild_habitat: tool({
			description: "Rebuild a habitat (stop + start with fresh image).",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID to rebuild"),
			}),
			execute: async ({ id }) => {
				const entry = registry.get(id);
				if (!entry) return `Habitat "${id}" not found`;

				await docker.stopContainer(id).catch(() => {});
				await docker.seedVolume(id, buildSeedFiles(entry, vault, catalog));
				const port = await docker.startContainer(entry, "", registry.list());
				await registry.update(id, { containerPort: port });
				const url = `http://localhost:${port}/?token=${entry.apiKey}`;
				return `Rebuilt habitat "${id}" on port ${port}\nWeb UI: ${url}`;
			},
		}),

		build_image: tool({
			description: "Build (or rebuild) the habitat Docker image.",
			inputSchema: z.object({}),
			execute: async () => {
				try {
					const output = await docker.buildImage();
					return `Image built successfully.\n${output.slice(-500)}`;
				} catch (err: any) {
					return `Build failed: ${err.message}`;
				}
			},
		}),

		// ── Reproducibility: export / import a habitat description ───────
		//
		// The export blob is the smallest set of bytes required to recreate the
		// habitat from scratch on another Gaia. It contains:
		//   - registry entry: id, name, config (HabitatConfig), secretBindings
		//   - The names (NOT values) of the secrets that need to be set in the
		//     target Gaia's master vault before calling import_habitat.
		//
		// Volumes, sessions, learnings, and on-disk repos are NOT exported. The
		// intent is "here is the recipe"; data that the habitat creates lives
		// and dies with the named volume.

		export_habitat: tool({
			description:
				"Export a habitat description as a JSON blob suitable for recreating it on another Gaia. The blob contains the config, secret-binding names (not values), and identity scopes. No data, no volumes.",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID to export"),
			}),
			execute: async ({ id }) => {
				const entry = registry.get(id);
				if (!entry) return `Habitat "${id}" not found`;
				const blob = {
					version: 1,
					exportedAt: new Date().toISOString(),
					name: entry.name,
					config: entry.config,
					secretBindings: entry.secretBindings,
					requiredSecrets: entry.secretBindings.map((name) => ({
						name,
						present: vault.get(name) !== undefined,
					})),
				};
				return JSON.stringify(blob, null, 2);
			},
		}),

		import_habitat: tool({
			description:
				"Recreate a habitat from a previously exported blob. Pass the JSON string from export_habitat. Will fail if the target ID already exists. Master-vault secrets must be set separately (use bind_secret on the secrets the warning mentions).",
			inputSchema: z.object({
				blob: z
					.string()
					.describe(
						"The JSON blob produced by export_habitat. Pass as a string.",
					),
				idOverride: z
					.string()
					.optional()
					.describe(
						"Override the habitat ID (use when the blob's ID is already taken).",
					),
			}),
			execute: async ({ blob, idOverride }) => {
				let parsed: any;
				try {
					parsed = JSON.parse(blob);
				} catch (err: any) {
					return `Invalid blob: not JSON (${err.message})`;
				}
				if (!parsed?.config) return "Invalid blob: missing config";

				const id =
					idOverride ??
					parsed.config.id ??
					parsed.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-");
				if (!id) return "Invalid blob: cannot derive habitat ID";

				if (registry.get(id)) {
					return `Habitat "${id}" already exists. Pass idOverride to import under a different ID.`;
				}

				const entry = await registry.create({
					id,
					name: parsed.name ?? id,
					provider: parsed.config.defaultProvider ?? "google",
					model: parsed.config.defaultModel ?? "gemini-3-flash-preview",
					gitUrl: parsed.config.gitUrl,
					gitBranch: parsed.config.gitBranch,
					secretBindings: parsed.secretBindings ?? [],
					skillsFromGit: parsed.config.skillsFromGit,
				});
				// Preserve agents, scopeTemplates, requiredSecrets, etc.
				entry.config = { ...entry.config, ...parsed.config, name: entry.name };
				await registry.update(id, { config: entry.config });

				// Re-apply the org-readonly seed in case the importer's vault has
				// tokens the source vault didn't.
				const seed = seedOrgReadonly(entry.config, vault);
				if (seed.bindings.length > 0) {
					for (const name of seed.bindings) {
						if (!entry.secretBindings.includes(name))
							entry.secretBindings.push(name);
					}
					await registry.update(id, {
						config: entry.config,
						secretBindings: entry.secretBindings,
					});
				}

				await docker.seedVolume(id, buildSeedFiles(entry, vault, catalog));

				const missing = entry.secretBindings.filter(
					(n) => vault.get(n) === undefined,
				);
				const warn =
					missing.length > 0
						? `\n\nWARNING: master vault is missing values for: ${missing.join(", ")}. Use bind_secret to add them before starting the container.`
						: "";
				return `Imported habitat "${id}" from blob.${warn}`;
			},
		}),

		// ── Credential Catalog ───────────────────────────────────────────

		add_credential: tool({
			description:
				"Add a credential entry to the catalog. Stores metadata about a secret (provider, capabilities, scopes) — NOT the actual secret value. Use set_secret to store the actual value in the master vault.",
			inputSchema: z.object({
				name: z
					.string()
					.describe("Stable machine name (e.g. 'quickbooks-read-key')"),
				label: z.string().describe("Human-readable label"),
				provider: z
					.string()
					.describe("Provider namespace (e.g. 'intuit/quickbooks', 'github')"),
				capabilities: z
					.array(z.string())
					.describe(
						"Capability names this credential grants (e.g. ['quickbooks:read'])",
					),
				scopes: z
					.array(z.string())
					.optional()
					.describe("Upstream OAuth scopes (e.g. ['accounts:read'])"),
				dashboardUrl: z
					.string()
					.optional()
					.describe("URL to billing/quotas dashboard"),
				sourceVaultRef: z
					.string()
					.optional()
					.describe(
						"Reference to secret location (1Password item, age key, etc.)",
					),
			}),
			execute: async (params) => {
				try {
					await catalog.add({
						name: params.name,
						label: params.label,
						provider: params.provider,
						capabilities: params.capabilities,
						scopes: params.scopes ?? [],
						dashboardUrl: params.dashboardUrl,
						sourceVaultRef: params.sourceVaultRef,
						status: "unknown",
					});
					await audit.log(credentialEntry("add_credential", params.name));
					return `Added credential "${params.name}" (${params.provider}).`;
				} catch (err: any) {
					return `Error: ${err.message}`;
				}
			},
		}),

		list_credentials: tool({
			description:
				"List all credentials in the catalog with their capabilities and status.",
			inputSchema: z.object({
				provider: z
					.string()
					.optional()
					.describe("Filter by provider namespace"),
				capability: z.string().optional().describe("Filter by capability"),
			}),
			execute: async ({ provider, capability }) => {
				let entries = catalog.list();
				if (provider) entries = entries.filter((e) => e.provider === provider);
				if (capability)
					entries = entries.filter((e) => e.capabilities.includes(capability));
				if (entries.length === 0) return "No credentials found.";
				const summary = entries.map((e) => {
					const capStr =
						e.capabilities.length > 0 ? e.capabilities.join(", ") : "none";
					const verified = e.lastVerified
						? ` (verified ${e.lastVerified.slice(0, 10)})`
						: "";
					return `  - ${e.name} [${e.provider}] caps: ${capStr} status: ${e.status}${verified}`;
				});
				return `Credentials (${entries.length}):\n${summary.join("\n")}`;
			},
		}),

		remove_credential: tool({
			description:
				"Remove a credential entry from the catalog by name. Does NOT delete the secret from the master vault.",
			inputSchema: z.object({
				name: z.string().describe("Credential name to remove"),
			}),
			execute: async ({ name }) => {
				const removed = await catalog.remove(name);
				if (removed) {
					await audit.log(credentialEntry("remove_credential", name));
					return `Removed credential "${name}".`;
				}
				return `Credential "${name}" not found.`;
			},
		}),

		verify_credential: tool({
			description:
				"Mark a credential as verified (sets status to active and updates lastVerified timestamp).",
			inputSchema: z.object({
				name: z.string().describe("Credential name to verify"),
			}),
			execute: async ({ name }) => {
				const entry = await catalog.verify(name);
				if (!entry) return `Credential "${name}" not found.`;
				await audit.log(credentialEntry("verify_credential", name));
				return `Verified credential "${name}" (status: active, verified: ${entry.lastVerified}).`;
			},
		}),

		// ── Capability Bindings ───────────────────────────────────────

		bind_capability: tool({
			description:
				"Bind a capability to a habitat using a specific credential. The credential must exist in the catalog and grant the requested capability. Adds the binding to the habitat config and re-seeds the volume.",
			inputSchema: z.object({
				habitatId: z.string().describe("Habitat ID"),
				capability: z
					.string()
					.describe("Capability to bind (e.g. 'github:read')"),
				credential: z.string().describe("Credential name in the catalog"),
			}),
			execute: async ({ habitatId, capability, credential }) => {
				const entry = registry.get(habitatId);
				if (!entry) return `Habitat "${habitatId}" not found`;

				// Validate
				const resolver = new CapabilityResolver();
				try {
					resolver.validate({ capability, credential }, catalog);
				} catch (err: any) {
					return `Validation failed: ${err.message}`;
				}

				// Check for duplicate
				if (!entry.config.capabilities) entry.config.capabilities = [];
				const existing = entry.config.capabilities.find(
					(b) => b.capability === capability && b.credential === credential,
				);
				if (existing) {
					return `Capability "${capability}" already bound to credential "${credential}" on habitat "${habitatId}".`;
				}

				entry.config.capabilities.push({ capability, credential });
				await registry.update(habitatId, { config: entry.config });

				// Re-seed volume
				await docker.seedVolume(
					habitatId,
					buildSeedFiles(entry, vault, catalog),
				);

				await audit.log(
					bindingEntry("bind_capability", habitatId, capability, credential),
				);

				const status = await docker.getStatus(habitatId);
				const hint =
					status === "running"
						? " Rebuild the habitat for the new capability to take effect."
						: "";
				return `Bound capability "${capability}" → credential "${credential}" on habitat "${habitatId}".${hint}`;
			},
		}),

		unbind_capability: tool({
			description:
				"Remove a capability binding from a habitat. Takes the capability name (e.g. 'github:read') and removes all bindings for that capability.",
			inputSchema: z.object({
				habitatId: z.string().describe("Habitat ID"),
				capability: z
					.string()
					.describe("Capability to unbind (e.g. 'github:read')"),
			}),
			execute: async ({ habitatId, capability }) => {
				const entry = registry.get(habitatId);
				if (!entry) return `Habitat "${habitatId}" not found`;

				if (!entry.config.capabilities?.length) {
					return `Habitat "${habitatId}" has no capability bindings.`;
				}

				const removed = entry.config.capabilities.filter(
					(b) => b.capability === capability,
				);
				if (removed.length === 0) {
					return `Capability "${capability}" is not bound on habitat "${habitatId}".`;
				}

				entry.config.capabilities = entry.config.capabilities.filter(
					(b) => b.capability !== capability,
				);
				await registry.update(habitatId, { config: entry.config });

				// Re-seed volume
				await docker.seedVolume(
					habitatId,
					buildSeedFiles(entry, vault, catalog),
				);

				for (const b of removed) {
					await audit.log(
						bindingEntry(
							"unbind_capability",
							habitatId,
							b.capability,
							b.credential,
						),
					);
				}

				const credList = removed.map((b) => `"${b.credential}"`).join(", ");
				const status = await docker.getStatus(habitatId);
				const hint =
					status === "running"
						? " Rebuild the habitat for changes to take effect."
						: "";
				return `Unbound capability "${capability}" (removed credentials: ${credList}) from habitat "${habitatId}".${hint}`;
			},
		}),

		read_credential_audit_log: tool({
			description:
				"Read the most recent credential audit log entries. Shows timestamped records of add/remove/verify/bind/unbind operations.",
			inputSchema: z.object({
				n: z
					.number()
					.optional()
					.describe("Number of entries to return (default: 50)"),
			}),
			execute: async ({ n }) => {
				const entries = await audit.read(n ?? 50);
				if (entries.length === 0) return "No audit entries yet.";
				const lines = entries.map((e) => {
					const context = e.habitatId
						? ` habitat=${e.habitatId} cap=${e.capability}`
						: "";
					return `[${e.timestamp}] ${e.operation} credential=${e.credential}${context}`;
				});
				return `Audit log (${entries.length} entries):\n${lines.join("\n")}`;
			},
		}),

		list_habitat_capabilities: tool({
			description:
				"List all capability bindings on a habitat, with the credential status for each.",
			inputSchema: z.object({
				habitatId: z.string().describe("Habitat ID"),
			}),
			execute: async ({ habitatId }) => {
				const entry = registry.get(habitatId);
				if (!entry) return `Habitat "${habitatId}" not found`;

				if (!entry.config.capabilities?.length) {
					return `Habitat "${habitatId}" has no capability bindings.`;
				}

				const summary = entry.config.capabilities.map((b) => {
					const cred = catalog.get(b.credential);
					const status = cred?.status ?? "not-in-catalog";
					const verified = cred?.lastVerified
						? ` (verified ${cred.lastVerified.slice(0, 10)})`
						: "";
					const hasSecret = vault.get(b.credential) !== undefined;
					const secretStatus = hasSecret ? "has secret" : "no secret in vault";
					return `  - ${b.capability} → ${b.credential} [${cred?.provider ?? "unknown"}] status: ${status}${verified}, ${secretStatus}`;
				});

				return `Capability bindings on "${habitatId}":
${summary.join("\n")}`;
			},
		}),

		// ── Standards Audit ───────────────────────────────────────────

		broadcast_standards: tool({
			description:
				"Send a standards audit message to one or all running habitats that have a standards agent. Each habitat pulls the latest standards, reviews its own project, and returns structured findings. Uses A2A blocking messaging — waits for each habitat to respond.",
			inputSchema: z.object({
				habitatId: z
					.string()
					.optional()
					.describe(
						"Audit only this habitat. If omitted, audits all running habitats with a standards agent.",
					),
			}),
			execute: async ({ habitatId }) => {
				const summary = await runStandardsAudit(ctx, { habitatId });

				if (summary.total === 0) {
					return habitatId
						? `Habitat "${habitatId}" not found.`
						: "No habitats registered.";
				}

				if (summary.results.every((r) => r.status === "skipped")) {
					const skippedReasons = summary.results
						.map((r) => `  - ${r.error}`)
						.join("\n");
					return `No eligible habitats to audit.\n\n${skippedReasons}`;
				}

				const responded = summary.results.filter(
					(r) => r.status === "responded",
				);
				const unresponsive = summary.results.filter(
					(r) => r.status === "unresponsive",
				);
				const skipped = summary.results.filter((r) => r.status === "skipped");

				const lines: string[] = [];
				lines.push("## Standards Audit");
				lines.push(
					`Responded: ${responded.length}/${summary.total - skipped.length}`,
				);
				lines.push(
					`Unresponsive: ${unresponsive.length}/${summary.total - skipped.length}`,
				);
				if (skipped.length > 0) {
					lines.push(`Skipped: ${skipped.length}`);
				}
				lines.push("");

				for (const r of responded) {
					lines.push(`### ${r.name} (${r.habitatId})`);
					lines.push(r.findings ?? "(no findings)");
					lines.push("");
				}

				for (const r of unresponsive) {
					lines.push(`### ${r.name} (${r.habitatId})`);
					lines.push(`⚠️ Unresponsive: ${r.error}`);
					lines.push("");
				}

				if (skipped.length > 0) {
					lines.push("### Warnings");
					for (const s of skipped) {
						lines.push(`  - ${s.error}`);
					}
				}

				return lines.join("\n");
			},
		}),
	};
}

/** Create a ToolSet that adds Gaia orchestrator tools to a habitat. */
export function createGaiaToolSet(ctx: GaiaToolsContext): ToolSet {
	return {
		name: "gaia-orchestrator",
		description:
			"Manage multiple habitat containers — create, start, stop, query, and configure them via Docker. Manage the master secret vault and delegate tasks to running habitats via A2A.",
		createTools: () => {
			return createGaiaTools(ctx);
		},
	};
}
