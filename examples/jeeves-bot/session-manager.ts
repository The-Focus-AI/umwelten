/**
 * Session management for Jeeves bot.
 * Creates and manages session directories for storing interactions, media, and downloads.
 */

import { mkdir, readdir, stat, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getSessionsDir, ensureSessionsDir } from './config.js';

export interface SessionMetadata {
  sessionId: string;
  created: string;
  lastUsed: string;
  type: 'telegram' | 'cli' | 'other';
  chatId?: number; // For Telegram sessions
  metadata?: Record<string, any>;
}

/**
 * Get or create a session directory for the current interaction.
 * For Telegram, uses chatId. For CLI, uses a timestamp-based ID.
 */
export async function getOrCreateSession(
  type: 'telegram' | 'cli' | 'other',
  identifier?: string | number
): Promise<{ sessionId: string; sessionDir: string }> {
  await ensureSessionsDir();
  const sessionsDir = getSessionsDir();

  let sessionId: string;
  if (type === 'telegram' && identifier !== undefined) {
    sessionId = `telegram-${identifier}`;
  } else if (type === 'cli') {
    sessionId = `cli-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  } else {
    sessionId = identifier ? String(identifier) : `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  const sessionDir = join(sessionsDir, sessionId);
  await mkdir(sessionDir, { recursive: true });

  // Create or update metadata
  const metaPath = join(sessionDir, 'meta.json');
  let metadata: SessionMetadata;
  try {
    const existing = await readFile(metaPath, 'utf-8');
    metadata = JSON.parse(existing);
    metadata.lastUsed = new Date().toISOString();
  } catch {
    metadata = {
      sessionId,
      created: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      type,
      ...(type === 'telegram' && identifier !== undefined && { chatId: Number(identifier) }),
    };
  }
  await writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

  return { sessionId, sessionDir };
}

/**
 * Get session directory for a given session ID.
 */
export async function getSessionDir(sessionId: string): Promise<string | null> {
  const sessionsDir = getSessionsDir();
  const sessionDir = join(sessionsDir, sessionId);
  try {
    const stats = await stat(sessionDir);
    if (stats.isDirectory()) {
      return sessionDir;
    }
  } catch {
    // Directory doesn't exist
  }
  return null;
}

/**
 * List all sessions.
 */
export async function listSessions(): Promise<SessionMetadata[]> {
  const sessionsDir = getSessionsDir();
  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    const sessions: SessionMetadata[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metaPath = join(sessionsDir, entry.name, 'meta.json');
        try {
          const content = await readFile(metaPath, 'utf-8');
          const metadata = JSON.parse(content) as SessionMetadata;
          sessions.push(metadata);
        } catch {
          // Skip directories without metadata
        }
      }
    }

    return sessions.sort((a, b) => 
      new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime()
    );
  } catch {
    return [];
  }
}

/**
 * Get session metadata.
 */
export async function getSessionMetadata(sessionId: string): Promise<SessionMetadata | null> {
  const sessionDir = await getSessionDir(sessionId);
  if (!sessionDir) return null;

  const metaPath = join(sessionDir, 'meta.json');
  try {
    const content = await readFile(metaPath, 'utf-8');
    return JSON.parse(content) as SessionMetadata;
  } catch {
    return null;
  }
}

/**
 * Update session metadata (merge partial updates, shallow-merge metadata).
 */
export async function updateSessionMetadata(
  sessionId: string,
  updates: Partial<Pick<SessionMetadata, 'lastUsed'>> & { metadata?: Record<string, unknown> }
): Promise<void> {
  const sessionDir = await getSessionDir(sessionId);
  if (!sessionDir) return;

  const metaPath = join(sessionDir, 'meta.json');
  let metadata: SessionMetadata;
  try {
    const content = await readFile(metaPath, 'utf-8');
    metadata = JSON.parse(content) as SessionMetadata;
  } catch {
    return;
  }

  if (updates.lastUsed !== undefined) metadata.lastUsed = updates.lastUsed;
  if (updates.metadata !== undefined) {
    metadata.metadata = { ...metadata.metadata, ...updates.metadata };
  }
  await writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
}
