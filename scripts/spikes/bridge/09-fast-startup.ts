#!/usr/bin/env npx tsx
/**
 * Spike 09: Single-script "fast startup" flow.
 *
 * What it does:
 * 1) Build with buildContainerWithLLM (using previous provisioning hint if available)
 * 2) Start bridge MCP service
 * 3) Connect client and validate health/tools
 *
 * Why it can be fast on repeat runs:
 * - Dagger reuses cached layers for identical build steps (look for "CACHED")
 * - Previous provisioning is fed back as an LLM hint to reduce re-planning
 *
 * Usage:
 *   npx tsx src/habitat/bridge/spikes/09-fast-startup.ts [repo-url]
 */

import '../../../env/load.js';
import { dag, connection } from "@dagger.io/dagger";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HabitatBridgeClient } from "../client.js";
import type { SavedProvisioning } from "../../types.js";

const repoUrl =
  process.argv[2] || "https://github.com/The-Focus-AI/trmnl-image-agent";
const PORT = 18084;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const binaryPath = join(__dirname, "..", "go-server", "bridge-server-linux");
const cacheFile = join(__dirname, ".09-fast-startup.provisioning.json");

if (!existsSync(binaryPath)) {
  console.error(`❌ Go binary not found at ${binaryPath}`);
  process.exit(1);
}

const log = (message: string) => {
  console.log(`[09-fast-startup] ${message}`);
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

async function loadPreviousProvisioning(): Promise<SavedProvisioning | undefined> {
  try {
    const raw = await readFile(cacheFile, "utf8");
    return JSON.parse(raw) as SavedProvisioning;
  } catch {
    return undefined;
  }
}

async function saveProvisioning(p: SavedProvisioning): Promise<void> {
  await writeFile(cacheFile, `${JSON.stringify(p, null, 2)}\n`, "utf8");
}

process.env.DAGGER_PROGRESS ??= "plain";

console.log(`\n=== Spike 09: Fast Startup ===`);
console.log(`Repo: ${repoUrl}`);
console.log(`Port: ${PORT}`);
console.log(`Binary: ${binaryPath}\n`);

await connection(
  async () => {
    const startedAt = Date.now();
    const secrets = collectSecrets();
    const previousProvisioning = await loadPreviousProvisioning();

    log(`Secrets collected: ${secrets.length}`);
    log(
      previousProvisioning
        ? "Loaded previous provisioning hint."
        : "No previous provisioning hint found.",
    );

    const tsBuilderModule = "../container-builder" + ".ts";
    const { buildContainerWithLLM } = await import(tsBuilderModule).catch(() =>
      import("../container-builder.js"),
    );

    log("1) Cloning repo...");
    const repo = dag.git(repoUrl).head().tree();

    log("2) Building container via LLM...");
    const buildStart = Date.now();
    const { container, provisioning } = await buildContainerWithLLM(repo, {
      repoUrl,
      secrets,
      port: PORT,
      goBinaryPath: binaryPath,
      previousProvisioning,
    });
    const buildSec = ((Date.now() - buildStart) / 1000).toFixed(1);
    log(`Build finished in ${buildSec}s.`);
    await saveProvisioning(provisioning);
    log(`Saved provisioning hint to ${cacheFile}.`);

    log("3) Starting service...");
    const service = container.asService();
    const servicePromise = service
      .up({ ports: [{ frontend: PORT, backend: PORT }] })
      .catch((err: any) => {
        log(`Service error: ${err.message || String(err)}`);
      });

    log("4) Waiting for readiness...");
    const readyStart = Date.now();
    let ready = false;
    const MAX_WAIT_MS = 60000;
    while (!ready && Date.now() - readyStart < MAX_WAIT_MS) {
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
              clientInfo: { name: "spike-09", version: "1.0" },
            },
          }),
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) {
          const text = await response.text();
          if (text.includes("serverInfo") && text.includes("habitat-bridge")) {
            ready = true;
          }
        }
      } catch {
        // expected while starting
      }
      if (!ready) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (!ready) {
      throw new Error("Service readiness check failed.");
    }
    const readySec = ((Date.now() - readyStart) / 1000).toFixed(1);
    log(`Service became ready in ${readySec}s.`);

    log("5) Connecting MCP client...");
    const client = new HabitatBridgeClient({
      host: "localhost",
      port: PORT,
      timeout: 5000,
      id: "spike-09",
    });
    await client.connect();
    const health = await client.health();
    const tools = await client.listTools();
    await client.disconnect();

    const totalSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `[09-fast-startup] Summary: health=${health.status}, tools=${tools.length}, total=${totalSec}s`,
    );

    // Prevent lint warning; we intentionally don't wait forever.
    void servicePromise;
  },
  { LogOutput: process.stderr },
).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  log(`Failed: ${message}`);
  process.exit(1);
});

