/**
 * Bridge Worker Thread
 *
 * Runs the Dagger bridge service in a separate thread so it doesn't block the CLI.
 * Uses the TypeScript MCP server with official @modelcontextprotocol/sdk.
 */

import { parentPort, workerData } from "worker_threads";
import { dag, connection } from "@dagger.io/dagger";
import { readFileSync, existsSync } from "fs";
import { createWriteStream } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

interface WorkerData {
  id: string;
  repoUrl: string;
  baseImage: string;
  port: number;
  aptPackages?: string[];
  secrets?: Array<{ name: string; value: string }>; // Secrets passed securely
  setupCommands?: string[]; // Commands to run after apt install
  logFilePath?: string; // Path to write logs to
}

const {
  id,
  repoUrl,
  baseImage,
  port,
  aptPackages = [],
  secrets = [],
  setupCommands = [],
  logFilePath,
} = workerData as WorkerData;

// Create log file stream if path provided
const logStream = logFilePath
  ? createWriteStream(logFilePath, { flags: "a" })
  : null;

// Structured logging to parent thread and file
const log = (step: string, message: string, data?: unknown) => {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, step, message, data };
  parentPort?.postMessage({ type: "log", step, message, data });
  const logLine = `[${timestamp}] [BridgeWorker:${id}] [${step}] ${message}${data ? " " + JSON.stringify(data) : ""}\n`;
  console.log(logLine.trim());
  // Also write to log file
  if (logStream) {
    logStream.write(logLine);
  }
};

log("INIT", "Bridge worker starting", {
  id,
  repoUrl,
  baseImage,
  port,
  aptPackages,
});

