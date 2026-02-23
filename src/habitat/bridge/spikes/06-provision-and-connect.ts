#!/usr/bin/env npx tsx
/**
 * Spike 06: Deterministic provisioning (from spike 02) + MCP service startup/connect.
 *
 * This avoids LLM provisioning and instead uses explicit container steps:
 * - Start from node:lts
 * - Install Claude CLI
 * - Copy target repo to /workspace
 * - Add bridge server binary and start it as a service
 * - Connect with HabitatBridgeClient and verify health/tools/files
 *
 * Usage:
 *   dotenvx run -- npx tsx src/habitat/bridge/spikes/06-provision-and-connect.ts [repo-url]
 */

import { dag, connection } from "@dagger.io/dagger";
import { HabitatBridgeClient } from "../client.ts";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoUrl =
  process.argv[2] || "https://github.com/The-Focus-AI/trmnl-image-agent";
const PORT = 18081;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const binaryPath = join(__dirname, "..", "go-server", "bridge-server-linux");

if (!existsSync(binaryPath)) {
  console.error(`❌ Go binary not found at ${binaryPath}`);
  process.exit(1);
}

const log = (message: string) => {
  console.log(`[06-provision-and-connect] ${message}`);
};

function withClaudeAuthEnv(
  container: ReturnType<typeof dag.container>,
): ReturnType<typeof dag.container> {
  let next = container;
  const authEnvNames = [
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_API_KEY",
  ] as const;

  for (const envName of authEnvNames) {
    const value = process.env[envName];
    if (value && value.trim() !== "") {
      log(`Forwarding ${envName} into container as secret.`);
      next = next.withSecretVariable(envName, dag.setSecret(envName, value));
    }
  }

  return next;
}

// Keep Dagger progress readable in this terminal.
process.env.DAGGER_PROGRESS ??= "plain";

console.log(`\n=== Spike 06: Provision + Connect ===`);
console.log(`Repo: ${repoUrl}`);
console.log(`Port: ${PORT}`);
console.log(`Binary: ${binaryPath}\n`);

await connection(
  async () => {
    log("1) Cloning repo tree...");
    const repo = dag.git(repoUrl).head().tree();

    log("2) Building deterministic container from node:lts...");
    let container = dag
      .container()
      .from("node:lts")
      .withExec(["sh", "-lc", "node --version && npm --version"]);

    container = withClaudeAuthEnv(container);

    container = container
      .withExec([
        "sh",
        "-lc",
        "node -e \"fetch('https://claude.ai/install.sh').then(r=>r.text()).then(t=>require('node:fs').writeFileSync('/tmp/install-claude.sh', t))\"",
      ])
      .withExec(["sh", "-lc", "bash /tmp/install-claude.sh"])
      .withExec([
        "sh",
        "-lc",
        "if [ -x /root/.local/bin/claude ]; then ln -sf /root/.local/bin/claude /usr/local/bin/claude; fi; if [ -x /home/node/.local/bin/claude ]; then ln -sf /home/node/.local/bin/claude /usr/local/bin/claude; fi",
      ]);

    log("3) Wiring workspace + bridge binary + service entrypoint...");
    const hostBinary = dag.host().file(binaryPath);
    container = container
      .withDirectory("/workspace", repo)
      .withWorkdir("/workspace")
      .withExec(["mkdir", "-p", "/opt/bridge"])
      .withFile("/opt/bridge/bridge-server", hostBinary, { permissions: 0o755 })
      .withExposedPort(PORT)
      .withEntrypoint(["/opt/bridge/bridge-server", "--port", String(PORT)]);

    log("4) Quick sanity check (node + claude version)...");
    const sanity = await container
      .withExec([
        "sh",
        "-c",
        "echo '=== node ===' && node --version && echo '=== claude ===' && (claude --version || /root/.local/bin/claude --version || /home/node/.local/bin/claude --version || echo 'claude: MISSING')",
      ])
      .stdout();
    console.log(sanity);

    log("5) Starting service...");
    const service = container.asService();
    const servicePromise = service
      .up({ ports: [{ frontend: PORT, backend: PORT }] })
      .catch((err: any) => {
        log(`Service error: ${err.message || String(err)}`);
      });

    log("6) Waiting for /mcp readiness...");
    const MAX_WAIT = 30000;
    const POLL_INTERVAL = 1000;
    const startPoll = Date.now();
    let ready = false;
    let lastError = "";

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
              clientInfo: { name: "spike-06", version: "1.0" },
            },
          }),
          signal: AbortSignal.timeout(2000),
        });

        if (response.ok) {
          const text = await response.text();
          if (text.includes("serverInfo") && text.includes("habitat-bridge")) {
            ready = true;
            log(
              `Service ready after ${((Date.now() - startPoll) / 1000).toFixed(1)}s.`,
            );
          } else {
            lastError = `Unexpected initialize payload: ${text.slice(0, 200)}`;
          }
        } else {
          lastError = `HTTP ${response.status}: ${response.statusText}`;
        }
      } catch (err: any) {
        lastError = err.message || String(err);
      }

      if (!ready) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      }
    }

    if (!ready) {
      throw new Error(
        `Service did not become ready in ${MAX_WAIT}ms. Last error: ${lastError}`,
      );
    }

    log("7) Connecting MCP client...");
    const client = new HabitatBridgeClient({
      host: "localhost",
      port: PORT,
      timeout: 5000,
      id: "spike-06",
    });
    await client.connect();

    log("8) Verifying health + tools + workspace...");
    const health = await client.health();
    console.log(`Health: ${health.status}`);

    const tools = await client.listTools();
    console.log(`Tools: ${tools.length}`);

    const files = await client.listDirectory("/workspace");
    console.log(`Workspace entries: ${files.length}`);

    await client.disconnect();
    log("9) Client disconnected. Spike complete.");

    // Keep lint happy and avoid "unused promise"; no need to await forever.
    void servicePromise;
  },
  { LogOutput: process.stderr },
).catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  log(`Failed: ${msg}`);
  process.exit(1);
});

