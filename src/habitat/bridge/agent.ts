/**
 * Habitat Bridge Agent
 *
 * Manages an agent's lifecycle using the Habitat Bridge architecture.
 * First run: analyze repo → discover provisioning → save to config.
 * Subsequent runs: load saved provisioning → start directly (1 iteration).
 * Use --reanalyze to force re-discovery.
 */

import { BridgeLifecycle, BridgeProvisioning } from "./lifecycle.js";
import { BridgeAnalyzer, AnalysisResult } from "./analyzer.js";
import { HabitatBridgeClient } from "./client.js";

export interface BridgeAgentConfig {
  id: string;
  repoUrl: string;
  maxIterations?: number;
  secrets?: Array<{ name: string; value: string }>; // Secrets to inject into container
  /** Pre-loaded provisioning from saved config (skips analysis). */
  savedProvisioning?: SavedProvisioning;
}

/** Provisioning data that gets persisted to config.json. */
export interface SavedProvisioning {
  baseImage: string;
  aptPackages: string[];
  setupCommands: string[];
  detectedTools: string[];
  projectType: string;
  skillRepos: Array<{
    name: string;
    gitRepo: string;
    containerPath: string;
    aptPackages: string[];
  }>;
  analyzedAt: string;
}

export interface BridgeAgentState {
  id: string;
  repoUrl: string;
  iteration: number;
  currentProvisioning: BridgeProvisioning;
  analysis: AnalysisResult | null;
  isReady: boolean;
  logs: string[];
  errors: string[];
}

export class BridgeAgent {
  private lifecycle: BridgeLifecycle;
  private config: BridgeAgentConfig;
  private state: BridgeAgentState;
  private currentClient: HabitatBridgeClient | null = null;
  private currentPort: number = 0;

  constructor(config: BridgeAgentConfig) {
    this.lifecycle = new BridgeLifecycle();
    this.config = {
      maxIterations: 10,
      ...config,
    };

    // If we have saved provisioning, use it directly
    const saved = config.savedProvisioning;
    const initialProvisioning: BridgeProvisioning = saved
      ? {
          baseImage: saved.baseImage,
          aptPackages: saved.aptPackages,
          gitRepos: saved.skillRepos.map((skill) => ({
            name: skill.name,
            url: `https://github.com/${skill.gitRepo}.git`,
            path: skill.containerPath,
          })),
          setupCommands: saved.setupCommands,
        }
      : {
          baseImage: "node:20",
          aptPackages: [],
          gitRepos: [],
        };

    this.state = {
      id: config.id,
      repoUrl: config.repoUrl,
      iteration: 0,
      currentProvisioning: initialProvisioning,
      analysis: null,
      isReady: false,
      logs: [],
      errors: [],
    };
  }

  /**
   * Build provisioning config including secrets
   */
  private buildProvisioning(): BridgeProvisioning {
    return {
      ...this.state.currentProvisioning,
      secrets: this.config.secrets,
    };
  }

  /**
   * Start the bridge MCP server only - no internal analysis
   * This starts the container and makes it available for CLI client interaction
   */
  async start(logFilePath?: string): Promise<void> {
    console.log(
      `[BridgeAgent:${this.config.id}] Starting bridge MCP server...`,
    );

    const instance = await this.lifecycle.createBridge(
      this.config.id,
      this.config.repoUrl,
      this.buildProvisioning(),
      logFilePath,
    );

    this.currentClient = instance.client;
    this.currentPort = instance.port;
    this.state.isReady = true;

    console.log(
      `[BridgeAgent:${this.config.id}] Bridge MCP server started on port ${instance.port}`,
    );
  }

  getPort(): number {
    return this.currentPort;
  }

