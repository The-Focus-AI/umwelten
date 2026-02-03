/**
 * Jeeves agent configuration: types and load/save.
 * Agent data and bot state live in the work directory (JEEVES_WORK_DIR, default ~/.jeeves).
 * Config file: <workDir>/config.json unless JEEVES_CONFIG_PATH is set.
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Commands to interact with this habitat (e.g. run CLI, start server).
 * Keys are arbitrary (e.g. "run", "cli", "install"); values are shell commands.
 */
export interface HabitatCommands {
  [key: string]: string;
}

export interface AgentEntry {
  id: string;
  name: string;
  projectPath: string;
  gitRemote?: string;
  secrets?: string[];
  /** Commands to run or interact with this habitat (e.g. `{ "cli": "pnpm run cli", "run": "pnpm start" }`). */
  commands?: HabitatCommands;
}

/**
 * Optional work-dir paths (relative to work dir).
 * - skillsDirs: directories containing SKILL.md subdirs
 * - skillsFromGit: git repo URLs or owner/repo for skills (cloned into skillsCacheDir)
 * - skillsCacheDir: directory under work dir where git repos are cloned (default "repos"); no global cache
 * - toolsDir: directory containing tool subdirs (each with TOOL.md and optional handler)
 * - stimulusFile: path to STIMULUS.md or main prompt file (e.g. "STIMULUS.md" or "prompts/main.md")
 */
export interface JeevesConfig {
  agents: AgentEntry[];
  skillsDirs?: string[];
  skillsFromGit?: string[];
  skillsCacheDir?: string;
  toolsDir?: string;
  stimulusFile?: string;
}

/** Default work dir when JEEVES_WORK_DIR is not set (e.g. ~/.jeeves). */
const DEFAULT_WORK_DIR = join(homedir(), '.jeeves');
/** Default sessions dir when JEEVES_SESSIONS_DIR is not set (e.g. ~/.jeeves-sessions). */
const DEFAULT_SESSIONS_DIR = join(homedir(), '.jeeves-sessions');

/**
 * Main work folder for the bot. The bot reads and writes its own files and agent config here.
 * If JEEVES_WORK_DIR is a relative path, it's resolved relative to process.cwd().
 */
export function getWorkDir(): string {
  const env = process.env.JEEVES_WORK_DIR;
  if (env) {
    // resolve() handles both absolute and relative paths
    // Relative paths are resolved relative to process.cwd()
    return resolve(env);
  }
  return DEFAULT_WORK_DIR;
}

/**
 * Sessions directory for storing all interactions, media files, and downloaded content.
 * Each session gets its own subdirectory.
 * If JEEVES_SESSIONS_DIR is a relative path, it's resolved relative to process.cwd().
 */
export function getSessionsDir(): string {
  const env = process.env.JEEVES_SESSIONS_DIR;
  if (env) {
    // resolve() handles both absolute and relative paths
    // Relative paths are resolved relative to process.cwd()
    return resolve(env);
  }
  return DEFAULT_SESSIONS_DIR;
}

/** Ensure the sessions directory exists. */
export async function ensureSessionsDir(): Promise<string> {
  const sessionsDir = getSessionsDir();
  await mkdir(sessionsDir, { recursive: true });
  return sessionsDir;
}

function getConfigPath(): string {
  if (process.env.JEEVES_CONFIG_PATH) {
    return resolve(process.env.JEEVES_CONFIG_PATH);
  }
  return join(getWorkDir(), 'config.json');
}

export async function loadConfig(): Promise<JeevesConfig> {
  const path = getConfigPath();
  try {
    const raw = await readFile(path, 'utf-8');
    const data = JSON.parse(raw) as JeevesConfig;
    if (!Array.isArray(data.agents)) {
      data.agents = [];
    }
    return data;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { agents: [] };
    }
    throw err;
  }
}

export async function saveConfig(config: JeevesConfig): Promise<void> {
  const path = getConfigPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2), 'utf-8');
}

/** Ensure the work directory exists (e.g. before writing config or other state). */
export async function ensureWorkDir(): Promise<string> {
  const workDir = getWorkDir();
  await mkdir(workDir, { recursive: true });
  return workDir;
}

/** Path to AGENT.md in the work directory (for loading on startup). */
export function getAgentMdPath(): string {
  return join(getWorkDir(), 'AGENT.md');
}

/** Load AGENT.md from the work directory if it exists; otherwise return null. */
export async function loadAgentMd(): Promise<string | null> {
  const path = getAgentMdPath();
  try {
    await access(path, constants.R_OK);
    const content = await readFile(path, 'utf-8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

export function getConfigPathForDisplay(): string {
  return getConfigPath();
}

export function getAgentById(config: JeevesConfig, id: string): AgentEntry | undefined {
  return config.agents.find(a => a.id === id || a.name === id);
}

/** Roots allowed for agent project file access (excludes work dir). */
export function getAllowedRoots(config: JeevesConfig): string[] {
  return config.agents.map(a => a.projectPath).filter(Boolean);
}

/** Roots allowed for all file tools: work dir, sessions dir, then agent project paths. */
export function getFileAllowedRoots(config: JeevesConfig): string[] {
  return [getWorkDir(), getSessionsDir(), ...getAllowedRoots(config)];
}
