/**
 * Core types for the Habitat system.
 * A Habitat is the complete environment for an agent: work directory, config,
 * sessions, tools, skills, memory, and references to other habitats (agents).
 */

import type { Tool } from 'ai';
import type { Stimulus } from '@umwelten/core/stimulus/stimulus.js';
import type { ModelDetails } from '@umwelten/core/cognition/types.js';
import type { SkillDefinition } from '@umwelten/core/stimulus/skills/types.js';
import type { SessionManagerSessionOptions } from './session-manager.js';

/**
 * AgentHost — the abstract interface that platform adapters (ChannelBridge,
 * WebAdapter, route handlers) depend on instead of the concrete Habitat class.
 *
 * This breaks the circular dependency between src/habitat/ (Layer 6) and
 * src/ui/ (Layer 8). UI code imports this interface from types.ts; the
 * concrete Habitat class implements it.
 */
export interface AgentHost {
  readonly workDir: string;
  readonly configPath: string;

  getConfig(): HabitatConfig;
  reloadConfig(): Promise<HabitatConfig>;
  getDefaultModelDetails(): ModelDetails | undefined;
  setRuntimeModelDetails(details: ModelDetails): void;

  getAgents(): AgentEntry[];
  getAgent(idOrName: string): AgentEntry | undefined;
  getAgentDir(agentId: string): string;

  getStimulus(): Promise<Stimulus>;
  getTools(): Record<string, Tool>;
  getSkills(): SkillDefinition[];

  getWorkDir(): string;
  getSessionsDir(): string;
  getAllowedRoots(): string[];

  getOrCreateSession(
    type: HabitatSessionType,
    identifier?: string | number,
    options?: SessionManagerSessionOptions,
  ): Promise<{ sessionId: string; sessionDir: string }>;
  updateSessionMetadata(sessionId: string, patch: Record<string, unknown>): Promise<void>;
  listSessions(): Promise<HabitatSessionMetadata[]>;
  getSessionDir(sessionId: string): Promise<string | null>;

  getSecret(name: string): string | undefined;
  setSecret(name: string, value: string): Promise<void>;

  createInteraction(options: {
    sessionId?: string;
    sessionType?: HabitatSessionType;
    modelDetails?: ModelDetails;
  }): Promise<{ interaction: import('@umwelten/core/interaction/core/interaction.js').Interaction; sessionDir: string }>;
}

/**
 * Commands to interact with a habitat (e.g. run CLI, start server).
 * Keys are arbitrary (e.g. "run", "cli", "install"); values are shell commands.
 */
export interface HabitatCommands {
  [key: string]: string;
}

/** Log file discovery pattern for an agent. */
export interface LogPattern {
  /** Glob pattern relative to project root, e.g. "logs/*.jsonl" */
  pattern: string;
  /** Format of the log files. */
  format: "jsonl" | "plain";
}


/**
 * A required secret declaration for reproducible provisioning.
 */
export interface RequiredSecret {
  name: string;
  description?: string;
  required: boolean;
}

/**
 * A known agent -- a reference to another habitat.
 * Secrets are references only (env var names), never stored values.
 */
export interface AgentEntry {
  id: string;
  name: string;
  projectPath: string;
  /** Optional absolute path for the agent's semantic memory file. */
  memoryPath?: string;
  gitRemote?: string;
  /** Secret references (env var names). Values are never stored. */
  secrets?: string[];
  /** Commands to run or interact with this habitat. */
  commands?: HabitatCommands;
  /** Where to find log files (auto-detected or configured). */
  logPatterns?: LogPattern[];
  /** Relative path to a status file (e.g. "status.md"). */
  statusFile?: string;
  /** Git repos for skills this agent needs (e.g. "Focus-AI/chrome-driver"). */
  skillsFromGit?: string[];
}

/**
 * Habitat configuration stored in config.json.
 */
