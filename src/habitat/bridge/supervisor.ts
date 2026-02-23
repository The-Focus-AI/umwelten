/**
 * Bridge Supervisor
 *
 * Manages the full lifecycle of a bridge container for one agent:
 * build → health loop → rebuild on failure.
 *
 * Build: Uses BridgeAgent which calls dag.llm() to build the container.
 * Health: Simple HTTP poll to MCP health endpoint every 10 seconds.
 * Rebuild: Tear down old container, build from scratch.
 */

import { join } from "node:path";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { BridgeAgent, type BridgeAgentConfig } from "./agent.js";
import { HabitatBridgeClient } from "./client.js";
import type { SavedProvisioning } from "../types.js";
import type { SupervisorState, SupervisorStatus } from "./state.js";

export interface SupervisorConfig {
  agentId: string;
  repoUrl: string;
  secrets: Array<{ name: string; value: string }>;
  /** Directory for persisting state: agents/{id}/ */
  stateDir: string;
  /** Log file path */
  logFilePath?: string;
  /** Previous provisioning hint */
  savedProvisioning?: SavedProvisioning;
  /** Health check interval in ms (default: 10000) */
  healthCheckIntervalMs?: number;
  /** Max consecutive health check failures before rebuild (default: 3) */
  maxConsecutiveFailures?: number;
  /** Max total build attempts before giving up (default: 3) */
  maxBuildAttempts?: number;
}

function log(id: string, message: string, data?: unknown) {
  const ts = new Date().toISOString();
  console.log(
    `[${ts}] [Supervisor:${id}] ${message}`,
    data ? JSON.stringify(data) : "",
  );
}

export class BridgeSupervisor {
  private config: SupervisorConfig;
  private bridgeAgent: BridgeAgent | null = null;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private state: SupervisorState;
  private stopping = false;

  constructor(config: SupervisorConfig) {
    this.config = config;
    this.state = {
      agentId: config.agentId,
      status: "stopped",
      buildAttempts: 0,
      maxBuildAttempts: config.maxBuildAttempts ?? 3,
      consecutiveFailures: 0,
    };
  }

  /**
   * Start the supervisor: build container + start health monitoring.
   */
  async start(): Promise<void> {
    if (this.state.status === "running" || this.state.status === "building") {
      log(this.config.agentId, "Already running or building, skipping start");
      return;
    }

    this.stopping = false;
    await this.build();

    if (this.state.status === "running") {
      this.startHealthLoop();
    } else if (this.state.status === "error") {
      throw new Error(
        this.state.lastError || `Build failed after ${this.state.buildAttempts} attempts`,
      );
    }
  }

  /**
   * Stop the supervisor: teardown container, stop health monitoring.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    this.stopHealthLoop();

    if (this.bridgeAgent) {
      try {
        await this.bridgeAgent.destroy();
      } catch (err: any) {
        log(this.config.agentId, "Error destroying bridge agent", {
          error: err.message,
        });
      }
      this.bridgeAgent = null;
    }

    await this.setState("stopped", { stoppedAt: new Date().toISOString() });
  }

  /**
   * Get the current state.
   */
  getState(): SupervisorState {
    return { ...this.state };
  }

  /**
   * Get the port the bridge is listening on.
   */
  getPort(): number | undefined {
    return this.state.port;
  }

  /**
   * Get the underlying BridgeAgent (for client access).
   */
  getBridgeAgent(): BridgeAgent | null {
    return this.bridgeAgent;
  }

  /**
   * Get the client to the bridge MCP server.
   */
  async getClient(): Promise<HabitatBridgeClient | null> {
    if (!this.bridgeAgent) return null;
    try {
      return await this.bridgeAgent.getClient();
    } catch {
      return null;
    }
  }

  // ── Build ──────────────────────────────────────────────────────────

