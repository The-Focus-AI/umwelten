/**
 * Habitat Bridge Agent
 *
 * Manages an agent's lifecycle using the Habitat Bridge architecture.
 * Handles iterative provisioning: start basic → analyze → recreate until ready.
 */

import { BridgeLifecycle, BridgeProvisioning } from "./lifecycle.js";
import { BridgeAnalyzer, AnalysisResult } from "./analyzer.js";
import { HabitatBridgeClient } from "./client.js";
import { BridgeLLMConfigBuilder } from "./llm-config-builder.js";

export interface BridgeAgentConfig {
  id: string;
  repoUrl: string;
  maxIterations?: number;
  secrets?: Array<{ name: string; value: string }>; // Secrets to inject into container
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

  constructor(config: BridgeAgentConfig) {
    this.lifecycle = new BridgeLifecycle();
    this.config = {
      maxIterations: 10,
      ...config,
    };
    this.state = {
      id: config.id,
      repoUrl: config.repoUrl,
      iteration: 0,
      currentProvisioning: {
        baseImage: "node:20", // node:20 has Node.js and git pre-installed
        aptPackages: [], // git is already in node:20
        gitRepos: [],
      },
      analysis: null,
      isReady: false,
      logs: [],
      errors: [],
    };
  }

  private currentPort: number = 0;

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
  async start(): Promise<void> {
    console.log(
      `[BridgeAgent:${this.config.id}] Starting bridge MCP server...`,
    );

    // Create bridge with node:20 base image (has git + node)
    const instance = await this.lifecycle.createBridge(
      this.config.id,
      this.config.repoUrl,
      this.buildProvisioning(),
    );

    this.currentClient = instance.client;
    this.currentPort = instance.port;
    this.state.isReady = true;

    console.log(
      `[BridgeAgent:${this.config.id}] Bridge MCP server started on port ${instance.port}`,
    );
  }

  /**
   * Get the port the bridge is running on
   */
  getPort(): number {
    return this.currentPort;
  }

  async initialize(): Promise<void> {
    console.log(
      `[BridgeAgent:${this.config.id}] Starting iterative provisioning...`,
    );

    while (this.state.iteration < (this.config.maxIterations || 10)) {
      this.state.iteration++;
      console.log(
        `[BridgeAgent:${this.config.id}] Iteration ${this.state.iteration}`,
      );

      try {
        // Step 1: Create bridge with current provisioning (including secrets)
        const instance = await this.lifecycle.createBridge(
          this.config.id,
          this.config.repoUrl,
          this.buildProvisioning(),
        );

        this.currentClient = instance.client;
        this.currentPort = instance.port;

        // Step 2: Analyze the repository
        const analyzer = new BridgeAnalyzer(this.currentClient);
        this.state.analysis = await analyzer.analyze("/workspace");

        console.log(`[BridgeAgent:${this.config.id}] Detected:`, {
          projectType: this.state.analysis.projectType,
          tools: this.state.analysis.detectedTools,
          aptPackages: this.state.analysis.aptPackages,
          skills: this.state.analysis.skillRepos.map((s) => s.name),
        });

        // Step 3: Check if current provisioning is sufficient
        const needsUpdate = this.checkProvisioningNeeds(
          this.state.currentProvisioning,
          this.state.analysis,
          analyzer,
        );

        if (!needsUpdate) {
          // Bridge is ready!
          this.state.isReady = true;
          console.log(`[BridgeAgent:${this.config.id}] Bridge ready!`);

          // Step 4: Run setup commands
          await this.runSetupCommands();

          return;
        }

        // Step 4: Update provisioning and destroy current bridge
        this.state.currentProvisioning = this.calculateNewProvisioning(
          this.state.analysis,
          analyzer,
        );

        console.log(`[BridgeAgent:${this.config.id}] Recreating with:`, {
          baseImage: this.state.currentProvisioning.baseImage,
          aptPackages: this.state.currentProvisioning.aptPackages,
          gitRepos: this.state.currentProvisioning.gitRepos.map((r) => r.name),
        });

        await this.lifecycle.destroyBridge(this.config.id);
        this.currentClient = null;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(
          `[BridgeAgent:${this.config.id}] Error in iteration ${this.state.iteration}:`,
          errorMsg,
        );
        this.state.errors.push(
          `Iteration ${this.state.iteration}: ${errorMsg}`,
        );

        // Try to get logs
        if (this.currentClient) {
          try {
            const logs = await this.lifecycle.getLogs(this.config.id, 50);
            this.state.logs.push(...logs);
          } catch {
            // Ignore log errors
          }
        }

        // Destroy and retry with same provisioning
        try {
          await this.lifecycle.destroyBridge(this.config.id);
        } catch {
          // Ignore destroy errors
        }
        this.currentClient = null;

        // If we've had too many errors, give up
        if (this.state.errors.length >= 3) {
          throw new Error(`Too many errors: ${this.state.errors.join("; ")}`);
        }
      }
    }

    throw new Error(
      `Failed to provision after ${this.state.iteration} iterations`,
    );
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
    // Check if base image is correct
    const requiredBaseImage = analyzer.getBaseImage(analysis.projectType);
    if (current.baseImage !== requiredBaseImage) {
      return true;
    }

    // Check if all detected tools have their apt packages
    const currentAptSet = new Set(current.aptPackages);
    for (const pkg of analysis.aptPackages) {
      if (!currentAptSet.has(pkg)) {
        return true;
      }
    }

    // Check if all skills are present
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
    };
  }

  /**
   * Attempt to use LLM to generate optimal container configuration
   * Falls back to iterative analysis if LLM fails
   */
  private async tryLLMConfig(
    files: string[],
    fileContents: Record<string, string>,
  ): Promise<BridgeProvisioning | null> {
    try {
      const builder = new BridgeLLMConfigBuilder();
      return await builder.generateConfig(files, fileContents);
    } catch (error) {
      console.log(
        `[BridgeAgent:${this.config.id}] LLM config generation failed, falling back to iterative analysis`,
      );
      return null;
    }
  }

  private async runSetupCommands(): Promise<void> {
    if (!this.currentClient || !this.state.analysis) {
      return;
    }

    for (const command of this.state.analysis.setupCommands) {
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
        // Don't throw - setup commands are best-effort
      }
    }
  }
}
