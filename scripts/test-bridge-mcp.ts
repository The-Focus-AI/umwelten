#!/usr/bin/env node
/**
 * Habitat Bridge MCP Test Script
 *
 * Simple 3-step walkthrough:
 * 1. Create a Habitat
 * 2. Create a BridgeAgent (auto-starts MCP server)
 * 3. Connect to the MCP server
 */

import { Habitat } from "../src/habitat/habitat.js";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO_URL = "https://github.com/The-Focus-AI/trmnl-image-agent";
const AGENT_ID = "test-trmnl-bridge";

async function main() {
  console.log("=== Habitat Bridge MCP Test ===\n");

  // Step 1: Create a Habitat
  console.log("Step 1: Creating Habitat...");
  const tempDir = await mkdtemp(join(tmpdir(), "habitat-bridge-test-"));
  const workDir = join(tempDir, "work");
  const sessionsDir = join(tempDir, "sessions");

  const habitat = await Habitat.create({
    workDir,
    sessionsDir,
    config: {
      agents: [],
      name: "test-habitat",
    },
    skipBuiltinTools: true,
    skipSkills: true,
  });
  console.log(`  ✓ Habitat created at: ${workDir}`);
  console.log(`  ✓ Sessions at: ${sessionsDir}\n`);

  // Step 2: Create a BridgeAgent (this starts the MCP server automatically)
  console.log("Step 2: Creating BridgeAgent (this starts the MCP server)...");
  console.log(`  Repository: ${REPO_URL}`);
  console.log(`  Agent ID: ${AGENT_ID}`);
  console.log("  Starting container (this may take 30-60 seconds)...\n");

  const bridgeAgent = await habitat.createBridgeAgent(AGENT_ID, REPO_URL);
  console.log(`  ✓ BridgeAgent created!`);
  console.log(
    `  ✓ Status: ${bridgeAgent.getState().isReady ? "READY" : "NOT READY"}`,
  );
  console.log(`  ✓ Iterations: ${bridgeAgent.getState().iteration}`);
  console.log(`  ✓ Port: ${bridgeAgent.getPort()}\n`);

  // Step 3: Connect to the MCP server
  console.log("Step 3: Connecting to MCP server...");
  const client = await bridgeAgent.getClient();
  console.log(`  ✓ Client connected!`);
  console.log(`  ✓ Connected: ${client.isConnected()}\n`);

  // Test the connection
  console.log("Testing MCP server...");
  const health = await client.health();
  console.log(`  ✓ Health check: ${health.status}`);
  console.log(`  ✓ Workspace: ${health.workspace}`);
  console.log(`  ✓ Uptime: ${health.uptime}s\n`);

  // List files in the repo
  console.log("Listing repository files...");
  const entries = await client.listDirectory("/workspace");
  console.log(`  ✓ Found ${entries.length} items in /workspace:`);
  entries.slice(0, 10).forEach((entry) => {
    console.log(
      `    - ${entry.type === "directory" ? "[D]" : "[F]"} ${entry.name}`,
    );
  });
  if (entries.length > 10) {
    console.log(`    ... and ${entries.length - 10} more`);
  }
  console.log();

  // Read README
  console.log("Reading README.md...");
  try {
    const readme = await client.readFile("README.md");
    console.log("  ✓ README.md content (first 300 chars):");
    console.log("    " + readme.substring(0, 300).replace(/\n/g, "\n    "));
    console.log();
  } catch (e) {
    console.log("  ✗ Could not read README.md\n");
  }

  console.log("=== Success! ===");
  console.log(
    "The BridgeAgent is running with an MCP server inside a Dagger container.",
  );
  console.log(
    "You can now use the client to execute commands, read/write files, etc.",
  );
  console.log();
  console.log("Press Ctrl+C to stop and cleanup...");

  // Keep running until user interrupts
  process.on("SIGINT", async () => {
    console.log("\n\nCleaning up...");
    await bridgeAgent.destroy();
    console.log("✓ BridgeAgent destroyed");
    process.exit(0);
  });

  // Keep the process alive
  await new Promise(() => {});
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
