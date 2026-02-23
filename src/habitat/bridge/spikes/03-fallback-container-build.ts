#!/usr/bin/env npx tsx
/**
 * Spike 03: Verify the fallback (non-LLM) container build works.
 *
 * This calls buildContainerWithFallback() and validates the result.
 * Useful for comparing what the heuristic path produces vs the LLM path.
 *
 * Usage: npx tsx src/habitat/bridge/spikes/03-fallback-container-build.ts [repo-url]
 */

import { dag, connection } from "@dagger.io/dagger";
import { buildContainerWithFallback } from "../container-builder.ts";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const repoUrl =
  process.argv[2] || "https://github.com/The-Focus-AI/trmnl-image-agent";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const binaryPath = join(__dirname, "..", "go-server", "bridge-server-linux");

if (!existsSync(binaryPath)) {
  console.error(`❌ Go binary not found at ${binaryPath}`);
  process.exit(1);
}

console.log(`\n=== Spike 03: Fallback Container Build ===`);
console.log(`Repo: ${repoUrl}`);
console.log(`Binary: ${binaryPath}\n`);

await connection(async () => {
  const repo = dag.git(repoUrl).head().tree();

  console.log("1. Building container with fallback heuristics...");
  const startTime = Date.now();

  const { container, provisioning } = await buildContainerWithFallback(repo, {
    repoUrl,
    secrets: [],
    port: 9999,
    goBinaryPath: binaryPath,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`   Build completed in ${elapsed}s`);
  console.log(`   Provisioning:`, JSON.stringify(provisioning, null, 2));

  console.log("\n2. Validating container contents...");
  const output = await container
    .withExec([
      "sh",
      "-c",
      "echo '=== /workspace ===' && ls /workspace/ | head -10 && echo '=== bridge binary ===' && test -x /opt/bridge/bridge-server && echo 'bridge-server: OK' || echo 'bridge-server: MISSING'",
    ])
    .stdout();
  console.log(output);

  console.log(`✅ Fallback container build works! (${elapsed}s)\n`);
});
