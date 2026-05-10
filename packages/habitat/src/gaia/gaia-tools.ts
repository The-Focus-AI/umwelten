/**
 * Gaia Orchestrator ToolSet — AI SDK tools for orchestrating habitats,
 * wrapped as a ToolSet for registration on a Habitat.
 */

import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import type { ToolSet } from "../tool-sets.js";
import type { GaiaHabitatEntry } from "./types.js";
import type { GaiaRegistryManager } from "./registry.js";
import type { GaiaSecretVault } from "./secrets.js";
import type { DockerManager } from "./docker.js";
import type { CredentialCatalog } from "./credential-catalog.js";
import {
  fetchAgentCard,
  sendA2AMessage,
  type A2AEndpoint,
  type AgentCardSummary,
} from "@umwelten/server";
import { seedOrgReadonly } from "./gaia-seed.js";

/** Adapt a Gaia registry entry to a generic A2A endpoint. */
function entryToEndpoint(entry: GaiaHabitatEntry): A2AEndpoint {
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
}

/** Build a skills-lock.json from the habitat config's skillsFromGit list. */
function buildSkillsLock(
  skills: string[],
): { version: number; skills: Record<string, { source: string; sourceType: string; computedHash: string }> } {
  const entries: Record<string, { source: string; sourceType: string; computedHash: string }> = {};
  for (const repo of skills) {
    // Use the repo shortname as the skill name (e.g. "vercel-labs/agent-skills" → "agent-skills")
    const name = repo.includes("/") ? repo.split("/").pop()! : repo;
    entries[name] = {
      source: repo,
      sourceType: "github",
      computedHash: "", // Will be populated on first install
    };
  }
  return { version: 1, skills: entries };
}

/** Build the seed files (config.json + secrets.json + skills-lock.json) for a habitat volume. */
export function buildSeedFiles(
  entry: GaiaHabitatEntry,
  vault: GaiaSecretVault,
): Array<{ path: string; content: string }> {
  const filtered: Record<string, string> = {};
  for (const name of entry.secretBindings) {
    const val = vault.get(name);
    if (val) filtered[name] = val;
  }
  const files = [
    { path: "config.json", content: JSON.stringify(entry.config, null, 2) + "\n" },
    { path: "secrets.json", content: JSON.stringify(filtered, null, 2) + "\n" },
  ];

  // Seed skills-lock.json if skills are configured
  const skills = entry.config.skillsFromGit ?? [];
  if (skills.length > 0) {
    files.push({
      path: "skills-lock.json",
      content: JSON.stringify(buildSkillsLock(skills), null, 2) + "\n",
    });
  }

  return files;
}

