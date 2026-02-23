/**
 * Habitat Bridge Lifecycle Manager
 *
 * Manages Dagger container lifecycle for Habitat Bridge servers.
 * Handles creation, destruction, health monitoring, and iterative provisioning.
 */

import type { Service } from "@dagger.io/dagger";
import { HabitatBridgeClient } from "./client.js";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Logger utility for structured logging
function log(id: string, step: string, message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    component: "BridgeLifecycle",
    id,
    step,
    message,
    data,
  };
  console.log(
    `[${timestamp}] [BridgeLifecycle:${id}] [${step}] ${message}`,
    data ? JSON.stringify(data) : "",
  );
  return logEntry;
}

export interface BridgeProvisioning {
  secrets?: Array<{ name: string; value: string }>;
  /** Previous provisioning hint for the LLM container builder */
  previousProvisioning?: import("../types.js").SavedProvisioning;
}

export interface BridgeInstance {
  id: string;
  client: HabitatBridgeClient;
  service: Service;
  port: number;
  provisioning: BridgeProvisioning;
  /** Provisioning data from the LLM build (for persistence) */
  savedProvisioning?: import("../types.js").SavedProvisioning;
  createdAt: Date;
  /** Worker thread running the Dagger connection — must be terminated on destroy */
  worker: Worker;
}

export class BridgeLifecycle {
  private bridges = new Map<string, BridgeInstance>();
  private portCounter = 10000;
  private usedPorts = new Set<number>();
  private portRange = { min: 10000, max: 20000 };

