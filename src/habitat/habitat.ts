/**
 * Habitat: the central system for an agent.
 * Manages work directory, sessions, config, stimulus, tools, skills, and known agents.
 * Any UI (CLI, Telegram, TUI, web) starts from a Habitat.
 */

import { join } from "node:path";
import type { Tool } from "ai";
import { Stimulus } from "../stimulus/stimulus.js";
import { Interaction } from "../interaction/core/interaction.js";
import { InteractionStore } from "../interaction/persistence/interaction-store.js";
import { loadToolsFromDirectory } from "../stimulus/tools/loader.js";
import type { SkillDefinition } from "../stimulus/skills/types.js";
import type { ModelDetails } from "../cognition/types.js";
import type {
  HabitatConfig,
  HabitatOptions,
  HabitatSessionMetadata,
  HabitatSessionType,
  AgentEntry,
  OnboardingResult,
} from "./types.js";
import {
  resolveWorkDir,
  resolveSessionsDir,
  resolveConfigPath,
  ensureDir,
  loadConfig,
  saveConfig,
  readStateFile,
  writeStateFile,
  readWorkDirFile,
  writeWorkDirFile,
  getAgentById,
  getFileAllowedRoots,
} from "./config.js";
import {
  HabitatSessionManager,
  type SessionManagerSessionOptions,
} from "./session-manager.js";
import { loadStimulusOptionsFromWorkDir } from "./load-prompts.js";
import { isOnboarded, runOnboarding } from "./onboard.js";
import { writeSessionTranscript } from "./transcript.js";
import { standardToolSets } from "./tool-sets.js";
import type { ToolSet } from "./tool-sets.js";
import type { FileToolsContext } from "./tools/file-tools.js";
import type { AgentToolsContext } from "./tools/agent-tools.js";
import type { SessionToolsContext } from "./tools/session-tools.js";
import { createCurrentSessionTool } from "./tools/session-tools.js";
import type { ExternalInteractionToolsContext } from "./tools/external-interaction-tools.js";
import type { AgentRunnerToolsContext } from "./tools/agent-runner-tools.js";
import type { SecretsToolsContext } from "./tools/secrets-tools.js";
import type { SearchToolsContext } from "./tools/search-tools.js";
import { ToolRegistry } from "./tool-registry.js";
import { HabitatAgent } from "./habitat-agent.js";
import { loadSecrets, saveSecrets } from "./secrets.js";
import { BridgeManager } from "./bridge-manager.js";

