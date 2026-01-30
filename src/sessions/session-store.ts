import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { readFile, access, writeFile, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { SessionsIndex, SessionIndexEntry } from './types.js';
import type { SessionAnalysisIndex } from './analysis-types.js';
import {
  parseSessionFileMetadata,
  isSessionJsonlFilename,
} from './session-parser.js';

/**
 * Get the path to Claude's sessions directory for a given project
 */
export function getClaudeProjectPath(projectPath: string): string {
  const claudeDir = join(homedir(), '.claude', 'projects');

  // Claude encodes project paths by replacing slashes with hyphens
  // Example: /Users/foo/project -> -Users-foo-project
  const encodedPath = projectPath.replace(/\//g, '-');

  return join(claudeDir, encodedPath);
}

/**
 * Get the path to the sessions index file for a given project
 */
export function getSessionsIndexPath(projectPath: string): string {
  return join(getClaudeProjectPath(projectPath), 'sessions-index.json');
}

/**
 * Check if a sessions index file exists for a given project
 */
export async function hasSessionsIndex(projectPath: string): Promise<boolean> {
  try {
    const indexPath = getSessionsIndexPath(projectPath);
    await access(indexPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse the sessions index file for a given project
 */
export async function readSessionsIndex(projectPath: string): Promise<SessionsIndex> {
  const indexPath = getSessionsIndexPath(projectPath);

  try {
    const content = await readFile(indexPath, 'utf-8');
    const index = JSON.parse(content) as SessionsIndex;

    // Validate basic structure
    if (!index.version || !Array.isArray(index.entries)) {
      throw new Error('Invalid sessions index format');
    }

    return index;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`No sessions index found for project: ${projectPath}`);
    }
    throw error;
  }
}

/**
 * Get session entries from the sessions-index.json only (no directory scan).
 * Use getProjectSessionsIncludingFromDirectory to include .jsonl files not in the index.
 */
export async function getProjectSessions(projectPath: string): Promise<SessionIndexEntry[]> {
  const index = await readSessionsIndex(projectPath);
  return index.entries;
}

/**
 * List full paths to session JSONL files in the project directory (UUID.jsonl, excluding agent-*.jsonl).
 * Does not require sessions-index.json to exist.
 */
export async function discoverSessionFilesInProject(projectPath: string): Promise<string[]> {
  const dir = getClaudeProjectPath(projectPath);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const sessionFiles = names.filter(
    (name) => isSessionJsonlFilename(name)
  );
  return sessionFiles.map((name) => join(dir, name));
}

/**
 * Build a SessionIndexEntry from a session JSONL file by streaming it for metadata.
 * Used for files that exist on disk but are not listed in sessions-index.json.
 */
export async function buildSessionEntryFromFile(
  filePath: string,
  projectPath: string
): Promise<SessionIndexEntry | null> {
  const name = basename(filePath, '.jsonl');
  if (!name || name.includes('.')) return null;
  let fileMtime: number;
  try {
    const st = await stat(filePath);
    fileMtime = st.mtimeMs;
  } catch {
    return null;
  }
  const meta = await parseSessionFileMetadata(filePath);
  if (!meta) return null;
  return {
    sessionId: name,
    fullPath: filePath,
    fileMtime,
    firstPrompt: meta.firstPrompt,
    messageCount: meta.messageCount,
    created: meta.created,
    modified: meta.modified,
    gitBranch: meta.gitBranch,
    projectPath,
    isSidechain: meta.isSidechain,
  };
}

/**
 * Get all session entries for a project by merging sessions-index.json with any
 * session .jsonl files in the project directory that are not in the index.
 * This ensures sessions created in Claude Code but not yet written to the index
 * (or when the index is stale) are still listed.
 */
export async function getProjectSessionsIncludingFromDirectory(
  projectPath: string
): Promise<SessionIndexEntry[]> {
  let indexEntries: SessionIndexEntry[] = [];
  try {
    const index = await readSessionsIndex(projectPath);
    indexEntries = index.entries;
  } catch {
    // No index or invalid - continue with directory discovery only
  }

  const knownIds = new Set(indexEntries.map((e) => e.sessionId));
  const files = await discoverSessionFilesInProject(projectPath);
  const discovered: SessionIndexEntry[] = [];

  for (const filePath of files) {
    const sessionId = basename(filePath, '.jsonl');
    if (knownIds.has(sessionId)) continue;
    const entry = await buildSessionEntryFromFile(filePath, projectPath);
    if (entry) {
      discovered.push(entry);
      knownIds.add(sessionId);
    }
  }

  const merged = [...indexEntries, ...discovered];
  merged.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  return merged;
}

/**
 * Get a specific session by ID
 */
export async function getSession(
  projectPath: string,
  sessionId: string
): Promise<SessionIndexEntry | undefined> {
  const entries = await getProjectSessions(projectPath);
  return entries.find(entry => entry.sessionId === sessionId);
}

/**
 * Get the most recent sessions for a project
 */
export async function getRecentSessions(
  projectPath: string,
  limit: number = 10
): Promise<SessionIndexEntry[]> {
  const entries = await getProjectSessions(projectPath);

  // Sort by modified timestamp (most recent first)
  const sorted = entries.sort((a, b) => {
    return new Date(b.modified).getTime() - new Date(a.modified).getTime();
  });

  return sorted.slice(0, limit);
}

/**
 * Filter sessions by criteria
 */
export interface SessionFilter {
  gitBranch?: string;
  isSidechain?: boolean;
  since?: Date;
  until?: Date;
  minMessages?: number;
  maxMessages?: number;
}

export async function filterSessions(
  projectPath: string,
  filter: SessionFilter
): Promise<SessionIndexEntry[]> {
  const entries = await getProjectSessions(projectPath);

  return entries.filter(entry => {
    // Filter by git branch
    if (filter.gitBranch && entry.gitBranch !== filter.gitBranch) {
      return false;
    }

    // Filter by sidechain status
    if (filter.isSidechain !== undefined && entry.isSidechain !== filter.isSidechain) {
      return false;
    }

    // Filter by date range
    const modified = new Date(entry.modified);
    if (filter.since && modified < filter.since) {
      return false;
    }
    if (filter.until && modified > filter.until) {
      return false;
    }

    // Filter by message count
    if (filter.minMessages !== undefined && entry.messageCount < filter.minMessages) {
      return false;
    }
    if (filter.maxMessages !== undefined && entry.messageCount > filter.maxMessages) {
      return false;
    }

    return true;
  });
}

/**
 * Get statistics about sessions for a project
 */
export interface SessionStats {
  totalSessions: number;
  totalMessages: number;
  sidechainSessions: number;
  branchCounts: Record<string, number>;
  oldestSession: string | null;
  newestSession: string | null;
}

export async function getSessionStats(projectPath: string): Promise<SessionStats> {
  const entries = await getProjectSessions(projectPath);

  const stats: SessionStats = {
    totalSessions: entries.length,
    totalMessages: 0,
    sidechainSessions: 0,
    branchCounts: {},
    oldestSession: null,
    newestSession: null,
  };

  if (entries.length === 0) {
    return stats;
  }

  // Calculate stats
  for (const entry of entries) {
    stats.totalMessages += entry.messageCount;

    if (entry.isSidechain) {
      stats.sidechainSessions++;
    }

    stats.branchCounts[entry.gitBranch] = (stats.branchCounts[entry.gitBranch] || 0) + 1;
  }

  // Find oldest and newest sessions
  const sorted = [...entries].sort((a, b) => {
    return new Date(a.created).getTime() - new Date(b.created).getTime();
  });

  stats.oldestSession = sorted[0].created;
  stats.newestSession = sorted[sorted.length - 1].created;

  return stats;
}

/**
 * Get the path to the analysis index file for a given project
 */
export function getAnalysisIndexPath(projectPath: string): string {
  return join(getClaudeProjectPath(projectPath), 'sessions-analysis-index.json');
}

/**
 * Check if an analysis index file exists for a given project
 */
export async function hasAnalysisIndex(projectPath: string): Promise<boolean> {
  try {
    const indexPath = getAnalysisIndexPath(projectPath);
    await access(indexPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse the analysis index file for a given project
 */
export async function readAnalysisIndex(projectPath: string): Promise<SessionAnalysisIndex> {
  const indexPath = getAnalysisIndexPath(projectPath);

  try {
    const content = await readFile(indexPath, 'utf-8');
    const index = JSON.parse(content) as SessionAnalysisIndex;

    // Validate basic structure
    if (!index.version || !Array.isArray(index.entries)) {
      throw new Error('Invalid analysis index format');
    }

    return index;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`No analysis index found for project: ${projectPath}`);
    }
    throw error;
  }
}

/**
 * Save the analysis index file for a given project
 */
export async function saveAnalysisIndex(
  projectPath: string,
  index: SessionAnalysisIndex
): Promise<void> {
  const indexPath = getAnalysisIndexPath(projectPath);
  const content = JSON.stringify(index, null, 2);
  await writeFile(indexPath, content, 'utf-8');
}
