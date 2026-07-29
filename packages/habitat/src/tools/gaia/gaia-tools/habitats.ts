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
import { getRegisteredProvider } from "@umwelten/core/providers/index.js";
import { CapabilityResolver } from "../capability-resolver.js";
import { seedOrgReadonly, seedStandardsAgent } from "../gaia-seed.js";
import { type GaiaToolsContext, entryToEndpoint, discoverHabitats, entryOpenUrl } from "./context.js";
import { applyHabitatDeclaration } from "../apply-declaration.js";
import { readDeclarationFromRepo } from "../read-declaration.js";
import { recordHabitatActivity } from "../reaper.js";
import { HabitatWaker, createWakeTools } from "../waker.js";
import { habitatSecretStatus } from "../secret-status.js";
import {
	describeRuntimeCredential,
	resolveRuntimeCredential,
} from "../runtime-credentials.js";
import { buildSeedFiles } from "./seed-files.js";

/**
 * The whole start path, in one place (#279).
 *
 * It used to live inline in `start_habitat`, which meant wake-on-ask would
 * have had to duplicate it — and a second copy of "seed, mint boot tokens,
 * run, record the port" is exactly the kind of thing that drifts until two
 * ways of starting a habitat produce two different containers.
 */
export async function startHabitatContainer(
	ctx: GaiaToolsContext,
	id: string,
): Promise<number> {
	const { registry, vault, docker, catalog, githubTokens } = ctx;
	const entry = registry.get(id);
	if (!entry) throw new Error(`Habitat "${id}" not found`);

	// Seed volume with fresh config + secrets
	await docker.seedVolume(id, buildSeedFiles(entry, vault, catalog));

	// Fresh GitHub boot tokens per start (ADR 0004; never throws —
	// a GitHub outage degrades to a token-less boot, not a failure).
	const bootTokens = await githubTokens?.bootTokensFor(entry);

	// The model credential travels the same road: resolved per start from the
	// habitat's provider, injected as env, never written to the volume and
	// never named in the habitat's own repo. A habitat that needs no key, or
	// whose key the vault cannot supply, simply gets none — the container
	// still starts, which is what makes the gap reportable rather than fatal.
	const runtime = resolveRuntimeCredential(entry, {
		providerEnvVar: (p) => getRegisteredProvider(p)?.envVar,
		secret: (name) => vault.get(name),
	});

	const port = await docker.startContainer(entry, "", registry.list(), {
		githubTokens: bootTokens,
		...(runtime.ok ? { modelCredential: runtime.credential } : {}),
	});
	await registry.update(id, { containerPort: port });
	// A start counts as activity, so a habitat is not reaped in the
	// window between being started and first being asked anything.
	await recordHabitatActivity(registry, id);
	return port;
}

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
		githubTokens,
	} = ctx;

	const waker = new HabitatWaker({
		getEntry: (id) => registry.get(id),
		getStatus: (id) => docker.getStatus(id),
		start: (id) => startHabitatContainer(ctx, id),
	});

	return {
		...createWakeTools(waker, { listIds: () => registry.list().map((h) => h.id) }),
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
							url: entryOpenUrl(entry),
							secretBindings: entry.secretBindings,
							createdAt: entry.createdAt,
						};
					}),
				);
				return JSON.stringify(results, null, 2);
			},
		}),

		create_habitat: tool({
			description: `Create a new habitat entry in the registry. Omitted provider/model inherit Gaia's own (${gaiaProvider ?? "openrouter"} / ${gaiaModel ?? "anthropic/claude-sonnet-5"}). When the user asks for a specific model, verify the exact id with list_models first — NEVER write a model id from memory. IMPORTANT: bind API key secrets — a habitat without API keys cannot respond to messages.`,
			inputSchema: z.object({
				id: z.string().describe("Slug identifier (e.g. 'jeeves-bot')"),
				name: z.string().describe("Display name"),
				gitUrl: z
					.string()
					.optional()
					.describe(
						"Git URL of the habitat's Owned repo — the one repo it may write to",
					),
				mounts: z
					.array(
						z.object({
							gitRemote: z.string().describe("Git URL to clone read-only"),
							gitBranch: z.string().optional(),
							id: z
								.string()
								.optional()
								.describe("Mount id; defaults to the repo name"),
							name: z.string().optional(),
						}),
					)
					.optional()
					.describe(
						"Repos this habitat reads but never writes. The GitHub read scope is derived from these plus the Owned repo, so mounts never need a separate grant. Write scope is never derived.",
					),
				gitBranch: z.string().optional().describe("Git branch (default: main)"),
				provider: z
					.string()
					.optional()
					.describe(
						`LLM provider (default: ${gaiaProvider ?? "openrouter"} — Gaia's own provider).`,
					),
				model: z
					.string()
					.optional()
					.describe(
						`Model name (default: ${gaiaModel ?? "anthropic/claude-sonnet-5"} — Gaia's own model).`,
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
				image: z
					.string()
					.optional()
					.describe(
						"Docker image for this habitat's container (default: the standard habitat image). Must exist locally — specialized images are built out of band.",
					),
				hostname: z
					.string()
					.optional()
					.describe(
						"Public hostname for Caddy routing (e.g. 'twitter.example.com'). Default: '<id>.$GAIA_BASE_DOMAIN' when that env var is set; otherwise no public URL.",
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

				// The schema advertises defaults, so implement them: an omitted
				// provider/model inherits Gaia's own. (These used to be required,
				// which made models that trusted the "default:" hint fail the tool
				// call with a missing-parameter error.)
				const entry = await registry.create({
					...params,
					provider: params.provider ?? gaiaProvider ?? "openrouter",
					model: params.model ?? gaiaModel ?? "anthropic/claude-sonnet-5",
				});

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
				// A binding the vault cannot satisfy is dropped from the seeded
				// secrets.json rather than failing, so the habitat boots and
				// health-checks fine and fails on first use. Say it here, where
				// the person who declared the binding is still looking.
				const gaps = habitatSecretStatus(entry, vault).missing;
				if (gaps.length) {
					warnings.push(
						`WARNING: bound but missing from the master vault: ${gaps.join(", ")}. ` +
							`These were NOT written to the volume — the container will start and then fail on first use. ` +
							`Add them with set_secret, then rebuild.`,
					);
				}
				const runtime = resolveRuntimeCredential(entry, {
					providerEnvVar: (name) => getRegisteredProvider(name)?.envVar,
					secret: (name) => vault.get(name),
				});
				if (!runtime.ok && runtime.reason !== "provider-needs-no-key") {
					warnings.push(`WARNING: ${describeRuntimeCredential(runtime)}`);
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

				// Through the waker so an explicit start and a wake-on-ask
				// (#279) cannot race into two containers for one habitat.
				const outcome = await waker.wake(id);
				if (outcome.action === "failed") return outcome.detail;
				const port = outcome.port;
				if (port === undefined) return outcome.detail;

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
				const url = entryOpenUrl(entry, port);
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
					url: entryOpenUrl(entry),
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
				"Send a message to a habitat via A2A and get the response. A dormant habitat is woken first, so this works whether or not it is running — expect the first question after a period of quiet to take longer.",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID"),
				message: z.string().describe("Message to send"),
			}),
			execute: async ({ id, message }) => {
				// Wake on ask (#279). Once habitats sleep by design, "not
				// running" is the normal state of most of the fleet, so
				// refusing here would make sleeping look like breakage.
				const wake = await waker.wake(id);
				if (wake.action === "not-found" || wake.action === "failed") {
					return wake.detail;
				}

				// Re-read: waking rewrote containerPort on the entry.
				const entry = registry.get(id);
				if (!entry?.containerPort) {
					return `Habitat "${id}" started but is not reachable — no port recorded.`;
				}

				// Asking a habitat is the clearest form of using it (#278).
				await recordHabitatActivity(registry, id).catch(() => {});

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
				"List every habitat in the fleet with its capabilities. Running habitats are queried live; dormant ones answer from their last known agent card, so this never needs to wake anything.",
			inputSchema: z.object({}),
			execute: async () => {
				const entries = registry.list();
				const results = await discoverHabitats(entries, {
					// Warm the cache as we go, so the next call can answer for a
					// habitat that has gone to sleep in the meantime.
					saveCard: async (id, card, fetchedAt) => {
						await registry.update(id, { cachedCard: { card, fetchedAt } });
					},
				});
				return JSON.stringify(results, null, 2);
			},
		}),

		update_habitat_config: tool({
			description:
				"Update a habitat's configuration. Can set provider, model, name, gitUrl, gitBranch, or requiredSecrets. " +
				"When changing the model, verify the exact id with list_models first — NEVER write a model id from memory. " +
				"Changes are persisted to the registry and the volume is re-seeded. Rebuild the habitat for changes to take effect if it's running.",
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

		apply_habitat_declaration: tool({
			description:
				"Stand a habitat up from the habitat.json in its own repo (ADR 0006), creating it if it does not exist and updating it if it does. This is the sanctioned way to provision a repo-backed habitat — it reads the declaration and derives the GitHub read scope from the mounts it declares, so mounts and scopes cannot drift. A habitat that was not running needs no further step: asking it starts it (#279). A habitat that is already running needs a rebuild for the new declaration to reach its container.",
			inputSchema: z.object({
				id: z.string().describe("Habitat id to create or update"),
				gitUrl: z
					.string()
					.describe("The habitat's Owned repo — where habitat.json lives"),
				gitBranch: z
					.string()
					.optional()
					.describe("Branch to read the declaration from (default: the repo's default branch)"),
			}),
			execute: async ({ id, gitUrl, gitBranch }) => {
				try {
					// Ambient read: the narrowed scope is not knowable until the
					// declaration has been read (ADR 0006's bootstrap circularity).
					const ambient = await githubTokens?.tokenFor(
						{ id, github: { read: "org" } },
						"read",
					);

					const result = await applyHabitatDeclaration(registry, {
						id,
						gitUrl,
						...(gitBranch ? { gitBranch } : {}),
						readDeclaration: (url, ref) =>
							readDeclarationFromRepo(url, ref, { token: ambient?.token }),
						// Fleet policy the repo does not have to restate: Gaia's own
						// provider and model, and where a provider keeps its key.
						defaults: {
							...(gaiaProvider ? { provider: gaiaProvider } : {}),
							...(gaiaModel ? { model: gaiaModel } : {}),
						},
					});

					const read = result.entry.github?.read;
					const scope = read === "org" ? "org-wide" : (read ?? []).join(", ");
					const mounts = result.entry.config.agents
						.filter((a) => (a.kind ?? "repo") === "repo" && a.mode === "read")
						.map((a) => a.id);

					// Report what was applied, not just what was mounted. An
					// omitted field reads to a model as an unset one: leaving
					// provider/model/secrets unmentioned had Gaia conclude they
					// were missing and go do remedial work that was not needed.
					// A tool result's silence gets interpreted, so say it.
					const cfg = result.entry.config;
					const secrets = result.entry.secretBindings ?? [];

					return [
						`${result.action === "created" ? "Created" : "Updated"} habitat "${id}" from ${gitUrl}.`,
						`Mounts: ${mounts.length ? mounts.join(", ") : "(none)"}`,
						`Derived read scope: ${scope || "(none)"}`,
						result.entry.github?.write?.length
							? `Write scope (declared, never derived): ${result.entry.github.write.join(", ")}`
							: "Write scope: (none declared)",
						cfg.defaultProvider || cfg.defaultModel
							? `Provider/model (from the declaration): ${cfg.defaultProvider ?? "(unset)"} / ${cfg.defaultModel ?? "(unset)"}`
							: `Provider/model: not declared — inherits Gaia's defaults.`,
						secrets.length
							? `Secret bindings (from the declaration): ${secrets.join(", ")}`
							: `Secret bindings: none declared.`,
						...(() => {
							const lines: string[] = [];
							// The declaration can bind a secret the vault has never
							// heard of. Not an error here — but the difference between
							// a habitat that works and one that starts and then fails.
							const gaps = habitatSecretStatus(result.entry, vault).missing;
							if (gaps.length) {
								lines.push(
									`MISSING from the master vault: ${gaps.join(", ")}. Declared by this habitat, but there is no value to seed.`,
								);
							}
							// The model credential is platform infrastructure, not a
							// declared binding — reported here because this is where
							// someone finds out whether the habitat can think at all.
							const runtime = resolveRuntimeCredential(result.entry, {
								providerEnvVar: (name) => getRegisteredProvider(name)?.envVar,
								secret: (name) => vault.get(name),
							});
							lines.push(describeRuntimeCredential(runtime));
							return lines;
						})(),
						result.action === "created"
							? `Nothing further is required. Asking "${id}" starts it, and starting seeds the volume with this config and these secrets — do not seed, grant or rebuild by hand first.`
							: `Rebuild "${id}" if it is already running, so the new declaration reaches its container.`,
					].join("\n");
				} catch (err) {
					// Nothing was registered — apply validates before it writes.
					return `Could not apply the declaration for "${id}": ${err instanceof Error ? err.message : String(err)}`;
				}
			},
		}),

		grant_github_access: tool({
			description:
				"Declare a habitat's GitHub capabilities (ADR 0004). `read` is a list of repo names, or 'org' for whole-installation read — 'org' is ONLY for habitats whose own repo is private (a public-repo habitat with org read can launder private content into public commits). `write` is a list of repo names the habitat may push branches and open PRs on (merging stays blocked by branch protection). Write repos are readable via the write token, so they don't need repeating in read. Requires the GitHub App configured on Gaia. Rebuild the habitat so it boots with fresh tokens.",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID"),
				read: z
					.union([z.array(z.string()), z.literal("org")])
					.optional()
					.describe(
						"Repo names to allow reading, or 'org' (private-repo habitats only)",
					),
				write: z
					.array(z.string())
					.optional()
					.describe("Repo names to allow writing (branches + PRs)"),
			}),
			execute: async ({ id, read, write }) => {
				const entry = registry.get(id);
				if (!entry) return `Habitat "${id}" not found`;
				await registry.update(id, {
					github: {
						...(read !== undefined ? { read } : {}),
						...(write !== undefined ? { write } : {}),
					},
				});
				const readDesc =
					read === "org"
						? "whole installation"
						: read?.length
							? read.join(", ")
							: "none";
				const writeDesc = write?.length ? write.join(", ") : "none";
				const appNote = githubTokens?.enabled
					? ""
					: "\nNOTE: the GitHub App is not configured on Gaia (GITHUB_APP_ID / GITHUB_APP_INSTALLATION_ID / GITHUB_APP_PRIVATE_KEY_FILE) — no tokens will be minted until it is.";
				return `Declared GitHub access for "${id}": read=${readDesc}, write=${writeDesc}. Rebuild the habitat to boot it with fresh tokens.${appNote}`;
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
			description:
				"Restart a habitat: stop, re-seed config/secrets onto its volume, start. " +
				"Runs the image the habitat already uses — it does NOT rebuild any Docker image; " +
				"run build_image first to pick up new code.",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID to rebuild"),
			}),
			execute: async ({ id }) => {
				const entry = registry.get(id);
				if (!entry) return `Habitat "${id}" not found`;

				await docker.stopContainer(id).catch(() => {});
				await docker.seedVolume(id, buildSeedFiles(entry, vault, catalog));
				const bootTokens = await githubTokens?.bootTokensFor(entry);
				const port = await docker.startContainer(entry, "", registry.list(), {
					githubTokens: bootTokens,
				});
				await registry.update(id, { containerPort: port });
				const url = entryOpenUrl(entry, port);
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
					...(entry.image ? { image: entry.image } : {}),
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
					provider: parsed.config.defaultProvider ?? "openrouter",
					model: parsed.config.defaultModel ?? "anthropic/claude-sonnet-5",
					gitUrl: parsed.config.gitUrl,
					gitBranch: parsed.config.gitBranch,
					secretBindings: parsed.secretBindings ?? [],
					skillsFromGit: parsed.config.skillsFromGit,
					...(typeof parsed.image === "string" ? { image: parsed.image } : {}),
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
