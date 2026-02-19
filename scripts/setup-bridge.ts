#!/usr/bin/env node
/**
 * Bridge Setup Script - Follows BRIDGE_WORKFLOW.md
 *
 * Step 1: Start basic container
 * Step 2: Query scripts to detect requirements
 * Step 3: Update provisioning
 * Step 4: Reprovision with correct packages
 * Step 5: Run scripts
 */

import { BridgeAgent } from "../src/habitat/bridge/agent.js";
import { BridgeAnalyzer } from "../src/habitat/bridge/analyzer.js";

const AGENT_ID = "trmnl-image-agent";
const REPO_URL = "https://github.com/The-Focus-AI/trmnl-image-agent";

async function main() {
  console.log("=== Bridge System Workflow ===\n");

  // Step 1: Start basic container
  console.log("Step 1: Starting basic bridge container...");
  const bridgeAgent = new BridgeAgent({
    id: AGENT_ID,
    repoUrl: REPO_URL,
    maxIterations: 5,
  });

  await bridgeAgent.initialize();
  console.log(`✓ Bridge ready on port ${bridgeAgent.getPort()}\n`);

  // Step 2: Query scripts
  console.log("Step 2: Analyzing scripts...");
  const client = await bridgeAgent.getClient();
  const analyzer = new BridgeAnalyzer(client);
  const analysis = await analyzer.analyze("/workspace");

  console.log("Detected:");
  console.log(`  - Project type: ${analysis.projectType}`);
  console.log(`  - Tools: ${analysis.detectedTools.join(", ")}`);
  console.log(`  - APT packages: ${analysis.aptPackages.join(", ")}`);
  console.log(`  - Setup commands: ${analysis.setupCommands.length}\n`);

  // Step 3 & 4: Already done by initialize() through iterative provisioning
  console.log(
    "Step 3 & 4: Container reprovisioned with detected requirements\n",
  );

  // Step 5: Run run.sh
  console.log("Step 5: Running run.sh...");
  const result = await client.execute("./run.sh", {
    cwd: "/workspace",
    timeout: 300000,
  });
  console.log("\n=== Output ===");
  console.log(result.stdout);
  if (result.stderr) {
    console.log("\n=== Errors ===");
    console.log(result.stderr);
  }

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