export interface HabitatConfig {
  /** Display name for this habitat. */
  name?: string;
  /** Default LLM provider (e.g. "google", "openai"). */
  defaultProvider?: string;
  /** Default model name (e.g. "gemini-3-flash-preview"). */
  defaultModel?: string;
  /** Known agents (references to other habitats). */
  agents: AgentEntry[];
  /** Relative paths to skill directories under workDir. */
  skillsDirs?: string[];
  /** Git repos to clone for skills (e.g. "owner/repo"). */
  skillsFromGit?: string[];
  /** Directory under workDir for git-cloned skills (default: "repos"). */
  skillsCacheDir?: string;
  /** Directory under workDir containing tool subdirs (default: "tools"). */
  toolsDir?: string;
  /** Path to STIMULUS.md or main prompt file (default: "STIMULUS.md"). */
  stimulusFile?: string;
  /** Optional memory file loading configuration. */
  memoryFiles?: {
    /** Whether to load memory files into stimulus context. Default: false. */
    enabled: boolean;
    /** Files to load (e.g. ["memories.md", "facts.md"]). */
    files?: string[];
    /** Journal file for reflective logging (e.g. "private journal.md"). */
    journalFile?: string;
  };
  /** Git URL for reproducible provisioning (cloned into projectDir). */
  gitUrl?: string;
  /** Git branch to check out (default: main). */
  gitBranch?: string;
  /** Subdirectory for the git clone, relative to workDir (default: "project"). */
  projectDir?: string;
  /** Secrets required for this habitat to function. */
  requiredSecrets?: RequiredSecret[];
  /** Extension point for habitat-specific config. */
  extensions?: Record<string, unknown>;
}

/**
 * Options for creating a Habitat.
 */
export interface HabitatOptions {
  /** Work directory (absolute or relative to cwd). */
  workDir?: string;
  /** Sessions directory (absolute or relative to cwd). */
  sessionsDir?: string;
  /** Config file path override. */
  configPath?: string;
  /**
   * Environment variable prefix (default: "HABITAT").
   * e.g. prefix "JEEVES" => JEEVES_WORK_DIR, JEEVES_SESSIONS_DIR, JEEVES_CONFIG_PATH
   */
  envPrefix?: string;
  /** Default work directory name under home (default: ".habitat"). */
  defaultWorkDirName?: string;
  /** Override the habitat config (skip loading from disk). */
  config?: HabitatConfig;
  /** Custom tool registration callback (called after built-in tools). */
  registerCustomTools?: (habitat: any) => void | Promise<void>;
  /** Skip loading built-in tools (file ops, time, etc.). */
  skipBuiltinTools?: boolean;
  /** Override which tool sets to register (default: standardToolSets). */
  toolSets?: import("./tool-sets.js").ToolSet[];
  /** Skip loading work-dir tools from tools/ directory. */
  skipWorkDirTools?: boolean;
  /** Skip loading skills. */
  skipSkills?: boolean;
  /** Path to a stimulus template file for onboarding. */
  stimulusTemplatePath?: string;
}

/**
 * Session type identifiers.
 */
export type HabitatSessionType =
  | "cli"
  | "telegram"
  | "discord"
  | "web"
  | "tui"
  | "api"
  | string;

/**
 * Session metadata stored in meta.json within each session directory.
 */
export interface HabitatSessionMetadata {
  sessionId: string;
  created: string;
  lastUsed: string;
  type: HabitatSessionType;
  /** LLM provider used for this session. */
  provider?: string;
  /** LLM model used for this session. */
  model?: string;
  chatId?: number;
  /** Discord text/DM channel snowflake when type is discord. */
  discordChannelId?: string;
  /** Stable user identifier (from the auth layer, e.g. web or Telegram sender). */
  userId?: string;
  /** Bound Discord agent id or Telegram/habitat label when set at session init. */
  agentId?: string;
  /** Stable routing signature (e.g. `agent:my-agent:default` or `main`) for Discord. */
  routeSignature?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Result of onboarding/first-run setup.
 */
export interface OnboardingResult {
  workDir: string;
  created: string[];
  skipped: string[];
}
