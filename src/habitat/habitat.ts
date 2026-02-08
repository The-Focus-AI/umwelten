/**
 * Habitat: the central system for an agent.
 * Manages work directory, sessions, config, stimulus, tools, skills, and known agents.
 * Any UI (CLI, Telegram, TUI, web) starts from a Habitat.
 */

import { join } from 'node:path';
import type { Tool } from 'ai';
import { Stimulus } from '../stimulus/stimulus.js';
import { Interaction } from '../interaction/core/interaction.js';
import { InteractionStore } from '../interaction/persistence/interaction-store.js';
import { loadToolsFromDirectory } from '../stimulus/tools/loader.js';
import type { ModelDetails } from '../cognition/types.js';
import type {
  HabitatConfig,
  HabitatOptions,
  HabitatSessionMetadata,
  HabitatSessionType,
  AgentEntry,
  OnboardingResult,
} from './types.js';
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
} from './config.js';
import { HabitatSessionManager } from './session-manager.js';
import { loadStimulusOptionsFromWorkDir } from './load-prompts.js';
import { isOnboarded, runOnboarding } from './onboard.js';
import { writeSessionTranscript } from './transcript.js';
import { standardToolSets } from './tool-sets.js';
import type { ToolSet } from './tool-sets.js';
import type { FileToolsContext } from './tools/file-tools.js';
import type { AgentToolsContext } from './tools/agent-tools.js';
import type { SessionToolsContext } from './tools/session-tools.js';
import type { ExternalInteractionToolsContext } from './tools/external-interaction-tools.js';
import type { AgentRunnerToolsContext } from './tools/agent-runner-tools.js';
import { HabitatAgent } from './habitat-agent.js';

export class Habitat implements FileToolsContext, AgentToolsContext, SessionToolsContext, ExternalInteractionToolsContext, AgentRunnerToolsContext {
  readonly workDir: string;
  readonly sessionsDir: string;
  readonly configPath: string;
  readonly envPrefix: string;

  private config: HabitatConfig;
  private sessionManager: HabitatSessionManager;
  private store: InteractionStore;
  private stimulus: Stimulus | null = null;
  private registeredTools: Record<string, Tool> = {};
  private habitatAgents: Map<string, HabitatAgent> = new Map();
  private options: HabitatOptions;

  private constructor(
    workDir: string,
    sessionsDir: string,
    configPath: string,
    envPrefix: string,
    config: HabitatConfig,
    store: InteractionStore,
    sessionManager: HabitatSessionManager,
    options: HabitatOptions
  ) {
    this.workDir = workDir;
    this.sessionsDir = sessionsDir;
    this.configPath = configPath;
    this.envPrefix = envPrefix;
    this.config = config;
    this.store = store;
    this.sessionManager = sessionManager;
    this.options = options;
  }

  // ── Static factory ──────────────────────────────────────────────

