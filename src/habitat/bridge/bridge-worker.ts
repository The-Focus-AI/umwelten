/**
 * Bridge Worker Thread
 *
 * Runs the Dagger bridge service in a separate thread so it doesn't block the CLI.
 * Uses a pre-compiled Go binary for the MCP server (fast startup, zero dependencies).
 */

import { parentPort, workerData } from "worker_threads";
import { dag, connection } from "@dagger.io/dagger";
import { existsSync, appendFileSync } from "fs";
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

// Structured logging to parent thread and file.
// Uses synchronous appendFileSync so logs survive worker termination.
const log = (step: string, message: string, data?: unknown) => {
  const timestamp = new Date().toISOString();
  parentPort?.postMessage({ type: "log", step, message, data });
  const logLine = `[${timestamp}] [BridgeWorker:${id}] [${step}] ${message}${data ? " " + JSON.stringify(data) : ""}\n`;
  console.log(logLine.trim());
  if (logFilePath) {
    try {
      appendFileSync(logFilePath, logLine);
    } catch {
      // Ignore write errors — don't crash the worker over logging
    }
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

    // Step 2: Install apt packages (cacheable — no secrets yet)
    if (aptPackages.length > 0) {
      log("APT", "Installing apt packages", { packages: aptPackages });
      container = container.withExec([
        "sh",
        "-c",
        "apt-get update && apt-get install -y " + aptPackages.join(" "),
      ]);
      log("APT", "Apt packages installed", { count: aptPackages.length });
    }

    // Step 3: Run setup commands BEFORE secrets/clone (cacheable layer)
    // This includes things like `curl ... | bash` for claude-code install.
    // Must come before secrets injection so Dagger can cache the result.
    if (setupCommands.length > 0) {
      log("SETUP", `Running ${setupCommands.length} setup command(s)`);
      for (const cmd of setupCommands) {
        log("SETUP", `Executing: ${cmd}`);
        container = container.withExec(["sh", "-c", cmd]);
      }
      log("SETUP", "Setup commands completed");
    }

    // Step 4: Mount cache volumes for expensive installs
    // npm cache survives across container rebuilds
    container = container.withMountedCache(
      "/root/.npm",
      dag.cacheVolume("bridge-npm-cache"),
    );

    // Step 5: Setup bridge server using pre-compiled Go binary
    log("SERVER", "Setting up Go MCP server binary", { port });

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const possibleBinaryPaths = [
      join(__dirname, "go-server", "bridge-server-linux"),
      join(process.cwd(), "src/habitat/bridge/go-server/bridge-server-linux"),
    ];

    let binaryPath: string | null = null;
    for (const path of possibleBinaryPaths) {
      if (existsSync(path)) {
        binaryPath = path;
        break;
      }
    }

    if (!binaryPath) {
      throw new Error(
        `Could not find bridge-server-linux binary. Tried: ${possibleBinaryPaths.join(", ")}`,
      );
    }

    log("SERVER", "Mounting Go binary from host", { path: binaryPath });
    const hostBinary = dag.host().file(binaryPath);

    // Mount binary into container with execute permissions
    container = container
      .withExec(["mkdir", "-p", "/opt/bridge"])
      .withFile("/opt/bridge/bridge-server", hostBinary, { permissions: 0o755 });

    // Step 6: Inject secrets LATE — after all cacheable layers
    // Secrets invalidate Dagger layer cache, so everything before this is cached.
    if (secrets.length > 0) {
      log("SECRETS", "Injecting secrets into container", {
        count: secrets.length,
        names: secrets.map((s) => s.name),
      });
      for (const secret of secrets) {
        const secretVal = dag.setSecret(secret.name, secret.value);
        container = container.withSecretVariable(secret.name, secretVal);
      }
      log("SECRETS", "Secrets injected securely");
    }

    // Step 7: Clone the repo (needs secrets for private repos via GITHUB_TOKEN)
    log("GIT", "Cloning repository", { repoUrl, target: "/workspace" });
    container = container.withExec([
      "git",
      "clone",
      "--depth",
      "1",
      repoUrl,
      "/workspace",
    ]);

    // Step 4.5: Force-execute the pipeline to validate everything works.
    // Dagger is lazy — without this, errors in mount/clone only surface
    // when the service starts, making them hard to debug.
    log("VALIDATE", "Executing pipeline to validate container setup...");
    try {
      const validateOutput = await container
        .withExec(["sh", "-c", "file /opt/bridge/bridge-server && ls /workspace/ | head -5"])
        .stdout();
      log("VALIDATE", "Container setup validated", { output: validateOutput.trim() });
    } catch (validateErr: any) {
      const msg = validateErr.message || String(validateErr);
      log("VALIDATE", "Container setup FAILED", { error: msg });
      // Try to get more details about what went wrong
      try {
        const stderr = await container.withExec(["sh", "-c", "ls -la /opt/bridge/ 2>&1; ls /workspace/ 2>&1 || true"]).stdout();
        log("VALIDATE", "Debug info", { output: stderr.trim() });
      } catch { /* ignore */ }
      throw new Error(`Container validation failed: ${msg}`);
    }

    // Step 5: Setup service
    log("SERVICE", "Configuring Dagger service", { port });
    container = container.withExposedPort(port);

    const service = container
      .withEntrypoint(["/opt/bridge/bridge-server", "--port", String(port)])
      .asService();
    log("SERVICE", "Starting Dagger service", {
      portMapping: { frontend: port, backend: port },
    });

    // Step 6: Start service in background (non-blocking) so we can poll for readiness
    let serviceError: string | null = null;
    const servicePromise = service
      .up({ ports: [{ frontend: port, backend: port }] })
      .then(() => {
        log("SERVICE", "Service stopped (this is expected after signal)");
      })
      .catch((err: any) => {
        serviceError = err.message || String(err);
        log("ERROR", "Service failed", { error: serviceError });
        parentPort?.postMessage({ type: "error", error: serviceError });
      });

    // Step 7: Poll until service is actually reachable
    const MAX_WAIT_MS = 60000;
    const POLL_INTERVAL = 500;
    const startTime = Date.now();
    let isReady = false;
    let lastPollError = "";

    log("WAIT", `Polling for service readiness (max ${MAX_WAIT_MS}ms)`, {
      url: `http://localhost:${port}/mcp`,
    });

    while (!isReady && Date.now() - startTime < MAX_WAIT_MS) {
      // If the service already crashed, stop polling immediately
      if (serviceError) {
        throw new Error(`Service crashed during startup: ${serviceError}`);
      }

      try {
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
          signal: AbortSignal.timeout(2000),
        });

        if (response.ok) {
          const text = await response.text();
          if (text.includes("serverInfo") && text.includes("habitat-bridge")) {
            isReady = true;
            log("WAIT", "Service is healthy and reachable!", {
              elapsedMs: Date.now() - startTime,
            });
          } else {
            lastPollError = `Unexpected response (status ${response.status}): ${text.slice(0, 200)}`;
            log("WAIT", "Got response but not MCP initialize", { status: response.status, body: text.slice(0, 200) });
          }
        } else {
          lastPollError = `HTTP ${response.status}: ${response.statusText}`;
        }
      } catch (pollErr: any) {
        lastPollError = pollErr.message || String(pollErr);
        // Only log every 5s to reduce noise
        if ((Date.now() - startTime) % 5000 < POLL_INTERVAL) {
          log("WAIT", "Poll attempt failed (expected during startup)", {
            error: lastPollError,
            elapsedMs: Date.now() - startTime,
          });
        }
      }

      if (!isReady) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      }
    }

    if (!isReady) {
      throw new Error(
        `Service failed to become ready after ${MAX_WAIT_MS}ms. Last poll error: ${lastPollError}`,
      );
    }

    // Step 8: Signal ready to parent
    log("SIGNAL", "Signaling ready to parent", { port });
    parentPort?.postMessage({ type: "ready", port });
    log("SIGNAL", "Ready signal sent to parent");

    // Step 9: Keep worker alive by waiting for the service promise
    log("KEEPALIVE", "Entering keep-alive state (waiting for service)");
    await servicePromise;
    log("KEEPALIVE", "Service promise resolved (container stopped)");
  },
  { LogOutput: process.stderr },
).catch((err: any) => {
  log("FATAL", "Worker failed", { error: err.message || String(err) });
  parentPort?.postMessage({ type: "error", error: err.message || String(err) });
  process.exit(1);
});
