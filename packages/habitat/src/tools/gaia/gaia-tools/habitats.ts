/**
 * Habitat lifecycle tools — list, create, start, stop, status, logs,
 * ask, discover, update_config, remove, rebuild, build_image,
 * export, import. The orchestrator surface for managing the set of
 * containers Gaia owns.
 */

import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import { sendA2AMessage } from "@umwelten/protocols";
import { CapabilityResolver } from "../capability-resolver.js";
import { seedOrgReadonly, seedStandardsAgent } from "../gaia-seed.js";
import { type GaiaToolsContext, entryToEndpoint, discoverHabitats } from "./context.js";
import { buildSeedFiles } from "./seed-files.js";

export function createHabitatLifecycleTools(
	ctx: GaiaToolsContext,
): Record<string, Tool> {
	const {
		registry,
		vault,
		docker,
		catalog,
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
						const { fetchFromContainer } = await import("../proxy.js");
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
	};
}
