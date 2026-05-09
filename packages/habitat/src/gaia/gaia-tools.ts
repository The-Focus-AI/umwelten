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
import { fetchAgentCard, sendA2AMessage, discoverHabitats } from "./a2a-client.js";

export interface GaiaToolsContext {
  registry: GaiaRegistryManager;
  vault: GaiaSecretVault;
  docker: DockerManager;
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
  const { registry, vault, docker } = ctx;

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
        // Seed the Docker volume with config + secrets
        await docker.seedVolume(entry.id, buildSeedFiles(entry, vault));
        const warnings: string[] = [];
        if (!entry.config.defaultProvider || !entry.config.defaultModel) {
          warnings.push("WARNING: No provider/model set — the habitat cannot respond to messages.");
        }
        if (entry.secretBindings.length === 0) {
          warnings.push("WARNING: No secrets bound — the habitat has no API keys. Use bind_secret to add them.");
        }
        const msg = `Created habitat "${entry.id}" (${entry.name}). Volume: gaia-${entry.id}-data`;
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
          const response = await sendA2AMessage(entry, message);
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
