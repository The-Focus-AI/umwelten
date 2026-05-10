/**
 * Gaia auto-seed: when Gaia creates a new habitat, attach the org-wide
 * read-only identity (a `mode: read` agent + a `org-readonly` scope template)
 * if the master vault has the relevant token.
 *
 * Today the only seeded scope is `git-read` against `GITHUB_TOKEN`, but the
 * shape generalizes: more org tokens (NPM_READONLY, CARGO_READONLY) can be
 * added by extending ORG_READONLY_TOKENS.
 *
 * Pure functions only — they read from the GaiaSecretVault and mutate the
 * provided HabitatConfig in place. No I/O.
 */

import type { HabitatConfig, AgentEntry, ScopeTemplate } from "../types.js";
import type { GaiaSecretVault } from "./secrets.js";

/**
 * Tokens this seed will pull into the org-readonly scope.
 * Each entry maps a master-vault secret name to the scope kind it grants.
 */
export const ORG_READONLY_TOKENS: { name: string; kind: "git-read" | "api-key" }[] = [
  { name: "GITHUB_TOKEN", kind: "git-read" },
];

export const ORG_READONLY_TEMPLATE_ID = "org-readonly";
export const ORG_READONLY_AGENT_ID = "org-readonly";

/**
 * Returns the env-var names that Gaia should bind into a new habitat for the
 * org-readonly identity. Empty if the master vault has none of them.
 */
export function orgReadonlyBindings(vault: GaiaSecretVault): string[] {
  return ORG_READONLY_TOKENS
    .filter(t => vault.get(t.name) !== undefined)
    .map(t => t.name);
}

/**
 * Mutates `config` in place to add:
 *   - scopeTemplates["org-readonly"]   — declarative env-var list
 *   - agents["org-readonly"]           — credential-only, mode: read agent
 *
 * No-op if either is already present, or if the vault has none of the tokens.
 */
export function seedOrgReadonly(config: HabitatConfig, vault: GaiaSecretVault): {
  scopeAdded: boolean;
  agentAdded: boolean;
  bindings: string[];
} {
  const bindings = orgReadonlyBindings(vault);
  if (bindings.length === 0) {
    return { scopeAdded: false, agentAdded: false, bindings: [] };
  }

  let scopeAdded = false;
  if (!config.scopeTemplates) config.scopeTemplates = {};
  if (!config.scopeTemplates[ORG_READONLY_TEMPLATE_ID]) {
    const template: ScopeTemplate = {
      from: `agents/${ORG_READONLY_AGENT_ID}`,
      kind: "git-read",
      env: bindings,
      description:
        "Read-only access to the organization's git remotes and other shared read-only resources.",
    };
    config.scopeTemplates[ORG_READONLY_TEMPLATE_ID] = template;
    scopeAdded = true;
  }

  let agentAdded = false;
  if (!config.agents.some(a => a.id === ORG_READONLY_AGENT_ID)) {
    const agent: AgentEntry = {
      id: ORG_READONLY_AGENT_ID,
      name: "Org read-only",
      // credential-only agents have no project on disk; pin the path to a
      // sentinel inside /data so resolveAgentDir() stays well-defined.
      projectPath: `/data/agents/${ORG_READONLY_AGENT_ID}`,
      kind: "credential-only",
      mode: "read",
      identity: {
        principal: ORG_READONLY_AGENT_ID,
        vault: { backend: "habitat" },
        scopes: [
          {
            kind: "git-read",
            env: bindings,
            source: ORG_READONLY_TEMPLATE_ID,
          },
        ],
      },
    };
    config.agents.push(agent);
    agentAdded = true;
  }

  return { scopeAdded, agentAdded, bindings };
}
