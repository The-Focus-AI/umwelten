/**
 * Habitat: the central system for an agent.
 * Manages work directory, sessions, config, stimulus, tools, skills, and known agents.
 * Any UI (CLI, Telegram, TUI, web) starts from a Habitat.
 */

import { join, isAbsolute, resolve as resolveAbs } from "node:path";
import type { Tool } from "ai";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import { InteractionStore } from "@umwelten/core/interaction/persistence/interaction-store.js";
import { loadToolsFromDirectory } from "@umwelten/core/stimulus/tools/loader.js";
import type { SkillDefinition } from "@umwelten/core/stimulus/skills/types.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import type {
  AgentHost,
  HabitatConfig,
  HabitatOptions,
  HabitatSessionMetadata,
  HabitatSessionType,
  AgentEntry,
  AgentRequirements,
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
  findReadOnlyAgentForPath,
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
import {
  type AgentVault,
  InlineVault,
  HabitatVault,
  OnePasswordVault,
} from "./identity/vault.js";
import { inspectSkill, mergeRequirements } from "./identity/skill-inspector.js";
import {
  loadAgentManifest,
  type AgentManifest,
  AgentManifestError,
} from "./identity/agent-manifest.js";

export class Habitat
  implements
    AgentHost,
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
    const sessionsDir = resolveSessionsDir(opts, workDir);
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


    // 6. Register tool sets (unless skipped)
    if (!opts.skipBuiltinTools) {
      const toolSets = opts.toolSets ?? standardToolSets;
      for (const toolSet of toolSets) {
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

  findReadOnlyAgentForPath(absPath: string): { agentId: string; root: string } | undefined {
    return findReadOnlyAgentForPath(this.config, absPath);
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
      const defaultSkillsDirs = this.config.skillsDirs ?? ["./skills"];
      // Also check .agents/skills (npx skills install location)
      if (!defaultSkillsDirs.includes("./.agents/skills") && !defaultSkillsDirs.includes(".agents/skills")) {
        defaultSkillsDirs.push("./.agents/skills");
      }
      const skillsDirsResolved = defaultSkillsDirs.map(
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

  // ── Provisioning manifest (Habitat Runtime spec, Phase 3) ──────────

  /**
   * Aggregate the env vars + CLI tools every loaded skill and configured agent
   * needs. Used by GET /api/manifest to produce the reproducibility view.
   *
   * Skill requirements are *discovered* (not declared) by scanning skill source
   * via inspectSkill(). Per-agent requirements are read from agent.requirements
   * if present, otherwise omitted.
   */
  async computeRequirements(): Promise<{
    skills: { name: string; path: string; requirements: AgentRequirements }[];
    agents: { id: string; requirements: AgentRequirements }[];
    aggregate: AgentRequirements;
  }> {
    // Skills are normally populated only after a session is created (which is
    // when the SkillsRegistry is built). Provisioning manifests are useful
    // before any session exists, so we union the loaded registry with a fresh
    // disk scan of the configured skillsDirs to give a complete view either way.
    const loaded = this.getSkills();
    const fromDirs: typeof loaded = [];
    const seen = new Set(loaded.map(s => s.path));
    const { loadSkillsFromDirectory } = await import("@umwelten/core/stimulus/skills/index.js");
    for (const dir of this.config.skillsDirs ?? []) {
      const abs = isAbsolute(dir) ? dir : resolveAbs(this.workDir, dir);
      try {
        const fresh = await loadSkillsFromDirectory(abs);
        for (const s of fresh) {
          if (!seen.has(s.path)) {
            fromDirs.push(s);
            seen.add(s.path);
          }
        }
      } catch {
        // tolerate missing/unreadable skill dirs
      }
    }
    const all = [...loaded, ...fromDirs];

    const skills = await Promise.all(
      all.map(async (s) => ({
        name: s.name,
        path: s.path,
        requirements: await inspectSkill(s.path),
      })),
    );
    const agents = (this.config.agents ?? [])
      .filter((a) => a.requirements)
      .map((a) => ({ id: a.id, requirements: a.requirements as AgentRequirements }));

    const aggregate = mergeRequirements([
      ...skills.map((s) => s.requirements),
      ...agents.map((a) => a.requirements),
    ]);
    return { skills, agents, aggregate };
  }

  /**
   * List all `kind: "mcp-agent"` agents that have a valid agent-manifest.json
   * in their repo. Used by container-server to mount the public UI + MCP
   * surface for each one.
   *
   * Tolerant: an agent without a manifest is silently skipped (returned in
   * the `unmanifested` list); a malformed manifest is reported in `errors`
   * but does not throw.
   */
  async getMcpAgents(): Promise<{
    mcpAgents: { agent: AgentEntry; manifest: AgentManifest; path: string }[];
    unmanifested: AgentEntry[];
    errors: { agent: AgentEntry; error: string }[];
  }> {
    const mcpAgents: { agent: AgentEntry; manifest: AgentManifest; path: string }[] = [];
    const unmanifested: AgentEntry[] = [];
    const errors: { agent: AgentEntry; error: string }[] = [];
    for (const agent of this.config.agents ?? []) {
      if (agent.kind !== "mcp-agent") continue;
      try {
        const result = await loadAgentManifest(agent.projectPath);
        if (!result) {
          unmanifested.push(agent);
          continue;
        }
        mcpAgents.push({ agent, manifest: result.manifest, path: result.path });
      } catch (err) {
        errors.push({
          agent,
          error: err instanceof AgentManifestError ? err.message : String(err),
        });
      }
    }
    return { mcpAgents, unmanifested, errors };
  }

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

  // ── Agent directory management ────

  getAgentDir(agentId: string): string {
    return join(this.workDir, "agents", agentId);
  }

  async ensureAgentDir(agentId: string): Promise<void> {
    const agentDir = this.getAgentDir(agentId);
    await ensureDir(agentDir);
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

  // ── Per-agent vault resolution (Habitat Runtime spec, Phase 2) ──

  /**
   * Build the AgentVault for an agent based on its identity.vault.backend.
   * Defaults to HabitatVault (existing behavior) when no identity is set.
   */
  getVaultForAgent(agentId: string): AgentVault {
    const agent = this.getAgent(agentId);
    const backend = agent?.identity?.vault?.backend ?? "habitat";
    switch (backend) {
      case "inline":
        return new InlineVault(this.getAgentDir(agentId));
      case "1password":
        return new OnePasswordVault(agent?.identity?.vault?.ref);
      case "habitat":
      default:
        return new HabitatVault(this.workDir);
    }
  }

  /**
   * Resolve a secret for an agent, falling back to the habitat-level store
   * (and then process.env) if the agent's vault doesn't have it.
   */
  async resolveAgentSecret(agentId: string, name: string): Promise<string | undefined> {
    const vault = this.getVaultForAgent(agentId);
    const fromVault = await vault.resolve(name);
    if (fromVault !== undefined) return fromVault;
    return this.getSecret(name);
  }

  /**
   * Build the env object for an agent's commands: union of every scope's
   * env-var names, resolved through the agent's vault chain.
   * Only includes names with values (silently drops missing ones).
   */
  async buildAgentEnv(agentId: string): Promise<Record<string, string>> {
    const agent = this.getAgent(agentId);
    if (!agent) return {};
    const env: Record<string, string> = {};
    const seen = new Set<string>();

    // Collect env-var names from identity.scopes plus the legacy `secrets` field.
    const names: string[] = [];
    for (const scope of agent.identity?.scopes ?? []) {
      for (const n of scope.env) {
        if (!seen.has(n)) { names.push(n); seen.add(n); }
      }
    }
    for (const n of agent.secrets ?? []) {
      if (!seen.has(n)) { names.push(n); seen.add(n); }
    }

    for (const name of names) {
      const value = await this.resolveAgentSecret(agentId, name);
      if (value !== undefined) env[name] = value;
    }
    return env;
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
