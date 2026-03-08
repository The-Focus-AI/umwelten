#!/usr/bin/env npx tsx
/**
 * Spike 07: Focused LLM build + validation only.
 *
 * Goal: provision a repo container via LLM, then validate the built image.
 * No service startup in this spike.
 *
 * Usage:
 *   npx tsx src/habitat/bridge/spikes/07-agent-install-llm.ts [repo-url]
 */

import '../../../env/load.js';
import { dag, connection } from "@dagger.io/dagger";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoUrl =
  process.argv[2] || "https://github.com/The-Focus-AI/trmnl-image-agent";
const PORT = 18082; // only used for entrypoint wiring during build

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const binaryPath = join(__dirname, "..", "go-server", "bridge-server-linux");

if (!existsSync(binaryPath)) {
  console.error(`❌ Go binary not found at ${binaryPath}`);
  process.exit(1);
}

const log = (message: string) => {
  console.log(`[07-agent-install-llm] ${message}`);
};

const startedAt = Date.now();

function collectSecrets() {
  const result: Array<{ name: string; value: string }> = [];
  for (const name of ["GEMINI_API_KEY", "ANTHROPIC_API_KEY"] as const) {
    const value = process.env[name];
    if (value && value.trim() !== "") {
      result.push({ name, value });
    }
  }
  return result;
}

// Keep dagger progress readable in this terminal.
process.env.DAGGER_PROGRESS ??= "plain";

console.log(`\n=== Spike 07: Agent Install (LLM) ===`);
console.log(`Repo: ${repoUrl}`);
console.log(`Binary: ${binaryPath}\n`);

await connection(
  async () => {
    const tsBuilderModule = "../container-builder" + ".ts";
    const { buildContainerWithLLM } = await import(tsBuilderModule)
      .catch(() => import("../container-builder.js"));

    const secrets = collectSecrets();
    log(`Collected ${secrets.length} secrets for bridge container.`);

    log("1) Cloning repo tree...");
    const repo = dag.git(repoUrl).head().tree();

    log("2) Building container via buildContainerWithLLM...");
    const llmStarted = Date.now();
    const { container, provisioning } = await buildContainerWithLLM(repo, {
      repoUrl,
      secrets,
      port: PORT,
      goBinaryPath: binaryPath,
    });
    const llmElapsedSec = ((Date.now() - llmStarted) / 1000).toFixed(1);
    log(`LLM build completed in ${llmElapsedSec}s.`);
    console.log("[07-agent-install-llm] Provisioning:", JSON.stringify(provisioning, null, 2));

    log("3) Validating workspace + bridge binary + key tools...");
    const validation = await container
      .withExec([
        "sh",
        "-c",
        "echo '=== workspace ===' && ls /workspace | head -12 && echo '=== node ===' && (node --version || echo 'node: missing') && echo '=== claude ===' && (claude --version || /root/.local/bin/claude --version || echo 'claude: missing') && echo '=== bridge ===' && test -x /opt/bridge/bridge-server && echo 'bridge-server: OK'",
      ])
      .stdout();
    console.log(validation);
    const totalSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    log(`4) Done. Total elapsed ${totalSec}s.`);
  },
  { LogOutput: process.stderr },
).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  log(`Failed: ${message}`);
  process.exit(1);
});

