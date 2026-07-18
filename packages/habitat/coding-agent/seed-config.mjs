/**
 * Idempotent config.json seeder for the coding-agent image (#123).
 *
 * Ensures the two agents the seed routing/persona depend on exist:
 *   - workspace        — write agent over /data/workspace (coding channel target)
 *   - standards-corpus — read-only agent over /opt/standards (whitelists the
 *                        corpus for file tools)
 *
 * Never overwrites existing fields: a Gaia-seeded config.json keeps its
 * name, model, capabilities, and any agents it already declares. Creates a
 * minimal config when the volume is empty (standalone docker run).
 */
import { readFileSync, writeFileSync } from "node:fs";

const configPath = process.argv[2];
if (!configPath) {
  console.error("usage: seed-config.mjs <path-to-config.json>");
  process.exit(1);
}

const SEED_AGENTS = [
  {
    id: "workspace",
    name: "Workspace",
    projectPath: "/data/workspace",
    mode: "write",
  },
  {
    id: "standards-corpus",
    name: "Standards Corpus",
    projectPath: "/opt/standards",
    mode: "read",
  },
];

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch {
  config = { name: "Coding Agent", agents: [] };
}

if (!Array.isArray(config.agents)) config.agents = [];

let changed = false;
for (const seed of SEED_AGENTS) {
  if (!config.agents.some((a) => a && a.id === seed.id)) {
    config.agents.push(seed);
    changed = true;
    console.log(`[coding-agent] Seeded agent "${seed.id}" into config.json.`);
  }
}

// Codex ships in the image; declare it as a channel runtime so routing.json
// can bind `"runtime": "codex"`. `true` = full preset (codex exec --json,
// OPENAI_API_KEY / CODEX_AUTH_JSON credentials). Never clobbers an existing
// runtimes block — operators own overrides.
if (config.runtimes === undefined) {
  config.runtimes = { codex: true };
  changed = true;
  console.log('[coding-agent] Seeded runtimes { codex } into config.json.');
}

// Declare the credentials this agent can use, so the agent card advertises
// them and an attaching client (the habitats SaaS Configure/attach form)
// renders paste-in fields and delivers values to /api/secrets — no one
// hand-sets secrets. CLAUDE_CODE_OAUTH_TOKEN comes from `claude setup-token`
// and switches the claude-sdk runtime to subscription auth (it wins over
// ANTHROPIC_API_KEY — see claudeAuthOptions). Never clobbers an existing
// requiredSecrets block — operators own overrides.
if (config.requiredSecrets === undefined) {
  config.requiredSecrets = [
    {
      name: "CLAUDE_CODE_OAUTH_TOKEN",
      label: "Claude Code (subscription)",
      description:
        "Long-lived token from `claude setup-token` — runs the claude-sdk runtime on your Claude subscription instead of API billing.",
      required: false,
      type: "secret",
    },
  ];
  changed = true;
  console.log(
    "[coding-agent] Seeded requiredSecrets (CLAUDE_CODE_OAUTH_TOKEN) into config.json.",
  );
}

let onDisk;
try {
  onDisk = readFileSync(configPath, "utf8");
} catch {
  onDisk = undefined;
}
if (changed || onDisk === undefined) {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}