  /**
   * Initialize the bridge agent.
   *
   * If savedProvisioning was provided in config, builds the container directly
   * with the known-good provisioning (1 iteration, no analysis).
   *
   * If no saved provisioning, runs discovery: start bare container → analyze
   * repo via MCP → determine packages → rebuild with full provisioning.
   */
  async initialize(logFilePath?: string): Promise<void> {
    const hasSaved = !!this.config.savedProvisioning;

    if (hasSaved) {
      // Fast path: use saved provisioning, skip analysis entirely
      console.log(
        `[BridgeAgent:${this.config.id}] Using saved provisioning (analyzed ${this.config.savedProvisioning!.analyzedAt})`,
      );
      this.state.iteration = 1;

      const instance = await this.lifecycle.createBridge(
        this.config.id,
        this.config.repoUrl,
        this.buildProvisioning(),
        logFilePath,
      );

      this.currentClient = instance.client;
      this.currentPort = instance.port;
      this.state.isReady = true;

      console.log(`[BridgeAgent:${this.config.id}] Bridge ready on port ${instance.port}`);

      // Run setup commands from saved config
      if (this.config.savedProvisioning!.setupCommands.length > 0) {
        await this.runSetupCommandsList(this.config.savedProvisioning!.setupCommands);
      }

      return;
    }

    // Discovery path: analyze repo to determine provisioning
    console.log(
      `[BridgeAgent:${this.config.id}] No saved provisioning — running discovery...`,
    );

    while (this.state.iteration < (this.config.maxIterations || 10)) {
      this.state.iteration++;
      console.log(
        `[BridgeAgent:${this.config.id}] Iteration ${this.state.iteration}`,
      );

      try {
        const instance = await this.lifecycle.createBridge(
          this.config.id,
          this.config.repoUrl,
          this.buildProvisioning(),
          logFilePath,
        );

        this.currentClient = instance.client;
        this.currentPort = instance.port;

        // Only analyze on first iteration
        if (!this.state.analysis) {
          const analyzer = new BridgeAnalyzer(this.currentClient);
          this.state.analysis = await analyzer.analyze("/workspace");

          console.log(`[BridgeAgent:${this.config.id}] Detected:`, {
            projectType: this.state.analysis.projectType,
            tools: this.state.analysis.detectedTools,
            aptPackages: this.state.analysis.aptPackages,
            skills: this.state.analysis.skillRepos.map((s) => s.name),
          });

          const needsUpdate = this.checkProvisioningNeeds(
            this.state.currentProvisioning,
            this.state.analysis,
            analyzer,
          );

          if (needsUpdate) {
            this.state.currentProvisioning = this.calculateNewProvisioning(
              this.state.analysis,
              analyzer,
            );

            console.log(`[BridgeAgent:${this.config.id}] Rebuilding with:`, {
              baseImage: this.state.currentProvisioning.baseImage,
              aptPackages: this.state.currentProvisioning.aptPackages,
            });

            await this.lifecycle.destroyBridge(this.config.id);
            this.currentClient = null;
            continue;
          }
        }

        // Ready
        this.state.isReady = true;
        console.log(`[BridgeAgent:${this.config.id}] Bridge ready on port ${this.currentPort}`);

        // Run setup commands
        if (this.state.analysis) {
          await this.runSetupCommandsList(this.state.analysis.setupCommands);
        }

        return;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(
          `[BridgeAgent:${this.config.id}] Error in iteration ${this.state.iteration}:`,
          errorMsg,
        );
        this.state.errors.push(
          `Iteration ${this.state.iteration}: ${errorMsg}`,
        );

        if (this.currentClient) {
          try {
            const logs = await this.lifecycle.getLogs(this.config.id, 50);
            this.state.logs.push(...logs);
          } catch {
            // Ignore log errors
          }
        }

        try {
          await this.lifecycle.destroyBridge(this.config.id);
        } catch {
          // Ignore destroy errors
        }
        this.currentClient = null;

        if (this.state.errors.length >= 3) {
          throw new Error(`Too many errors: ${this.state.errors.join("; ")}`);
        }
      }
    }

    throw new Error(
      `Failed to provision after ${this.state.iteration} iterations`,
    );
  }

  /**
   * Get the provisioning data to save to config.json.
   * Call this after successful initialization.
   */
  getSavedProvisioning(): SavedProvisioning | null {
    if (!this.state.analysis) return null;

    return {
      baseImage: this.state.currentProvisioning.baseImage,
      aptPackages: this.state.currentProvisioning.aptPackages,
      setupCommands: this.state.analysis.setupCommands,
      detectedTools: this.state.analysis.detectedTools,
      projectType: this.state.analysis.projectType,
      skillRepos: this.state.analysis.skillRepos,
      analyzedAt: new Date().toISOString(),
    };
  }

  async getClient(): Promise<HabitatBridgeClient> {
    if (!this.currentClient || !this.state.isReady) {
      throw new Error("Bridge agent not initialized");
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

  private checkProvisioningNeeds(
    current: BridgeProvisioning,
    analysis: AnalysisResult,
    analyzer: BridgeAnalyzer,
  ): boolean {
    const requiredBaseImage = analyzer.getBaseImage(analysis.projectType);
    if (current.baseImage !== requiredBaseImage) {
      return true;
    }

    const currentAptSet = new Set(current.aptPackages);
    for (const pkg of analysis.aptPackages) {
      if (!currentAptSet.has(pkg)) {
        return true;
      }
    }

    const currentSkillSet = new Set(current.gitRepos.map((r) => r.name));
    for (const skill of analysis.skillRepos) {
      if (!currentSkillSet.has(skill.name)) {
        return true;
      }
    }

    return false;
  }

  private calculateNewProvisioning(
    analysis: AnalysisResult,
    analyzer: BridgeAnalyzer,
  ): BridgeProvisioning {
    return {
      baseImage: analyzer.getBaseImage(analysis.projectType),
      aptPackages: ["git", ...analysis.aptPackages],
      gitRepos: analysis.skillRepos.map((skill) => ({
        name: skill.name,
        url: `https://github.com/${skill.gitRepo}.git`,
        path: skill.containerPath,
      })),
      setupCommands: analysis.setupCommands,
    };
  }

  private async runSetupCommandsList(commands: string[]): Promise<void> {
    if (!this.currentClient || commands.length === 0) return;

    for (const command of commands) {
      console.log(`[BridgeAgent:${this.config.id}] Running: ${command}`);
      try {
        const result = await this.currentClient.execute(command);
        if (result.stderr) {
          console.warn(
            `[BridgeAgent:${this.config.id}] Stderr: ${result.stderr}`,
          );
        }
      } catch (error) {
        console.error(
          `[BridgeAgent:${this.config.id}] Setup command failed: ${command}`,
          error,
        );
      }
    }
  }
}