  /**
   * Create a new bridge instance with the specified provisioning
   */
  async createBridge(
    id: string,
    repoUrl: string,
    provisioning: BridgeProvisioning,
    logFilePath?: string,
  ): Promise<BridgeInstance> {
    log(id, "INIT", "Creating bridge", {
      hasSecrets: !!provisioning.secrets?.length,
      hasPreviousProvisioning: !!provisioning.previousProvisioning,
      logFilePath,
    });

    // Allocate port
    const port = this.allocatePort();
    log(id, "PORT", "Allocated port", { port });

    // Start worker thread to run Dagger service in background
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const workerPath = join(__dirname, "bridge-worker.ts");

    log(id, "WORKER", "Spawning worker thread", { workerPath, logFilePath });

    // Collect secrets
    const secrets: Array<{ name: string; value: string }> = [];
    if (provisioning.secrets) {
      for (const secret of provisioning.secrets) {
        if (secret.value) {
          secrets.push(secret);
        }
      }
    }
    const worker = new Worker(workerPath, {
      workerData: {
        id,
        repoUrl,
        port,
        secrets,
        logFilePath,
        previousProvisioning: provisioning.previousProvisioning,
      },
      execArgv: ["-r", "tsx"], // Enable TypeScript support in worker
    });

    log(id, "WORKER", "Worker thread spawned, waiting for ready signal");

    // Wait for worker to signal ready or error.
    // Timeout must be longer than worker's internal 60s poll timeout so the
    // worker can report a detailed error rather than us just saying "timed out".
    const WORKER_TIMEOUT = 90000;
    log(id, "WAIT", "Waiting for worker ready", { timeoutMs: WORKER_TIMEOUT });

    let lastWorkerStep = "INIT";
    let lastWorkerMessage = "";
    let workerProvisioning: import("../types.js").SavedProvisioning | undefined;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        log(id, "TIMEOUT", "Worker startup timeout - terminating", {
          lastStep: lastWorkerStep,
          lastMessage: lastWorkerMessage,
        });
        worker.terminate();
        reject(
          new Error(
            `Worker startup timed out after ${WORKER_TIMEOUT}ms. Last step: [${lastWorkerStep}] ${lastWorkerMessage}`,
          ),
        );
      }, WORKER_TIMEOUT);

      worker.on(
        "message",
        (msg: {
          type: string;
          port?: number;
          error?: string;
          message?: string;
          step?: string;
          data?: unknown;
          provisioning?: import("../types.js").SavedProvisioning;
        }) => {
          if (msg.type === "log") {
            lastWorkerStep = msg.step || "LOG";
            lastWorkerMessage = msg.message || "";
            // Forward structured worker logs
            console.log(
              `[${new Date().toISOString()}] [Worker:${id}] [${msg.step || "LOG"}] ${msg.message}`,
              msg.data ? JSON.stringify(msg.data) : "",
            );
            return;
          }

          if (msg.type === "provisioning") {
            workerProvisioning = msg.provisioning;
            log(id, "PROVISIONING", "Worker sent provisioning data");
            return; // Don't clear timeout — still waiting for ready
          }

          clearTimeout(timeout);
          if (msg.type === "ready") {
            log(id, "READY", "Worker reports ready", { port: msg.port });
            resolve();
          } else if (msg.type === "error") {
            log(id, "ERROR", "Worker reported error", { error: msg.error });
            reject(new Error(msg.error || "Worker failed"));
          }
        },
      );

      worker.once("error", (err) => {
        log(id, "ERROR", "Worker error event", {
          error: err.message,
          stack: err.stack,
        });
        clearTimeout(timeout);
        reject(err);
      });

      worker.once("exit", (code) => {
        log(id, "EXIT", "Worker exited", {
          code,
          lastStep: lastWorkerStep,
          lastMessage: lastWorkerMessage,
        });
        clearTimeout(timeout);
        if (code !== 0) {
          reject(
            new Error(
              `Worker exited with code ${code}. Last step: [${lastWorkerStep}] ${lastWorkerMessage}`,
            ),
          );
        }
      });
    });

    // Create client
    log(id, "CLIENT", "Creating bridge client", {
      host: "localhost",
      port,
      timeout: 5000,
    });
    const client = new HabitatBridgeClient({
      host: "localhost",
      port,
      timeout: 5000,
      id, // Pass ID for logging
    });

    // Wait for service to be reachable (with retries)
    log(id, "HEALTH", "Waiting for service to be reachable", { port });
    await this.waitForServiceReady(client, id, port);

    log(id, "SUCCESS", "Bridge container ready", { port, provisioning });

    const instance: BridgeInstance = {
      id,
      client,
      service: null as any, // Service is managed by worker
      port,
      provisioning,
      savedProvisioning: workerProvisioning,
      createdAt: new Date(),
      worker,
    };

    this.bridges.set(id, instance);
    log(id, "TRACK", "Bridge instance tracked", {
      totalBridges: this.bridges.size,
    });
    return instance;
  }

  /**
   * Destroy a bridge instance
   */
  async destroyBridge(id: string): Promise<void> {
    log(id, "DESTROY", "Destroying bridge");
    const instance = this.bridges.get(id);
    if (!instance) {
      log(id, "DESTROY", "Bridge not found, nothing to destroy");
      return;
    }

    // Disconnect client
    log(id, "DESTROY", "Disconnecting client");
    await instance.client.disconnect();

    // Terminate the worker thread — this kills the Dagger connection,
    // which stops the container and frees the port
    log(id, "DESTROY", "Terminating worker thread");
    await instance.worker.terminate();
    log(id, "DESTROY", "Worker thread terminated");

    // Wait for the port to actually free up after the worker/container dies
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Release port immediately (no delayed release needed — worker is dead)
    this.usedPorts.delete(instance.port);
    log(id, "DESTROY", "Port released", { port: instance.port });

    // Remove from tracking
    this.bridges.delete(id);
    log(id, "DESTROY", "Bridge removed from tracking", {
      remainingBridges: this.bridges.size,
    });
  }

  /**
   * Check if a bridge is healthy
   */
  async isHealthy(id: string): Promise<boolean> {
    log(id, "HEALTH", "Checking bridge health");
    const instance = this.bridges.get(id);
    if (!instance) {
      log(id, "HEALTH", "Bridge not found");
      return false;
    }

    try {
      const health = await instance.client.health();
      const isHealthy = health.status === "healthy";
      log(
        id,
        "HEALTH",
        `Health check result: ${isHealthy ? "healthy" : "unhealthy"}`,
        { status: health.status },
      );
      return isHealthy;
    } catch (err: any) {
      log(id, "HEALTH", "Health check failed", { error: err.message });
      return false;
    }
  }

  /**
   * Get logs from a bridge
   */
  async getLogs(id: string, lines?: number): Promise<string[]> {
    log(id, "LOGS", "Getting bridge logs", { lines });
    const instance = this.bridges.get(id);
    if (!instance) {
      log(id, "LOGS", "Bridge not found");
      return [];
    }

    try {
      const logs = await instance.client.getLogs(lines);
      log(id, "LOGS", `Retrieved ${logs.length} log lines`);
      return logs;
    } catch {
      return [];
    }
  }

  /**
   * List all active bridges
   */
  listBridges(): BridgeInstance[] {
    return Array.from(this.bridges.values());
  }

  /**
   * Recreate a bridge with new provisioning
   */
  async recreateBridge(
    id: string,
    repoUrl: string,
    newProvisioning: BridgeProvisioning,
  ): Promise<BridgeInstance> {
    // Destroy old bridge
    await this.destroyBridge(id);

    // Create new bridge
    return this.createBridge(id, repoUrl, newProvisioning);
  }

  private allocatePort(): number {
    // Find next available port in range
    for (let port = this.portRange.min; port <= this.portRange.max; port++) {
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }
    throw new Error(
      `No available ports in range ${this.portRange.min}-${this.portRange.max}`,
    );
  }

  releasePort(port: number): void {
    // Delay release so old Dagger containers have time to fully release the port
    setTimeout(() => this.usedPorts.delete(port), 5000);
  }

  private async waitForServiceReady(
    client: HabitatBridgeClient,
    id: string,
    port: number,
  ): Promise<void> {
    const maxRetries = 30;
    const delayMs = 1000; // Increased delay for Dagger service startup
    console.log(
      `[BridgeLifecycle:${id}] Waiting for service health check on port ${port}...`,
    );

    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(
          `[BridgeLifecycle:${id}] Health check attempt ${i + 1}/${maxRetries}...`,
        );
        await client.connect();
        console.log(
          `[BridgeLifecycle:${id}] Client connected, checking health...`,
        );
        const health = await client.health();
        console.log(`[BridgeLifecycle:${id}] Health status: ${health.status}`);
        if (health.status === "healthy") {
          console.log(`[BridgeLifecycle:${id}] Service is healthy!`);
          return;
        }
      } catch (err: any) {
        // Expected while service starts up
        console.log(
          `[BridgeLifecycle:${id}] Health check failed: ${err.message || String(err)}`,
        );
      }
      console.log(
        `[BridgeLifecycle:${id}] Waiting ${delayMs}ms before retry...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error(
      `Bridge ${id} failed to become ready after ${maxRetries} retries`,
    );
  }
}
