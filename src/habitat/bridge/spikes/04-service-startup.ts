#!/usr/bin/env npx tsx
/**
 * Spike 04: Verify a built container can start as a Dagger service
 * and respond to health checks via the real MCP client.
 *
 * This is the full end-to-end: build container → start service → MCP client connect → tools/list → stop.
 * Uses the actual buildContainerFromRepo() and HabitatBridgeClient.
 *
 * Usage: npx tsx src/habitat/bridge/spikes/04-service-startup.ts [repo-url]
 */

import { dag, connection } from "@dagger.io/dagger";
import { buildContainerFromRepo } from "../container-builder.ts";
import { HabitatBridgeClient } from "../client.ts";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const repoUrl =
  process.argv[2] || "https://github.com/The-Focus-AI/trmnl-image-agent";
const PORT = 18080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const binaryPath = join(__dirname, "..", "go-server", "bridge-server-linux");

if (!existsSync(binaryPath)) {
  console.error(`❌ Go binary not found at ${binaryPath}`);
  process.exit(1);
}

console.log(`\n=== Spike 04: Service Startup ===`);
console.log(`Repo: ${repoUrl}`);
console.log(`Port: ${PORT}\n`);

await connection(async () => {
  console.log("1. Building container...");
  const startBuild = Date.now();
  const { container, provisioning } = await buildContainerFromRepo({
    repoUrl,
    secrets: [],
    port: PORT,
    goBinaryPath: binaryPath,
  });
  console.log(`   Built in ${((Date.now() - startBuild) / 1000).toFixed(1)}s`);
  console.log(`   Method: ${provisioning.baseImage}`);

  console.log("\n2. Starting as Dagger service...");
  const service = container.asService();
  const servicePromise = service
    .up({ ports: [{ frontend: PORT, backend: PORT }] })
    .catch((err: any) => {
      console.error(`   Service error: ${err.message}`);
    });

  console.log("3. Polling for readiness (raw HTTP initialize)...");
  const MAX_WAIT = 30000;
  const POLL_INTERVAL = 1000;
  const startPoll = Date.now();
  let ready = false;

  while (!ready && Date.now() - startPoll < MAX_WAIT) {
    try {
      const response = await fetch(`http://localhost:${PORT}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "spike-test", version: "1.0" },
          },
        }),
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        const text = await response.text();
        if (text.includes("serverInfo") && text.includes("habitat-bridge")) {
          ready = true;
          console.log(`   Ready after ${((Date.now() - startPoll) / 1000).toFixed(1)}s`);
        }
      }
    } catch {
      // Expected during startup
    }

    if (!ready) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
  }

  if (!ready) {
    console.error(`❌ Service failed to become ready after ${MAX_WAIT / 1000}s`);
    process.exit(1);
  }

  console.log("\n4. Connecting MCP client...");
  const client = new HabitatBridgeClient({
    host: "localhost",
    port: PORT,
    timeout: 5000,
    id: "spike-04",
  });
  await client.connect();
  console.log("   Connected!");

  console.log("\n5. Listing tools...");
  const tools = await client.listTools();
  console.log(`   Found ${tools.length} tools:`);
  for (const tool of tools) {
    console.log(`     - ${tool.name}: ${tool.description?.slice(0, 60) || ""}`);
  }

  console.log("\n6. Health check...");
  const health = await client.health();
  console.log(`   Status: ${health.status}`);

  console.log("\n7. Listing workspace files...");
  const files = await client.listDirectory("/workspace");
  console.log(`   Found ${files.length} entries:`);
  for (const f of files) {
    console.log(`     [${f.type === "directory" ? "D" : "F"}] ${f.name}`);
  }

  console.log("\n8. Disconnecting...");
  await client.disconnect();

  console.log(`\n✅ Full service startup and MCP communication works!\n`);
});
