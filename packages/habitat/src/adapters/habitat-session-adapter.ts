/**
 * Habitat Session Adapter
 *
 * Exposes Habitat session transcripts through the shared Source Session
 * / Exploration adapter pipeline. Habitat sessions live under a
 * configured sessions directory, each in a subdirectory with:
 *   - meta.json       — session metadata (HabitatSessionMetadata)
 *   - transcript.jsonl — Claude-style JSONL transcript
 *
 * Dependency direction: Habitat → Core (not the reverse).
 * Core does NOT import from @umwelten/habitat.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  SessionSource,
  NormalizedSession,
  NormalizedSessionEntry,
  NormalizedMessage,
  SessionDiscoveryOptions,
  SessionDiscoveryResult,
} from '@umwelten/core/interaction/types/normalized-types.js';
import type { SessionAdapter } from '@umwelten/core/interaction/adapters/adapter.js';
import type { HabitatSessionMetadata } from '../types.js';

const SOURCE: SessionSource = 'habitat';

// ── Adapter ─────────────────────────────────────────────────────────────

export class HabitatSessionAdapter implements SessionAdapter {
  readonly source: SessionSource = SOURCE;
  readonly displayName = 'Habitat';

  constructor(private readonly sessionsDir: string) {}

  getSourceLocation(): string {
    return this.sessionsDir;
  }

  async canHandle(_projectPath: string): Promise<boolean> {
    // Habitat adapter is configured with a sessionsDir, not auto-detected by project path
    // We return true only if the sessionsDir was explicitly set and exists
    try {
      const entries = await readdir(this.sessionsDir);
      // Check if there's at least one subdirectory with meta.json
      for (const entry of entries) {
        try {
          const metaPath = join(this.sessionsDir, entry, 'meta.json');
          await stat(metaPath);
          return true;
        } catch {
          // Not a valid session directory
        }
      }
      return false;
    } catch {
      // Sessions directory not accessible
      return false;
    }
  }

  async discoverProjects(): Promise<string[]> {
    // Habitat sessions are organized by the sessionsDir, not by project
    // Return the sessionsDir itself as a synthetic project path
    return [this.sessionsDir];
  }

  async discoverSessions(options?: SessionDiscoveryOptions): Promise<SessionDiscoveryResult> {
    const projectPath = options?.projectPath;
    if (projectPath && projectPath !== this.sessionsDir) {
      return { sessions: [], source: SOURCE, totalCount: 0, hasMore: false };
    }

    try {
      const entries = await readdir(this.sessionsDir);
      const sessions: NormalizedSessionEntry[] = [];

      for (const entry of entries) {
        try {
          const sessionDir = join(this.sessionsDir, entry);
          const metaPath = join(sessionDir, 'meta.json');
          const transcriptPath = join(sessionDir, 'transcript.jsonl');

          // Verify both files exist
          await stat(metaPath);
          await stat(transcriptPath);

          // Read metadata
          const metaRaw = await readFile(metaPath, 'utf-8');
          const meta = JSON.parse(metaRaw) as HabitatSessionMetadata;
          if (!meta.sessionId) continue;

          // Quick-line count for message count
          const raw = await readFile(transcriptPath, 'utf-8');
          const lines = raw.trim().split('\n').filter((l) => l.trim().length > 0);
          // Skip the first line if it's a session header
          const messageLines = lines.filter((l) => {
            try {
              const obj = JSON.parse(l);
              return obj.type === 'message';
            } catch {
              return false;
            }
          });

          const modTime = await stat(transcriptPath);
          const sessionId = `habitat-${entry}`;

          sessions.push({
            id: sessionId,
            source: SOURCE,
            sourceId: meta.sessionId,
            projectPath: this.sessionsDir,
            created: meta.created || new Date(modTime.birthtimeMs).toISOString(),
            modified: meta.lastUsed || new Date(modTime.mtimeMs).toISOString(),
            messageCount: messageLines.length,
            firstPrompt: this.extractFirstPrompt(lines),
            sourceData: {
              sessionDir,
              type: meta.type,
              model: meta.model,
              provider: meta.provider,
              agentId: meta.agentId,
            },
          });
        } catch {
        }
      }

      // Apply sorting
      const sortBy = options?.sortBy ?? 'modified';
      const sortOrder = options?.sortOrder ?? 'desc';
      sessions.sort((a, b) => {
        const aVal = sortBy === 'created' ? a.created : a.modified;
        const bVal = sortBy === 'created' ? b.created : b.modified;
        const cmp = aVal.localeCompare(bVal);
        return sortOrder === 'desc' ? -cmp : cmp;
      });

      // Apply limit
      const limit = options?.limit ?? sessions.length;
      const limited = sessions.slice(0, limit);

      return {
        sessions: limited,
        source: SOURCE,
        totalCount: sessions.length,
        hasMore: limited.length < sessions.length,
      };
    } catch {
      return { sessions: [], source: SOURCE, totalCount: 0, hasMore: false };
    }
  }

  async getSessionEntry(sessionId: string): Promise<NormalizedSessionEntry | null> {
    const [entry, sessionDir] = this.resolveSessionId(sessionId);
    if (!entry || !sessionDir) return null;

    try {
      const metaPath = join(sessionDir, 'meta.json');
      const metaRaw = await readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaRaw) as HabitatSessionMetadata;
      const transcriptPath = join(sessionDir, 'transcript.jsonl');
      const modTime = await stat(transcriptPath);
      const raw = await readFile(transcriptPath, 'utf-8');
      const lines = raw.trim().split('\n');
      const messageLines = lines.filter((l) => {
        try { const obj = JSON.parse(l); return obj.type === 'message'; }
        catch { return false; }
      });

      return {
        id: sessionId,
        source: SOURCE,
        sourceId: meta.sessionId,
        projectPath: this.sessionsDir,
        created: meta.created || new Date(modTime.birthtimeMs).toISOString(),
        modified: meta.lastUsed || new Date(modTime.mtimeMs).toISOString(),
        messageCount: messageLines.length,
        firstPrompt: this.extractFirstPrompt(lines),
        sourceData: {
          sessionDir,
          type: meta.type,
          model: meta.model,
          provider: meta.provider,
          agentId: meta.agentId,
        },
      };
    } catch {
      return null;
    }
  }

  async getSession(sessionId: string): Promise<NormalizedSession | null> {
    const entry = await this.getSessionEntry(sessionId);
    if (!entry) return null;

    const [, sessionDir] = this.resolveSessionId(sessionId);
    if (!sessionDir) return null;

    try {
      const raw = await readFile(join(sessionDir, 'transcript.jsonl'), 'utf-8');
      const lines = raw.trim().split('\n');
      const messages: NormalizedMessage[] = [];
      let msgIndex = 0;

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'message') {
            const msg = obj.message;
            if (!msg) continue;

            const content = typeof msg.content === 'string'
              ? msg.content
              : Array.isArray(msg.content)
                ? msg.content.map((b: any) => b.text ?? '').filter(Boolean).join('\n')
                : '';

            const normalized: NormalizedMessage = {
              id: `habitat-msg-${msgIndex}`,
              role: this.mapRole(msg.role),
              content,
              timestamp: obj.timestamp,
            };

            if (msg.role === 'toolResult') {
              normalized.tool = {
                name: msg.toolName ?? 'unknown',
                output: content,
                isError: msg.isError ?? false,
              };
            }
            if (msg.role === 'assistant' && msg.model) {
              normalized.model = msg.model;
            }

            messages.push(normalized);
            msgIndex++;
          }
        } catch {
        }
      }

      return {
        ...entry,
        messages,
      };
    } catch {
      return null;
    }
  }

  async getMessages(sessionId: string): Promise<NormalizedMessage[]> {
    const session = await this.getSession(sessionId);
    return session?.messages ?? [];
  }

  async hasSessionsForProject(projectPath: string): Promise<boolean> {
    return this.canHandle(projectPath);
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private resolveSessionId(sessionId: string): [string | null, string | null] {
    if (!sessionId.startsWith('habitat-')) return [null, null];
    const entry = sessionId.slice('habitat-'.length);
    const sessionDir = join(this.sessionsDir, entry);
    return [entry, sessionDir];
  }

  private extractFirstPrompt(lines: string[]): string {
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'message' && obj.message?.role === 'user') {
          const content = obj.message.content;
          if (typeof content === 'string') return content;
          if (Array.isArray(content)) {
            const texts = content.map((b: any) => b.text ?? '').filter(Boolean);
            if (texts.length > 0) return texts.join(' ');
          }
        }
      } catch {
      }
    }
    return '';
  }

  private mapRole(role: string): 'user' | 'assistant' | 'tool' | 'system' {
    switch (role) {
      case 'user': return 'user';
      case 'assistant': return 'assistant';
      case 'tool': return 'tool';
      case 'toolResult': return 'tool';
      default: return 'system';
    }
  }
}