function createGaiaTools(ctx: GaiaToolsContext): Record<string, Tool> {
  const { registry, vault, docker, catalog } = ctx;

  return {
    list_habitats: tool({
      description: "List all registered habitats with their container status. Includes the web UI URL with auth token for running habitats.",
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
      description: "Create a new habitat entry in the registry. IMPORTANT: Always provide provider and model, and bind API key secrets. A habitat without a model or API keys cannot respond to messages.",
      inputSchema: z.object({
        id: z.string().describe("Slug identifier (e.g. 'jeeves-bot')"),
        name: z.string().describe("Display name"),
        gitUrl: z.string().optional().describe("Git URL for provisioning"),
        gitBranch: z.string().optional().describe("Git branch (default: main)"),
        provider: z.string().describe("LLM provider (e.g. google, openrouter). Required for the habitat to work."),
        model: z.string().describe("Model name (e.g. gemini-3-flash-preview). Required for the habitat to work."),
        secretBindings: z.array(z.string()).optional().describe("Secret names to bind (e.g. GOOGLE_GENERATIVE_AI_API_KEY)"),
        skillsFromGit: z.array(z.string()).optional().describe("Git repos for skills (e.g. 'typefully/agent-skills'). Cloned on container start."),
      }),
      execute: async (params) => {
        const entry = await registry.create(params);

        // Auto-bind the org-readonly identity if Gaia's master vault has the
        // relevant tokens. Adds a scopeTemplate + a credential-only agent in
        // the new habitat's config and binds the corresponding env vars.
        const seed = seedOrgReadonly(entry.config, vault);
        if (seed.bindings.length > 0) {
          for (const name of seed.bindings) {
            if (!entry.secretBindings.includes(name)) entry.secretBindings.push(name);
          }
          await registry.update(entry.id, {
            config: entry.config,
            secretBindings: entry.secretBindings,
          });
        }

        await docker.seedVolume(entry.id, buildSeedFiles(entry, vault));
        const warnings: string[] = [];
        if (!entry.config.defaultProvider || !entry.config.defaultModel) {
          warnings.push("WARNING: No provider/model set — the habitat cannot respond to messages.");
        }
        if (entry.secretBindings.length === 0) {
          warnings.push("WARNING: No secrets bound — the habitat has no API keys. Use bind_secret to add them.");
        }
        const seedNote = seed.scopeAdded || seed.agentAdded
          ? `\n\nAuto-seeded org-readonly identity (${seed.bindings.join(", ")}).`
          : "";
        const msg = `Created habitat "${entry.id}" (${entry.name}). Volume: gaia-${entry.id}-data${seedNote}`;
        return warnings.length > 0 ? `${msg}\n\n${warnings.join("\n")}` : msg;
      },
    }),

    start_habitat: tool({
      description: "Start a habitat container. The habitat must have a provider, model, and bound API key secrets to respond to messages.",
      inputSchema: z.object({
        id: z.string().describe("Habitat ID to start"),
      }),
      execute: async ({ id }) => {
        const entry = registry.get(id);
        if (!entry) return `Habitat "${id}" not found`;

        // Seed volume with fresh config + secrets
        await docker.seedVolume(id, buildSeedFiles(entry, vault));

        const port = await docker.startContainer(entry, "", registry.list());
        await registry.update(id, { containerPort: port });

        const warnings: string[] = [];
        if (!entry.config.defaultProvider || !entry.config.defaultModel) {
          warnings.push("WARNING: No provider/model configured — the habitat cannot respond to messages.");
        }
        const boundSecretCount = entry.secretBindings.filter(s => vault.get(s)).length;
        if (boundSecretCount === 0) {
          warnings.push("WARNING: No API keys available — the habitat cannot call LLM providers.");
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
      description: "Bind a master secret to a habitat (add to its secretBindings).",
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
          await registry.update(habitatId, { secretBindings: entry.secretBindings });
        }
        return `Secret "${secretName}" bound to habitat "${habitatId}"`;
      },
    }),

    ask_habitat: tool({
      description: "Send a message to a running habitat via A2A and get the response.",
      inputSchema: z.object({
        id: z.string().describe("Habitat ID"),
        message: z.string().describe("Message to send"),
      }),
      execute: async ({ id, message }) => {
        const entry = registry.get(id);
        if (!entry) return `Habitat "${id}" not found`;
        if (!entry.containerPort) return `Habitat "${id}" is not running`;

        try {
          const response = await sendA2AMessage(entryToEndpoint(entry), message);
          let result = `Response from ${entry.name}:\n${response.text}`;
          if (response.artifacts?.length) {
            result += "\nArtifacts: " + response.artifacts.map(a => a.name ?? a.uri).join(", ");
          }
          return result;
        } catch (err: any) {
          return `Error querying ${id}: ${err.message}`;
        }
      },
    }),

    discover_habitats: tool({
      description: "Fetch agent cards from all running habitats to learn their capabilities.",
      inputSchema: z.object({}),
      execute: async () => {
        const entries = registry.list();
        const results = await discoverHabitats(entries);
        return JSON.stringify(results, null, 2);
      },
    }),

    add_skill: tool({
      description: "Add a skill package to a habitat's config. Use 'owner/repo' format (e.g. 'vercel-labs/agent-skills'). The skill is installed via `npx skills` on next start/rebuild. Rebuild the habitat for it to take effect.",
      inputSchema: z.object({
        id: z.string().describe("Habitat ID"),
        repo: z.string().describe("Skill package (e.g. 'vercel-labs/agent-skills')"),
      }),
      execute: async ({ id, repo }) => {
        const entry = registry.get(id);
        if (!entry) return `Habitat "${id}" not found`;

        if (!entry.config.skillsFromGit) {
          entry.config.skillsFromGit = [];
        }
        if (entry.config.skillsFromGit.includes(repo)) {
          return `Skill "${repo}" already configured on habitat "${id}"`;
        }
        entry.config.skillsFromGit.push(repo);
        await registry.update(id, { config: entry.config });
        // Re-seed volume with updated skills-lock.json
        await docker.seedVolume(id, buildSeedFiles(entry, vault));
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
        entry.config.skillsFromGit = entry.config.skillsFromGit.filter(s => s !== repo);
        await registry.update(id, { config: entry.config });
        // Re-seed volume with updated skills-lock.json
        await docker.seedVolume(id, buildSeedFiles(entry, vault));
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
        if (skills.length === 0) return `No skills configured on habitat "${id}"`;
        return `Skills on "${id}":\n${skills.map(s => `  - ${s}`).join("\n")}`;
      },
    }),

    update_habitat_config: tool({
      description: "Update a habitat's configuration. Can set provider, model, name, gitUrl, gitBranch, or requiredSecrets. Changes are persisted to the registry and the volume is re-seeded. Rebuild the habitat for changes to take effect if it's running.",
      inputSchema: z.object({
        id: z.string().describe("Habitat ID"),
        provider: z.string().optional().describe("LLM provider (e.g. google, openrouter)"),
        model: z.string().optional().describe("Model name (e.g. gemini-3-flash-preview)"),
        name: z.string().optional().describe("Display name"),
        gitUrl: z.string().optional().describe("Git URL for provisioning"),
        gitBranch: z.string().optional().describe("Git branch"),
      }),
      execute: async ({ id, provider, model, name, gitUrl, gitBranch }) => {
        const entry = registry.get(id);
        if (!entry) return `Habitat "${id}" not found`;

        const changes: string[] = [];
        if (provider !== undefined) { entry.config.defaultProvider = provider; changes.push(`provider=${provider}`); }
        if (model !== undefined) { entry.config.defaultModel = model; changes.push(`model=${model}`); }
        if (name !== undefined) { entry.name = name; entry.config.name = name; changes.push(`name=${name}`); }
        if (gitUrl !== undefined) { entry.config.gitUrl = gitUrl; changes.push(`gitUrl=${gitUrl}`); }
        if (gitBranch !== undefined) { entry.config.gitBranch = gitBranch; changes.push(`gitBranch=${gitBranch}`); }

        if (changes.length === 0) return "No changes specified.";

        await registry.update(id, { name: entry.name, config: entry.config });

        // Re-seed volume so next start picks up new config
        await docker.seedVolume(id, buildSeedFiles(entry, vault));

        const status = await docker.getStatus(id);
        const hint = status === "running" ? " Rebuild the habitat for changes to take effect." : "";
        return `Updated habitat "${id}": ${changes.join(", ")}.${hint}`;
      },
    }),

    remove_habitat: tool({
      description: "Remove a habitat from the registry. Stops the container if running.",
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
        await docker.seedVolume(id, buildSeedFiles(entry, vault));
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
          requiredSecrets: entry.secretBindings.map(name => ({
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
          .describe("The JSON blob produced by export_habitat. Pass as a string."),
        idOverride: z
          .string()
          .optional()
          .describe("Override the habitat ID (use when the blob's ID is already taken)."),
      }),
      execute: async ({ blob, idOverride }) => {
        let parsed: any;
        try { parsed = JSON.parse(blob); }
        catch (err: any) { return `Invalid blob: not JSON (${err.message})`; }
        if (!parsed?.config) return "Invalid blob: missing config";

        const id = idOverride ?? parsed.config.id ?? parsed.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-");
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
            if (!entry.secretBindings.includes(name)) entry.secretBindings.push(name);
          }
          await registry.update(id, {
            config: entry.config,
            secretBindings: entry.secretBindings,
          });
        }

        await docker.seedVolume(id, buildSeedFiles(entry, vault));

        const missing = entry.secretBindings.filter(n => vault.get(n) === undefined);
        const warn = missing.length > 0
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
        name: z.string().describe("Stable machine name (e.g. 'quickbooks-read-key')"),
        label: z.string().describe("Human-readable label"),
        provider: z.string().describe("Provider namespace (e.g. 'intuit/quickbooks', 'github')"),
        capabilities: z.array(z.string()).describe("Capability names this credential grants (e.g. ['quickbooks:read'])"),
        scopes: z.array(z.string()).optional().describe("Upstream OAuth scopes (e.g. ['accounts:read'])"),
        dashboardUrl: z.string().optional().describe("URL to billing/quotas dashboard"),
        sourceVaultRef: z.string().optional().describe("Reference to secret location (1Password item, age key, etc.)"),
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
        provider: z.string().optional().describe("Filter by provider namespace"),
        capability: z.string().optional().describe("Filter by capability"),
      }),
      execute: async ({ provider, capability }) => {
        let entries = catalog.list();
        if (provider) entries = entries.filter((e) => e.provider === provider);
        if (capability) entries = entries.filter((e) => e.capabilities.includes(capability));
        if (entries.length === 0) return "No credentials found.";
        const summary = entries.map((e) => {
          const capStr = e.capabilities.length > 0 ? e.capabilities.join(", ") : "none";
          const verified = e.lastVerified ? ` (verified ${e.lastVerified.slice(0, 10)})` : "";
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
        return removed
          ? `Removed credential "${name}".`
          : `Credential "${name}" not found.`;
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
        return `Verified credential "${name}" (status: active, verified: ${entry.lastVerified}).`;
      },
    }),
  };
}

/** Create a ToolSet that adds Gaia orchestrator tools to a habitat. */
export function createGaiaToolSet(ctx: GaiaToolsContext): ToolSet {
  return {
    name: "gaia-orchestrator",
    description: "Manage multiple habitat containers — create, start, stop, query, and configure them via Docker. Manage the master secret vault and delegate tasks to running habitats via A2A.",
    createTools: () => {
      return createGaiaTools(ctx);
    },
  };
}
