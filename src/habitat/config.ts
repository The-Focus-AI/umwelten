/**
 * Habitat configuration: directory resolution, config load/save, state file management.
 * Environment variable names are parameterized via envPrefix (not hardcoded).
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { HabitatConfig, HabitatOptions, AgentEntry } from './types.js';

// ── Directory resolution ──────────────────────────────────────────

/**
 * Resolve the work directory from options, env, or default.
 */
export function resolveWorkDir(options?: HabitatOptions): string {
  const prefix = options?.envPrefix ?? 'HABITAT';
  const defaultName = options?.defaultWorkDirName ?? '.habitat';

  // 1. Explicit option
  if (options?.workDir) return resolve(options.workDir);

  // 2. Environment variable
  const env = process.env[`${prefix}_WORK_DIR`];
  if (env) return resolve(env);

  // 3. Default under home
  return join(homedir(), defaultName);
}

/**
 * Resolve the sessions directory from options, env, or default.
 */
export function resolveSessionsDir(options?: HabitatOptions): string {
  const prefix = options?.envPrefix ?? 'HABITAT';
  const defaultName = options?.defaultSessionsDirName ?? '.habitat-sessions';

  if (options?.sessionsDir) return resolve(options.sessionsDir);

  const env = process.env[`${prefix}_SESSIONS_DIR`];
  if (env) return resolve(env);

  return join(homedir(), defaultName);
}

/**
 * Resolve the config file path from options, env, or default (workDir/config.json).
 */
export function resolveConfigPath(workDir: string, options?: HabitatOptions): string {
  const prefix = options?.envPrefix ?? 'HABITAT';

  if (options?.configPath) return resolve(options.configPath);

  const env = process.env[`${prefix}_CONFIG_PATH`];
  if (env) return resolve(env);

  return join(workDir, 'config.json');
}

// ── Directory creation ────────────────────────────────────────────

export async function ensureDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

// ── Config load/save ──────────────────────────────────────────────

function defaultConfig(): HabitatConfig {
  return { agents: [] };
}

export async function loadConfig(configPath: string): Promise<HabitatConfig> {
  try {
    const raw = await readFile(configPath, 'utf-8');
    const data = JSON.parse(raw) as HabitatConfig;
    if (!Array.isArray(data.agents)) {
      data.agents = [];
    }
    return data;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultConfig();
    }
    throw err;
  }
}

export async function saveConfig(configPath: string, config: HabitatConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

// ── State files (arbitrary JSON in work dir) ──────────────────────

export async function readStateFile<T>(workDir: string, filename: string): Promise<T | null> {
  const path = join(workDir, filename);
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeStateFile(workDir: string, filename: string, data: unknown): Promise<void> {
  const path = join(workDir, filename);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Work dir file helpers ─────────────────────────────────────────

export async function readWorkDirFile(workDir: string, relativePath: string): Promise<string | null> {
  const path = join(workDir, relativePath);
  try {
    const content = await readFile(path, 'utf-8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

export async function writeWorkDirFile(workDir: string, relativePath: string, content: string): Promise<void> {
  const path = join(workDir, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf-8');
}

// ── Agent helpers ─────────────────────────────────────────────────

export function getAgentById(config: HabitatConfig, idOrName: string): AgentEntry | undefined {
  return config.agents.find(a => a.id === idOrName || a.name === idOrName);
}

/** All roots allowed for file access: work dir, sessions dir, then agent project paths. */
export function getFileAllowedRoots(workDir: string, sessionsDir: string, config: HabitatConfig): string[] {
  const agentRoots = config.agents.map(a => a.projectPath).filter(Boolean);
  return [workDir, sessionsDir, ...agentRoots];
}

/** Check if a file exists and is readable. */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