  private async build(): Promise<void> {
    if (this.state.buildAttempts >= this.state.maxBuildAttempts) {
      log(this.config.agentId, "Max build attempts reached, giving up", {
        attempts: this.state.buildAttempts,
        max: this.state.maxBuildAttempts,
      });
      await this.setState("error", {
        lastError: `Failed after ${this.state.buildAttempts} build attempts`,
      });
      return;
    }

    this.state.buildAttempts++;
    await this.setState("building");

    log(this.config.agentId, "Building container", {
      attempt: this.state.buildAttempts,
      max: this.state.maxBuildAttempts,
    });

    try {
      // Destroy any existing bridge
      if (this.bridgeAgent) {
        try {
          await this.bridgeAgent.destroy();
        } catch {
          // ignore
        }
        this.bridgeAgent = null;
      }

      const agentConfig: BridgeAgentConfig = {
        id: this.config.agentId,
        repoUrl: this.config.repoUrl,
        secrets:
          this.config.secrets.length > 0 ? this.config.secrets : undefined,
        savedProvisioning:
          this.state.provisioning ?? this.config.savedProvisioning,
      };

      this.bridgeAgent = new BridgeAgent(agentConfig);
      await this.bridgeAgent.start({
        logFilePath: this.config.logFilePath,
      });

      const port = this.bridgeAgent.getPort();
      const provisioning = this.bridgeAgent.getSavedProvisioning();

      await this.setState("running", {
        port,
        startedAt: new Date().toISOString(),
        consecutiveFailures: 0,
        provisioning: provisioning ?? this.state.provisioning,
      });

      log(this.config.agentId, "Container running", { port });
    } catch (err: any) {
      log(this.config.agentId, "Build failed", { error: err.message });
      // Null out the failed bridge agent so getBridgeAgent() doesn't return an unstarted one
      this.bridgeAgent = null;
      await this.setState("error", {
        lastError: err.message,
      });

      // Retry if we haven't hit max
      if (this.state.buildAttempts < this.state.maxBuildAttempts && !this.stopping) {
        log(this.config.agentId, "Retrying build...");
        await this.build();
      }
    }
  }

  // ── Health Loop ────────────────────────────────────────────────────

  private startHealthLoop(): void {
    const intervalMs = this.config.healthCheckIntervalMs ?? 10000;
    const maxFailures = this.config.maxConsecutiveFailures ?? 3;

    log(this.config.agentId, "Starting health loop", {
      intervalMs,
      maxFailures,
    });

    this.healthCheckTimer = setInterval(async () => {
      if (this.stopping || this.state.status !== "running") return;

      const healthy = await this.checkHealth();
      this.state.lastHealthCheck = new Date().toISOString();

      if (healthy) {
        if (this.state.consecutiveFailures > 0) {
          log(this.config.agentId, "Health restored");
          this.state.consecutiveFailures = 0;
          await this.setState("running");
        }
      } else {
        this.state.consecutiveFailures++;
        log(this.config.agentId, "Health check failed", {
          consecutiveFailures: this.state.consecutiveFailures,
          maxFailures,
        });

        if (this.state.consecutiveFailures >= maxFailures) {
          log(
            this.config.agentId,
            "Container is dead, initiating rebuild",
          );
          await this.rebuild();
        } else {
          await this.setState("unhealthy");
        }
      }
    }, intervalMs);
  }

  private stopHealthLoop(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private async checkHealth(): Promise<boolean> {
    const port = this.state.port;
    if (!port) return false;

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
            clientInfo: { name: "supervisor-health", version: "1.0" },
          },
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const text = await response.text();
        return text.includes("serverInfo") && text.includes("habitat-bridge");
      }
      return false;
    } catch {
      return false;
    }
  }

  // ── Rebuild ────────────────────────────────────────────────────────

  private async rebuild(): Promise<void> {
    if (this.stopping) return;

    this.stopHealthLoop();
    await this.setState("rebuilding");

    log(this.config.agentId, "Rebuilding container from scratch");

    await this.build();

    if (this.state.status === "running") {
      this.startHealthLoop();
    }
  }

  // ── State Persistence ──────────────────────────────────────────────

  private async setState(
    status: SupervisorStatus,
    updates?: Partial<SupervisorState>,
  ): Promise<void> {
    this.state.status = status;
    if (updates) {
      Object.assign(this.state, updates);
    }
    await this.persistState();
  }

  private async persistState(): Promise<void> {
    try {
      await mkdir(this.config.stateDir, { recursive: true });
      const statePath = join(this.config.stateDir, "supervisor.json");
      await writeFile(statePath, JSON.stringify(this.state, null, 2), "utf-8");
    } catch (err: any) {
      log(this.config.agentId, "Failed to persist state", {
        error: err.message,
      });
    }
  }

  /**
   * Load persisted state from disk.
   */
  static async loadState(stateDir: string): Promise<SupervisorState | null> {
    try {
      const statePath = join(stateDir, "supervisor.json");
      const data = await readFile(statePath, "utf-8");
      return JSON.parse(data) as SupervisorState;
    } catch {
      return null;
    }
  }
}
