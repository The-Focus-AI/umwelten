#!/usr/bin/env npx tsx
/**
 * Spike 08: Rebuild the same agent container twice and measure cache behavior.
 *
 * Goal:
 * - Run the same LLM provisioning flow two times
 * - Validate both outputs
 * - Compare timings (second should be faster when cache is reused)
 *
 * Usage:
 *   npx tsx src/habitat/bridge/spikes/08-agent-rebuild-cache.ts [repo-url]
 */

import '../../../env/load.js';
import { dag, connection } from "@dagger.io/dagger";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoUrl =
  process.argv[2] || "https://github.com/The-Focus-AI/trmnl-image-agent";
const PORT = 18083;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const binaryPath = join(__dirname, "..", "go-server", "bridge-server-linux");

if (!existsSync(binaryPath)) {
  console.error(`❌ Go binary not found at ${binaryPath}`);
  process.exit(1);
}

const log = (message: string) => {
  console.log(`[08-agent-rebuild-cache] ${message}`);
};

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

async function runBuildPass(
  label: string,
  repoUrl: string,
  port: number,
  binaryPath: string,
  secrets: Array<{ name: string; value: string }>,
) {
  const tsBuilderModule = "../container-builder" + ".ts";
  const { buildContainerWithLLM } = await import(tsBuilderModule)
    .catch(() => import("../container-builder.js"));

  log(`${label}: build start`);
  const repo = dag.git(repoUrl).head().tree();
  const started = Date.now();

  const { container } = await buildContainerWithLLM(repo, {
    repoUrl,
    secrets,
    port,
    goBinaryPath: binaryPath,
  });

  const elapsedMs = Date.now() - started;
  const elapsedSec = (elapsedMs / 1000).toFixed(1);
  log(`${label}: build done in ${elapsedSec}s`);

  const validation = await container
    .withExec([
      "sh",
      "-c",
      "echo '=== workspace ===' && ls /workspace | head -8 && echo '=== node ===' && (node --version || echo 'node: missing') && echo '=== claude ===' && (claude --version || /root/.local/bin/claude --version || echo 'claude: missing') && echo '=== bridge ===' && test -x /opt/bridge/bridge-server && echo 'bridge-server: OK'",
    ])
    .stdout();

  console.log(`[08-agent-rebuild-cache] ${label} validation:\n${validation}`);

  return elapsedMs;
}

process.env.DAGGER_PROGRESS ??= "plain";

console.log(`\n=== Spike 08: Agent Rebuild Cache ===`);
console.log(`Repo: ${repoUrl}`);
console.log(`Binary: ${binaryPath}\n`);

await connection(
  async () => {
    const secrets = collectSecrets();
    log(`Collected ${secrets.length} secrets for build.`);

    const firstMs = await runBuildPass("pass-1", repoUrl, PORT, binaryPath, secrets);
    const secondMs = await runBuildPass("pass-2", repoUrl, PORT, binaryPath, secrets);

    const firstSec = (firstMs / 1000).toFixed(1);
    const secondSec = (secondMs / 1000).toFixed(1);
    const deltaMs = firstMs - secondMs;
    const deltaSec = (deltaMs / 1000).toFixed(1);
    const speedup = secondMs > 0 ? (firstMs / secondMs).toFixed(2) : "n/a";

    console.log(
      `[08-agent-rebuild-cache] Timing summary: pass-1=${firstSec}s, pass-2=${secondSec}s, delta=${deltaSec}s, speedup=${speedup}x`,
    );
  },
  { LogOutput: process.stderr },
).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  log(`Failed: ${message}`);
  process.exit(1);
});

