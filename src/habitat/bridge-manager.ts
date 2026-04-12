/**
 * BridgeManager: manages Bridge Supervisor lifecycle for agents.
 * Extracted from Habitat to keep the main class focused.
 */

import { join } from "node:path";
import { ensureDir } from "./config.js";
import type { AgentEntry } from "./types.js";
import type { BridgeState } from "./bridge/state.js";
import { BridgeSupervisor, type SupervisorConfig } from "./bridge/supervisor.js";

export interface BridgeManagerDeps {
  workDir: string;
  getAgent: (idOrName: string) => AgentEntry | undefined;
  updateAgent: (idOrName: string, updates: Partial<AgentEntry>) => Promise<void>;
  getSecret: (name: string) => string | undefined;
}

export class BridgeManager {
  private supervisors = new Map<string, BridgeSupervisor>();
  private deps: BridgeManagerDeps;

  constructor(deps: BridgeManagerDeps) {
    this.deps = deps;
  }

  /**
   * Get the directory path for an agent's state and logs
   */
  getAgentDir(agentId: string): string {
    return join(this.deps.workDir, "agents", agentId);
  }

  /**
   * Ensure agent directory exists
   */
  async ensureAgentDir(agentId: string): Promise<void> {
    const agentDir = this.getAgentDir(agentId);
    await ensureDir(agentDir);
    await ensureDir(join(agentDir, "logs"));
  }

  /**
   * Save bridge state to disk (legacy compat)
   */
  async saveBridgeState(agentId: string, state: BridgeState): Promise<void> {
    await this.ensureAgentDir(agentId);
    const statePath = join(this.getAgentDir(agentId), "state.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
  }

  /**
   * Load bridge state from disk (legacy compat)
   */
  async loadBridgeState(agentId: string): Promise<BridgeState | null> {
    const statePath = join(this.getAgentDir(agentId), "state.json");
    try {
      const { readFile } = await import("node:fs/promises");
      const data = await readFile(statePath, "utf-8");
      return JSON.parse(data) as BridgeState;
    } catch {
      return null;
    }
  }

  /**
   * Load all persisted bridge states
   */
  async loadAllBridgeStates(): Promise<BridgeState[]> {
    const agentsDir = join(this.deps.workDir, "agents");
    try {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(agentsDir, { withFileTypes: true });
      const states: BridgeState[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const state = await this.loadBridgeState(entry.name);
          if (state) {
            states.push(state);
          }
        }
      }
      return states;
    } catch {
      return [];
    }
  }