connection(
  async () => {
    log("CONTAINER", "Starting container build", { baseImage });

    // Step 1: Get base container
    log("CONTAINER", "Pulling base image", { baseImage });
    let container = dag.container().from(baseImage);
    log("CONTAINER", "Base image pulled");

    // Step 2: Install apt packages if needed (MUST happen before git clone)
    if (aptPackages.length > 0) {
      log("APT", "Installing apt packages", { packages: aptPackages });
      container = container.withExec([
        "sh",
        "-c",
        "apt-get update && apt-get install -y " + aptPackages.join(" "),
      ]);
      log("APT", "Apt packages installed", { count: aptPackages.length });
    }

    // Step 2.5: Inject secrets into container securely
    if (secrets.length > 0) {
      log("SECRETS", "Injecting secrets into container", {
        count: secrets.length,
        names: secrets.map((s) => s.name),
      });
      for (const secret of secrets) {
        // Use Dagger's secret API to securely pass secrets without exposing in logs
        const secretVal = dag.setSecret(secret.name, secret.value);
        container = container.withSecretVariable(secret.name, secretVal);
      }
      log("SECRETS", "Secrets injected securely");
    }

    // Step 2.6: Run setup commands (npm install, custom scripts)
    if (setupCommands.length > 0) {
      log("SETUP", `Running ${setupCommands.length} setup command(s)`);
      for (const cmd of setupCommands) {
        log("SETUP", `Executing: ${cmd}`);
        container = container.withExec(["sh", "-c", cmd]);
      }
      log("SETUP", "Setup commands completed");
    }

    // Step 3: Setup bridge server files using TypeScript MCP server
    log("SERVER", "Setting up TypeScript MCP server", { port });

    // Find the server.ts file
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const possibleServerPaths = [
      join(__dirname, "server.ts"),
      join(process.cwd(), "src/habitat/bridge/server.ts"),
    ];

    let serverPath: string | null = null;
    for (const path of possibleServerPaths) {
      if (existsSync(path)) {
        serverPath = path;
        break;
      }
    }

    if (!serverPath) {
      throw new Error(
        `Could not find bridge server.ts. Tried: ${possibleServerPaths.join(", ")}`,
      );
    }

    log("SERVER", "Reading server file", { path: serverPath });
    const serverCode = readFileSync(serverPath, "utf-8");

    // Copy server code into container
    container = container
      .withExec(["mkdir", "-p", "/opt/bridge"])
      .withNewFile("/opt/bridge/server.ts", serverCode);

    // Install Node.js dependencies for MCP server
    log("SERVER", "Installing MCP SDK dependencies");
    container = container.withExec([
      "sh",
      "-c",
      "cd /opt/bridge && npm init -y && npm install @modelcontextprotocol/sdk zod typescript tsx --save",
    ]);
    log("SERVER", "Dependencies installed");

    // Step 4: Clone the repo
    log("GIT", "Cloning repository", { repoUrl, target: "/workspace" });
    container = container.withExec([
      "git",
      "clone",
      "--depth",
      "1",
      repoUrl,
      "/workspace",
    ]);
    log("GIT", "Repository cloned");

    // Step 5: Setup service
    log("SERVICE", "Configuring Dagger service", { port });
    container = container.withExposedPort(port);
    log("SERVICE", "Port exposed", { port });

    const service = container
      .withEntrypoint(["npx", "tsx", "/opt/bridge/server.ts", `--port=${port}`])
      .asService();
    log("SERVICE", "Service created from container");

    // Step 6: Start service in background (non-blocking) so we can signal when ready
    log("SERVICE", "Starting Dagger service (non-blocking)", {
      portMapping: { frontend: port, backend: port },
    });
    const servicePromise = service
      .up({ ports: [{ frontend: port, backend: port }] })
      .then(() => {
        log("SERVICE", "Service stopped (this is expected after signal)");
      })
      .catch((err: any) => {
        log("ERROR", "Service failed to start", {
          error: err.message || String(err),
        });
        parentPort?.postMessage({
          type: "error",
          error: err.message || String(err),
        });
      });

    // Step 7: Poll until service is actually reachable
    const MAX_WAIT_MS = 60000; // 60 seconds max
    const POLL_INTERVAL = 500; // Check every 500ms
    const startTime = Date.now();
    let isReady = false;

    log("WAIT", `Polling for service readiness (max ${MAX_WAIT_MS}ms)`, {
      url: `http://localhost:${port}/mcp`,
    });

    while (!isReady && Date.now() - startTime < MAX_WAIT_MS) {
      try {
        // Try to connect with proper MCP initialize request
        const response = await fetch(`http://localhost:${port}/mcp`, {
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
              clientInfo: { name: "health-check", version: "1.0" },
            },
          }),
          signal: AbortSignal.timeout(1000),
        });

        if (response.ok) {
          const text = await response.text();
          // Check if response contains a successful initialize result
          if (text.includes("serverInfo") && text.includes("habitat-bridge")) {
            isReady = true;
            log("WAIT", "Service is healthy and reachable!", {
              elapsedMs: Date.now() - startTime,
            });
          }
        }
      } catch {
        // Expected while service starts up
      }

      if (!isReady) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      }
    }

    if (!isReady) {
      throw new Error(`Service failed to become ready after ${MAX_WAIT_MS}ms`);
    }

    // Step 8: Signal ready to parent
    log("SIGNAL", "Signaling ready to parent", { port });
    parentPort?.postMessage({ type: "ready", port });
    log("SIGNAL", "Ready signal sent to parent");

    // Step 9: Keep worker alive by waiting for the service promise
    log("KEEPALIVE", "Entering keep-alive state (waiting for service)");
    await servicePromise;
    log("KEEPALIVE", "Service promise resolved (container stopped)");

    // Close log stream
    if (logStream) {
      logStream.end();
    }
  },
  { LogOutput: process.stderr },
).catch((err: any) => {
  log("FATAL", "Worker failed", { error: err.message || String(err) });
  parentPort?.postMessage({ type: "error", error: err.message || String(err) });
  // Close log stream on error
  if (logStream) {
    logStream.end();
  }
  process.exit(1);
});