export class Habitat
  implements
    FileToolsContext,
    AgentToolsContext,
    SessionToolsContext,
    ExternalInteractionToolsContext,
    AgentRunnerToolsContext,
    SecretsToolsContext,
    SearchToolsContext
{
  readonly workDir: string;
  readonly sessionsDir: string;
  readonly configPath: string;
  readonly envPrefix: string;

  private config: HabitatConfig;
  private secrets: Record<string, string>;
  private sessionManager: HabitatSessionManager;
  private store: InteractionStore;
  private stimulus: Stimulus | null = null;
  private toolRegistry: ToolRegistry;
  private habitatAgents: Map<string, HabitatAgent> = new Map();
  private runtimeModelDetails: ModelDetails | undefined;
  private options: HabitatOptions;
  private bridgeManager!: BridgeManager;

  private constructor(
    workDir: string,
    sessionsDir: string,
    configPath: string,
    envPrefix: string,
    config: HabitatConfig,
    secrets: Record<string, string>,
    store: InteractionStore,
    sessionManager: HabitatSessionManager,
    options: HabitatOptions,
  ) {
    this.workDir = workDir;
    this.sessionsDir = sessionsDir;
    this.configPath = configPath;
    this.envPrefix = envPrefix;
    this.config = config;
    this.secrets = secrets;
    this.store = store;
    this.sessionManager = sessionManager;
    this.options = options;
    this.toolRegistry = new ToolRegistry(this);
  }

  // ── Static factory ──────────────────────────────────────────────

  /**
   * Create and initialize a Habitat.
   * Resolves directories, loads config, registers tools, loads skills.
   */
  static async create(options?: HabitatOptions): Promise<Habitat> {
    const opts = options ?? {};
    const envPrefix = opts.envPrefix ?? "HABITAT";

    // 1. Resolve directories
    const workDir = resolveWorkDir(opts);
    const sessionsDir = resolveSessionsDir(opts);
    const configPath = resolveConfigPath(workDir, opts);

    // 2. Ensure directories exist
    await ensureDir(workDir);
    await ensureDir(sessionsDir);

    // 3. Load config
    const config = opts.config ?? (await loadConfig(configPath));

    // 4. Load secrets and populate process.env (secrets fill gaps, never override)
    const secrets = await loadSecrets(workDir);
    for (const [key, value] of Object.entries(secrets)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }

    // 5. Create supporting objects
    const store = new InteractionStore({ basePath: sessionsDir });
    const sessionManager = new HabitatSessionManager(sessionsDir);

    const habitat = new Habitat(
      workDir,
      sessionsDir,
      configPath,
      envPrefix,
      config,
      secrets,
      store,
      sessionManager,
      opts,
    );

    habitat.bridgeManager = new BridgeManager({
      workDir: habitat.workDir,
      getAgent: (id) => habitat.getAgent(id),
      updateAgent: (id, u) => habitat.updateAgent(id, u),
      getSecret: (name) => habitat.getSecret(name),
    });

    // 6. Register standard tool sets (unless skipped)
    if (!opts.skipBuiltinTools) {
      for (const toolSet of standardToolSets) {
        habitat.addToolSet(toolSet);
      }
    }

    // 7. Load work-dir tools (unless skipped)
    if (!opts.skipWorkDirTools) {
      const toolsDirRelative = config.toolsDir ?? "tools";
      try {
        const workDirTools = await loadToolsFromDirectory(
          workDir,
          toolsDirRelative,
          habitat,
        );
        for (const [name, tool] of Object.entries(workDirTools)) {
          habitat.addTool(name, tool);
        }
      } catch {
        // tools/ directory may not exist yet
      }
    }

    // 8. Call custom tool registration callback
    if (opts.registerCustomTools) {
      await opts.registerCustomTools(habitat);
    }

    return habitat;
  }

  // ── Config management ───────────────────────────────────────────

  getConfig(): HabitatConfig {
    return this.config;
  }

  async reloadConfig(): Promise<HabitatConfig> {
    this.config = await loadConfig(this.configPath);
    return this.config;
  }

  async saveConfig(): Promise<void> {
    await saveConfig(this.configPath, this.config);
  }

  async updateConfig(updates: Partial<HabitatConfig>): Promise<void> {
    Object.assign(this.config, updates);
    await this.saveConfig();
  }

  // ── Model defaults ──────────────────────────────────────────────

  setRuntimeModelDetails(details: ModelDetails): void {
    this.runtimeModelDetails = details;
  }

  getDefaultModelDetails(): ModelDetails | undefined {
    // Runtime model (from CLI flags) takes priority over config
    if (this.runtimeModelDetails) return this.runtimeModelDetails;

    const fromConfigP = this.config.defaultProvider?.trim();
    const fromConfigM = this.config.defaultModel?.trim();
    const fromEnvP = process.env[`${this.envPrefix}_PROVIDER`]?.trim();
    const fromEnvM = process.env[`${this.envPrefix}_MODEL`]?.trim();

    const provider = fromConfigP || fromEnvP;
    const model = fromConfigM || fromEnvM;
    if (provider && model) return { name: model, provider };
    return undefined;
  }

  // ── Agent management ────────────────────────────────────────────

  getAgents(): AgentEntry[] {
    return this.config.agents;
  }

  getAgent(idOrName: string): AgentEntry | undefined {
    return getAgentById(this.config, idOrName);
  }

  async addAgent(agent: AgentEntry): Promise<void> {
    this.config.agents.push(agent);
    await this.saveConfig();
  }

  async updateAgent(
    idOrName: string,
    updates: Partial<AgentEntry>,
  ): Promise<void> {
    const agent = this.getAgent(idOrName);
    if (!agent) return;
    Object.assign(agent, updates);
    this.habitatAgents.delete(agent.id);
    await this.saveConfig();
  }

  async removeAgent(idOrName: string): Promise<AgentEntry | undefined> {
    const idx = this.config.agents.findIndex(
      (a) => a.id === idOrName || a.name === idOrName,
    );
    if (idx === -1) return undefined;
    const removed = this.config.agents.splice(idx, 1)[0];
    this.habitatAgents.delete(removed.id);
    await this.saveConfig();
    return removed;
  }

  getAllowedRoots(): string[] {
    return getFileAllowedRoots(this.workDir, this.sessionsDir, this.config);
  }

  // ── FileToolsContext interface ──────────────────────────────────

  getWorkDir(): string {
    return this.workDir;
  }

  getSessionsDir(): string {
    return this.sessionsDir;
  }

  // ── Stimulus ────────────────────────────────────────────────────

  /**
   * Get the Stimulus, building it from work dir if not yet loaded.
   */
  async getStimulus(): Promise<Stimulus> {
    if (!this.stimulus) {
      this.stimulus = await this.buildStimulus();
    }
    return this.stimulus;
  }

  /** Force rebuild the stimulus. */
  async rebuildStimulus(): Promise<Stimulus> {
    this.stimulus = await this.buildStimulus();
    return this.stimulus;
  }

  private async buildStimulus(): Promise<Stimulus> {
    const stimulusOptions = await loadStimulusOptionsFromWorkDir(
      this.workDir,
      this.config,
    );
    const stimulus = new Stimulus(stimulusOptions);

    // Register all habitat tools into the stimulus
    for (const [name, tool] of Object.entries(this.toolRegistry.getTools())) {
      stimulus.addTool(name, tool);
    }

    // Load skills (unless skipped)
    if (!this.options.skipSkills) {
      const skillsDirsResolved = (this.config.skillsDirs ?? ["./skills"]).map(
        (d) => join(this.workDir, d),
      );
      stimulus.options.skillsDirs = skillsDirsResolved;
      stimulus.options.skillsFromGit = this.config.skillsFromGit ?? [];
      stimulus.options.skillsCacheRoot = join(
        this.workDir,
        this.config.skillsCacheDir ?? "repos",
      );
      await stimulus.loadSkills();
      stimulus.addSkillsTool();
    }

    this.toolRegistry.setStimulus(stimulus);
    return stimulus;
  }

  // ── Tool management ─────────────────────────────────────────────

  addTool(name: string, tool: Tool): void { this.toolRegistry.addTool(name, tool); }

  addTools(tools: Record<string, Tool>): void { this.toolRegistry.addTools(tools); }

  getTools(): Record<string, Tool> { return this.toolRegistry.getTools(); }

  addToolSet(toolSet: ToolSet): void { this.toolRegistry.addToolSet(toolSet); }

  getSkills(): SkillDefinition[] { return this.toolRegistry.getSkills(); }

  // ── Session management ──────────────────────────────────────────

  async getOrCreateSession(
    type: HabitatSessionType,
    identifier?: string | number,
    options?: SessionManagerSessionOptions,
  ): Promise<{ sessionId: string; sessionDir: string }> {
    return this.sessionManager.getOrCreateSession(type, identifier, options);
  }

  async startNewThread(
    type: HabitatSessionType,
    identifier: string | number,
    options?: SessionManagerSessionOptions,
  ): Promise<{ sessionId: string; sessionDir: string }> {
    return this.sessionManager.startNewThread(type, identifier, options);
  }

  async updateSessionMetadata(
    sessionId: string,
    updates: Partial<HabitatSessionMetadata>,
  ): Promise<void> {
    return this.sessionManager.updateMetadata(sessionId, updates);
  }

  async listSessions(): Promise<HabitatSessionMetadata[]> {
    return this.sessionManager.listSessions();
  }

  async getSessionDir(sessionId: string): Promise<string | null> {
    return this.sessionManager.getSessionDir(sessionId);
  }

  getStore(): InteractionStore {
    return this.store;
  }

  // ── Interaction factory ─────────────────────────────────────────

  /**
   * Create a new Interaction connected to this habitat.
   * Uses default model if modelDetails not provided.
   * Auto-creates a session and wires transcript persistence.
   */
  async createInteraction(options?: {
    modelDetails?: ModelDetails;
    sessionId?: string;
    sessionType?: HabitatSessionType;
    sessionIdentifier?: string | number;
  }): Promise<{
    interaction: Interaction;
    sessionId: string;
    sessionDir: string;
  }> {
    const modelDetails = options?.modelDetails ?? this.getDefaultModelDetails();
    if (!modelDetails) {
      throw new Error(
        `No model details provided and no default configured. ` +
          `Set defaultProvider/defaultModel in config.json or ${this.envPrefix}_PROVIDER/${this.envPrefix}_MODEL env vars.`,
      );
    }

    const stimulus = await this.getStimulus();

    // Resolve session
    let sessionId: string;
    let sessionDir: string;

    if (options?.sessionId) {
      const dir = await this.sessionManager.getSessionDir(options.sessionId);
      if (dir) {
        sessionId = options.sessionId;
        sessionDir = dir;
      } else {
        // Create the session directory
        sessionId = options.sessionId;
        sessionDir = join(this.sessionsDir, sessionId);
        await ensureDir(sessionDir);
      }
    } else {
      const session = await this.getOrCreateSession(
        options?.sessionType ?? "cli",
        options?.sessionIdentifier,
      );
      sessionId = session.sessionId;
      sessionDir = session.sessionDir;
    }

    const interaction = new Interaction(modelDetails, stimulus, {
      id: sessionId,
      source: "native",
      sourceId: sessionId,
    });

    // Add current_session introspection tool
    this.addTool(
      "current_session",
      createCurrentSessionTool({
        sessionId,
        sessionDir,
        startedAt: new Date(),
        getMessageCount: () => interaction.messages.length,
      }),
    );

    // Wire transcript persistence
    interaction.setOnTranscriptUpdate((messages) => {
      void writeSessionTranscript(sessionDir, messages);
    });

    return { interaction, sessionId, sessionDir };
  }

  // ── HabitatAgent management ─────────────────────────────────────

  /**
   * Get or create a HabitatAgent for a managed project.
   * Sub-agents are cached and reused across calls.
   */
  async getOrCreateHabitatAgent(agentId: string): Promise<HabitatAgent> {
    if (!this.habitatAgents.has(agentId)) {
      const agent = this.getAgent(agentId);
      if (!agent) throw new Error(`Agent not found: ${agentId}`);
      const ha = await HabitatAgent.create(this, agent);
      this.habitatAgents.set(agentId, ha);
    }
    return this.habitatAgents.get(agentId)!;
  }

  invalidateHabitatAgent(agentId: string): void {
    this.habitatAgents.delete(agentId);
  }

  /**
   * Create an ephemeral Interaction with a custom Stimulus.
   * Used by diagnosis/monitor agents that bring their own tools and instructions.
   * No session persistence — the interaction is discarded after use.
   */
  createAgentInteraction(stimulus: Stimulus): Interaction {
    const modelDetails = this.getDefaultModelDetails();
    if (!modelDetails) {
      throw new Error(
        `No default model configured. Set defaultProvider/defaultModel in config.json or ${this.envPrefix}_PROVIDER / ${this.envPrefix}_MODEL.`,
      );
    }
    return new Interaction(modelDetails, stimulus);
  }

  // ── Bridge Supervisor management (delegated to BridgeManager) ────

  getAgentDir(agentId: string): string {
    return this.bridgeManager.getAgentDir(agentId);
  }

  async ensureAgentDir(agentId: string): Promise<void> {
    return this.bridgeManager.ensureAgentDir(agentId);
  }

  async saveBridgeState(agentId: string, state: import("./bridge/state.js").BridgeState): Promise<void> {
    return this.bridgeManager.saveBridgeState(agentId, state);
  }

  async loadBridgeState(agentId: string): Promise<import("./bridge/state.js").BridgeState | null> {
    return this.bridgeManager.loadBridgeState(agentId);
  }

  async loadAllBridgeStates(): Promise<import("./bridge/state.js").BridgeState[]> {
    return this.bridgeManager.loadAllBridgeStates();
  }

  async startBridge(
    agentId: string,
    options?: { logFilePath?: string },
  ): Promise<import("./bridge/agent.js").BridgeAgent> {
    return this.bridgeManager.startBridge(agentId, options);
  }

  getSupervisor(agentId: string): import("./bridge/supervisor.js").BridgeSupervisor | undefined {
    return this.bridgeManager.getSupervisor(agentId);
  }

  getBridgeAgent(agentId: string): import("./bridge/agent.js").BridgeAgent | undefined {
    return this.bridgeManager.getBridgeAgent(agentId);
  }

  getAllBridgeAgents(): import("./bridge/agent.js").BridgeAgent[] {
    return this.bridgeManager.getAllBridgeAgents();
  }

  async destroyBridgeAgent(agentId: string): Promise<void> {
    return this.bridgeManager.destroyBridgeAgent(agentId);
  }

  listBridgeAgents(): string[] {
    return this.bridgeManager.listBridgeAgents();
  }

  async stopAllSupervisors(): Promise<void> {
    return this.bridgeManager.stopAllSupervisors();
  }

  // ── Onboarding ──────────────────────────────────────────────────

  async isOnboarded(): Promise<boolean> {
    return isOnboarded(this.workDir, this.configPath);
  }

  async onboard(templatePath?: string): Promise<OnboardingResult> {
    return runOnboarding(
      this.workDir,
      this.configPath,
      this.envPrefix,
      templatePath ?? this.options.stimulusTemplatePath,
    );
  }

  // ── Secrets ─────────────────────────────────────────────────────

  isSecretAvailable(name: string): boolean {
    return this.secrets[name] !== undefined || process.env[name] !== undefined;
  }

  getSecret(name: string): string | undefined {
    return this.secrets[name] ?? process.env[name];
  }

  async setSecret(name: string, value: string): Promise<void> {
    this.secrets[name] = value;
    // Also inject into process.env so runtime tools see the new secret immediately
    process.env[name] = value;
    await saveSecrets(this.workDir, this.secrets);
  }

  async removeSecret(name: string): Promise<void> {
    delete this.secrets[name];
    delete process.env[name];
    await saveSecrets(this.workDir, this.secrets);
  }

  listSecretNames(): string[] {
    return Object.keys(this.secrets);
  }

  // ── Work dir file management ────────────────────────────────────

  async readWorkDirFile(relativePath: string): Promise<string | null> {
    return readWorkDirFile(this.workDir, relativePath);
  }

  async writeWorkDirFile(relativePath: string, content: string): Promise<void> {
    return writeWorkDirFile(this.workDir, relativePath, content);
  }

  async readStateFile<T>(filename: string): Promise<T | null> {
    return readStateFile<T>(this.workDir, filename);
  }

  async writeStateFile(filename: string, data: unknown): Promise<void> {
    return writeStateFile(this.workDir, filename, data);
  }
}
