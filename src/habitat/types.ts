/**
 * Core types for the Habitat system.
 * A Habitat is the complete environment for an agent: work directory, config,
 * sessions, tools, skills, memory, and references to other habitats (agents).
 */

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
 * MCP server status for an agent.
 */
export type AgentMCPStatus = "running" | "stopped" | "error" | "starting";

/**
 * A known agent -- a reference to another habitat.
 * Secrets are references only (env var names), never stored values.
 */
export interface AgentEntry {
  id: string;
  name: string;
  projectPath: string;
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
  /** Port where agent's MCP server runs (auto-assigned). */
  mcpPort?: number;
  /** Whether MCP server is enabled for this agent. */
  mcpEnabled?: boolean;
  /** Current MCP server status. */
  mcpStatus?: AgentMCPStatus;
  /** Last error message if mcpStatus is 'error'. */
  mcpError?: string;
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
  /** Default sessions directory name under home (default: ".habitat-sessions"). */
  defaultSessionsDirName?: string;
  /** Override the habitat config (skip loading from disk). */
  config?: HabitatConfig;
  /** Custom tool registration callback (called after built-in tools). */
  registerCustomTools?: (habitat: any) => void | Promise<void>;
  /** Skip loading built-in tools (file ops, time, etc.). */
  skipBuiltinTools?: boolean;
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
  chatId?: number;
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
