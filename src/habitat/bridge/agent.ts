/**
 * Habitat Bridge Agent
 *
 * Manages an agent's lifecycle using the Habitat Bridge architecture.
 * Simple: start() creates the container (LLM picks base image + installs deps).
 * The supervisor monitors and rebuilds when things break.
 */

import { BridgeLifecycle, BridgeProvisioning } from "./lifecycle.js";
import { HabitatBridgeClient } from "./client.js";
import type { SavedProvisioning } from "../types.js";

export { type SavedProvisioning } from "../types.js";

export interface BridgeAgentConfig {
  id: string;
  repoUrl: string;
  secrets?: Array<{ name: string; value: string }>;
  /** Pre-loaded provisioning from saved config (used as hint for LLM). */
  savedProvisioning?: SavedProvisioning;
}

export interface BridgeAgentState {
  id: string;
  repoUrl: string;
  isReady: boolean;
}

export class BridgeAgent {
  private lifecycle: BridgeLifecycle;
  private config: BridgeAgentConfig;
  private state: BridgeAgentState;
  private currentClient: HabitatBridgeClient | null = null;
  private currentPort: number = 0;
  private lastProvisioning: SavedProvisioning | undefined;

  constructor(config: BridgeAgentConfig) {
    this.lifecycle = new BridgeLifecycle();
    this.config = config;

    this.state = {
      id: config.id,
      repoUrl: config.repoUrl,
      isReady: false,
    };
  }

  /**
   * Start the bridge container and MCP server.
   * Uses dag.llm() to build the container (reads repo, picks base image, installs deps).
   * Falls back to heuristic build if LLM fails.
   */
  async start(options?: { logFilePath?: string }): Promise<void> {
    console.log(
      `[BridgeAgent:${this.config.id}] Starting bridge MCP server...`,
    );

    const provisioning: BridgeProvisioning = {
      secrets: this.config.secrets,
      previousProvisioning: this.config.savedProvisioning,
    };

    const instance = await this.lifecycle.createBridge(
      this.config.id,
      this.config.repoUrl,
      provisioning,
      options?.logFilePath,
    );

    this.currentClient = instance.client;
    this.currentPort = instance.port;
    this.lastProvisioning = instance.savedProvisioning;
    this.state.isReady = true;

    console.log(
      `[BridgeAgent:${this.config.id}] Bridge MCP server started on port ${instance.port}`,
    );
  }

  getPort(): number {
    return this.currentPort;
  }

  /**
   * Get the saved provisioning from the last build.
   */
  getSavedProvisioning(): SavedProvisioning | undefined {
    return this.lastProvisioning ?? this.config.savedProvisioning;
  }

  async getClient(): Promise<HabitatBridgeClient> {
    if (!this.currentClient || !this.state.isReady) {
      throw new Error("Bridge agent not started");
    }
    return this.currentClient;
  }

  async destroy(): Promise<void> {
    if (this.currentClient) {
      await this.currentClient.disconnect();
      this.currentClient = null;
    }
    await this.lifecycle.destroyBridge(this.config.id);
    this.state.isReady = false;
  }

  getState(): BridgeAgentState {
    return { ...this.state };
  }
}
