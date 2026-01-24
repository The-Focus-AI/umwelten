import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { SessionsIndex, SessionIndexEntry } from './types.js';

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
 * Get all session entries for a given project
 */
export async function getProjectSessions(projectPath: string): Promise<SessionIndexEntry[]> {
  const index = await readSessionsIndex(projectPath);
  return index.entries;
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