  /**
   * Create and initialize a Habitat.
   * Resolves directories, loads config, registers tools, loads skills.
   */
  static async create(options?: HabitatOptions): Promise<Habitat> {
    const opts = options ?? {};
    const envPrefix = opts.envPrefix ?? 'HABITAT';

    // 1. Resolve directories
    const workDir = resolveWorkDir(opts);
    const sessionsDir = resolveSessionsDir(opts);
    const configPath = resolveConfigPath(workDir, opts);

    // 2. Ensure directories exist
    await ensureDir(workDir);
    await ensureDir(sessionsDir);

    // 3. Load config
    const config = opts.config ?? await loadConfig(configPath);

    // 4. Create supporting objects
    const store = new InteractionStore({ basePath: sessionsDir });
    const sessionManager = new HabitatSessionManager(sessionsDir);

    const habitat = new Habitat(
      workDir, sessionsDir, configPath, envPrefix,
      config, store, sessionManager, opts
    );

    // 5. Register standard tool sets (unless skipped)
    if (!opts.skipBuiltinTools) {
      for (const toolSet of standardToolSets) {
        habitat.addToolSet(toolSet);
      }
    }

    // 6. Load work-dir tools (unless skipped)
    if (!opts.skipWorkDirTools) {
      const toolsDirRelative = config.toolsDir ?? 'tools';
      try {
        const workDirTools = await loadToolsFromDirectory(workDir, toolsDirRelative);
        for (const [name, tool] of Object.entries(workDirTools)) {
          habitat.addTool(name, tool);
        }
      } catch {
        // tools/ directory may not exist yet
      }
    }

    // 7. Call custom tool registration callback
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

  getDefaultModelDetails(): ModelDetails | undefined {
    const provider = this.config.defaultProvider ?? process.env[`${this.envPrefix}_PROVIDER`];
    const model = this.config.defaultModel ?? process.env[`${this.envPrefix}_MODEL`];
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

  async updateAgent(idOrName: string, updates: Partial<AgentEntry>): Promise<void> {
    const agent = this.getAgent(idOrName);
    if (!agent) return;
    Object.assign(agent, updates);
    await this.saveConfig();
  }

  async removeAgent(idOrName: string): Promise<AgentEntry | undefined> {
    const idx = this.config.agents.findIndex(a => a.id === idOrName || a.name === idOrName);
    if (idx === -1) return undefined;
    const removed = this.config.agents.splice(idx, 1)[0];
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
    const stimulusOptions = await loadStimulusOptionsFromWorkDir(this.workDir, this.config);
    const stimulus = new Stimulus(stimulusOptions);

    // Register all habitat tools into the stimulus
    for (const [name, tool] of Object.entries(this.registeredTools)) {
      stimulus.addTool(name, tool);
    }

    // Load skills (unless skipped)
    if (!this.options.skipSkills) {
      const skillsDirsResolved = (this.config.skillsDirs ?? ['./skills']).map((d) => join(this.workDir, d));
      stimulus.options.skillsDirs = skillsDirsResolved;
      stimulus.options.skillsFromGit = this.config.skillsFromGit ?? [];
      stimulus.options.skillsCacheRoot = join(this.workDir, this.config.skillsCacheDir ?? 'repos');
      await stimulus.loadSkills();
      stimulus.addSkillsTool();
    }

    return stimulus;
  }

  // ── Tool management ─────────────────────────────────────────────

  addTool(name: string, tool: Tool): void {
    this.registeredTools[name] = tool;
    // If stimulus is already built, also add to it
    if (this.stimulus) {
      this.stimulus.addTool(name, tool);
    }
  }

  addTools(tools: Record<string, Tool>): void {
    for (const [name, tool] of Object.entries(tools)) {
      this.addTool(name, tool);
    }
  }

  getTools(): Record<string, Tool> {
    return { ...this.registeredTools };
  }

  addToolSet(toolSet: ToolSet): void {
    const tools = toolSet.createTools(this);
    this.addTools(tools);
  }

  // ── Session management ──────────────────────────────────────────

  async getOrCreateSession(
    type: HabitatSessionType,
    identifier?: string | number
  ): Promise<{ sessionId: string; sessionDir: string }> {
    return this.sessionManager.getOrCreateSession(type, identifier);
  }

  async startNewThread(
    type: HabitatSessionType,
    identifier: string | number
  ): Promise<{ sessionId: string; sessionDir: string }> {
    return this.sessionManager.startNewThread(type, identifier);
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
  }): Promise<{ interaction: Interaction; sessionId: string; sessionDir: string }> {
    const modelDetails = options?.modelDetails ?? this.getDefaultModelDetails();
    if (!modelDetails) {
      throw new Error(
        `No model details provided and no default configured. ` +
        `Set defaultProvider/defaultModel in config.json or ${this.envPrefix}_PROVIDER/${this.envPrefix}_MODEL env vars.`
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
        options?.sessionType ?? 'cli',
        options?.sessionIdentifier
      );
      sessionId = session.sessionId;
      sessionDir = session.sessionDir;
    }

    const interaction = new Interaction(modelDetails, stimulus, {
      id: sessionId,
      source: 'native',
      sourceId: sessionId,
    });

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

  // ── Onboarding ──────────────────────────────────────────────────

  async isOnboarded(): Promise<boolean> {
    return isOnboarded(this.workDir, this.configPath);
  }

  async onboard(templatePath?: string): Promise<OnboardingResult> {
    return runOnboarding(
      this.workDir,
      this.configPath,
      this.envPrefix,
      templatePath ?? this.options.stimulusTemplatePath
    );
  }

  // ── Secrets (reference-only) ────────────────────────────────────

  isSecretAvailable(name: string): boolean {
    return process.env[name] !== undefined;
  }

  getSecret(name: string): string | undefined {
    return process.env[name];
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
