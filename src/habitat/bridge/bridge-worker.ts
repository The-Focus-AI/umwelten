/**
 * Bridge Worker Thread
 *
 * Runs the Dagger bridge service in a separate thread so it doesn't block the CLI.
 * Uses dag.llm() to build the container (reads repo, picks base image, installs deps).
 * Falls back to heuristic build if LLM fails.
 */

import { parentPort, workerData } from "worker_threads";
import { dag, connection } from "@dagger.io/dagger";
import { existsSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { buildContainerFromRepo } from "./container-builder.ts";
import type { SavedProvisioning } from "../types.js";

interface WorkerData {
  id: string;
  repoUrl: string;
  port: number;
  secrets?: Array<{ name: string; value: string }>;
  logFilePath?: string;
  /** Previous provisioning hint for the LLM */
  previousProvisioning?: SavedProvisioning;
}

const {
  id,
  repoUrl,
  port,
  secrets = [],
  logFilePath,
  previousProvisioning,
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
  port,
});

connection(
  async () => {
    // Find the Go MCP server binary
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

    log("BUILD", "Building container from repo via LLM + fallback", {
      repoUrl,
      binaryPath,
      hasSecrets: secrets.length > 0,
      hasPreviousProvisioning: !!previousProvisioning,
    });

    // Build the container (LLM tries first, falls back to heuristics)
    const { container, provisioning } = await buildContainerFromRepo({
      repoUrl,
      secrets,
      port,
      goBinaryPath: binaryPath,
      previousProvisioning,
    });

    log("BUILD", "Container built", {
      baseImage: provisioning.baseImage,
      buildSteps: provisioning.buildSteps,
    });

    // Send provisioning back to parent for persistence
    parentPort?.postMessage({
      type: "provisioning",
      provisioning,
    });

    // Validate the container
    log("VALIDATE", "Executing pipeline to validate container setup...");
    try {
      const validateOutput = await container
        .withExec([
          "sh",
          "-c",
          "file /opt/bridge/bridge-server && ls /workspace/ | head -5",
        ])
        .stdout();
      log("VALIDATE", "Container setup validated", {
        output: validateOutput.trim(),
      });
    } catch (validateErr: any) {
      const msg = validateErr.message || String(validateErr);
      log("VALIDATE", "Container setup FAILED", { error: msg });
      throw new Error(`Container validation failed: ${msg}`);
    }

    // Start the service (entrypoint is already set by container-builder)
    log("SERVICE", "Starting Dagger service", { port });
    const service = container.asService();

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

    // Poll until service is actually reachable
    const MAX_WAIT_MS = 60000;
    const POLL_INTERVAL = 500;
    const startTime = Date.now();
    let isReady = false;
    let lastPollError = "";

    log("WAIT", `Polling for service readiness (max ${MAX_WAIT_MS}ms)`, {
      url: `http://localhost:${port}/mcp`,
    });

    while (!isReady && Date.now() - startTime < MAX_WAIT_MS) {
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
          if (
            text.includes("serverInfo") &&
            text.includes("habitat-bridge")
          ) {
            isReady = true;
            log("WAIT", "Service is healthy and reachable!", {
              elapsedMs: Date.now() - startTime,
            });
          } else {
            lastPollError = `Unexpected response (status ${response.status}): ${text.slice(0, 200)}`;
          }
        } else {
          lastPollError = `HTTP ${response.status}: ${response.statusText}`;
        }
      } catch (pollErr: any) {
        lastPollError = pollErr.message || String(pollErr);
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

    // Signal ready to parent
    log("SIGNAL", "Signaling ready to parent", { port });
    parentPort?.postMessage({ type: "ready", port });

    // Keep worker alive by waiting for the service promise
    log("KEEPALIVE", "Entering keep-alive state (waiting for service)");
    await servicePromise;
    log("KEEPALIVE", "Service promise resolved (container stopped)");
  },
  { LogOutput: process.stderr },
).catch((err: any) => {
  log("FATAL", "Worker failed", { error: err.message || String(err) });
  parentPort?.postMessage({
    type: "error",
    error: err.message || String(err),
  });
  process.exit(1);
});