  /**
   * Start a Bridge supervisor for an agent.
   * The supervisor builds the container (via dag.llm() + fallback),
   * monitors health, and rebuilds on failure.
   */
  async startBridge(
    agentId: string,
    options?: { logFilePath?: string },
  ): Promise<import("./bridge/agent.js").BridgeAgent> {
    // Validate agent exists and has gitRemote
    const agent = this.deps.getAgent(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    if (!agent.gitRemote) throw new Error(`Agent "${agentId}" has no gitRemote configured`);

    // Ensure agent dir + log path
    await this.ensureAgentDir(agentId);
    const logFilePath = options?.logFilePath ??
      join(this.getAgentDir(agentId), "logs", "bridge.log");

    // Resolve secrets from agent.secrets names → values
    const resolvedSecrets = this.resolveAgentSecrets(agentId);

    // Load saved provisioning from agent config
    const savedProvisioning = agent.bridgeProvisioning;

    // Create and start supervisor
    const supervisorConfig: SupervisorConfig = {
      agentId,
      repoUrl: agent.gitRemote,
      secrets: resolvedSecrets,
      stateDir: this.getAgentDir(agentId),
      logFilePath,
      savedProvisioning: savedProvisioning ? { ...savedProvisioning } : undefined,
    };

    const supervisor = new BridgeSupervisor(supervisorConfig);
    await supervisor.start();

    // Store supervisor
    this.supervisors.set(agentId, supervisor);

    // Get the bridge agent from supervisor
    const bridgeAgent = supervisor.getBridgeAgent();
    if (!bridgeAgent) {
      throw new Error(`Supervisor started but bridge agent not available for ${agentId}`);
    }

    // Save port + status to config
    const port = supervisor.getPort();
    await this.deps.updateAgent(agentId, {
      mcpPort: port,
      mcpStatus: "running",
      mcpEnabled: true,
    });

    // Save provisioning if we got new one from the LLM build
    const newProvisioning = bridgeAgent.getSavedProvisioning();
    if (newProvisioning) {
      await this.deps.updateAgent(agentId, {
        bridgeProvisioning: newProvisioning,
      });
    }

    // Save legacy state for compat
    const state: BridgeState = {
      agentId,
      repoUrl: agent.gitRemote,
      port: port || 0,
      pid: process.pid,
      status: "running",
      createdAt: new Date().toISOString(),
      lastHealthCheck: new Date().toISOString(),
    };
    await this.saveBridgeState(agentId, state);

    return bridgeAgent;
  }

  private resolveAgentSecrets(agentId: string): Array<{ name: string; value: string }> {
    const agent = this.deps.getAgent(agentId);
    const resolved: Array<{ name: string; value: string }> = [];
    if (agent?.secrets?.length) {
      const missing: string[] = [];
      for (const secretName of agent.secrets) {
        const value = this.deps.getSecret(secretName);
        if (value) {
          resolved.push({ name: secretName, value });
        } else {
          missing.push(secretName);
        }
      }
      if (missing.length > 0) {
        console.warn(
          `[habitat] WARNING: Agent "${agentId}" references secrets not found in store or environment: ${missing.join(", ")}. ` +
          `Use secrets_set to add them, then restart the bridge.`,
        );
      }
    }
    return resolved;
  }

  /**
   * Get the supervisor for an agent.
   */
  getSupervisor(agentId: string): BridgeSupervisor | undefined {
    return this.supervisors.get(agentId);
  }

  /**
   * Get an existing Bridge Agent by ID (from supervisor).
   */
  getBridgeAgent(
    agentId: string,
  ): import("./bridge/agent.js").BridgeAgent | undefined {
    const supervisor = this.supervisors.get(agentId);
    return supervisor?.getBridgeAgent() ?? undefined;
  }

  /**
   * Get all bridge agents (from supervisors)
   */
  getAllBridgeAgents(): import("./bridge/agent.js").BridgeAgent[] {
    const agents: import("./bridge/agent.js").BridgeAgent[] = [];
    for (const supervisor of this.supervisors.values()) {
      const agent = supervisor.getBridgeAgent();
      if (agent) agents.push(agent);
    }
    return agents;
  }

  /**
   * Destroy a Bridge Agent and clean up its resources.
   */
  async destroyBridgeAgent(agentId: string): Promise<void> {
    const supervisor = this.supervisors.get(agentId);
    if (supervisor) {
      await supervisor.stop();
      this.supervisors.delete(agentId);
    }
    // Clear port from config so bridge_list doesn't try to connect
    await this.deps.updateAgent(agentId, {
      mcpPort: undefined,
      mcpStatus: "stopped",
    });
    // Update state
    const state = await this.loadBridgeState(agentId);
    if (state) {
      state.status = "stopped";
      await this.saveBridgeState(agentId, state);
    }
  }

  /**
   * List all active Bridge Agent IDs.
   */
  listBridgeAgents(): string[] {
    return Array.from(this.supervisors.keys());
  }

  /**
   * Stop all supervisors (for graceful shutdown).
   */
  async stopAllSupervisors(): Promise<void> {
    const promises = Array.from(this.supervisors.entries()).map(
      async ([id, supervisor]) => {
        try {
          await supervisor.stop();
        } catch (err: any) {
          console.warn(`[habitat] Failed to stop supervisor ${id}: ${err.message}`);
        }
      },
    );
    await Promise.all(promises);
    this.supervisors.clear();
  }
}
