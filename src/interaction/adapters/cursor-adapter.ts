/**
 * Cursor session adapter
 *
 * Reads sessions from Cursor's SQLite storage format.
 * - Workspace: ~/Library/Application Support/Cursor/User/workspaceStorage/{hash}/state.vscdb
 *   ItemTable: aiService.prompts, composer.composerData
 * - Global:    ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
 *   cursorDiskKV: composerData:{composerId}, bubbleId:{composerId}:{bubbleId}
 */

import { homedir, platform } from 'node:os';
import { join, basename, resolve } from 'node:path';
import { readdir, readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import Database from 'better-sqlite3';

import type { SessionAdapter } from './adapter.js';
import type {
  SessionSource,
  NormalizedSession,
  NormalizedSessionEntry,
  NormalizedMessage,
  SessionMetrics,
  SessionDiscoveryOptions,
  SessionDiscoveryResult,
} from '../types/normalized-types.js';

/**
 * Cursor prompt entry from aiService.prompts
 */
interface CursorPrompt {
  text: string;
  commandType?: number;
}

/**
 * Cursor composer entry from composer.composerData
 */
interface CursorComposerData {
  allComposers?: Array<{
    composerId: string;
    createdAt?: number;
    updatedAt?: number;
    unifiedMode?: string;
    isArchived?: boolean;
  }>;
  selectedComposerIds?: string[];
}

/**
 * Cursor session adapter implementation
 */
export class CursorAdapter implements SessionAdapter {
  readonly source: SessionSource = 'cursor';
  readonly displayName = 'Cursor';

  private cursorStoragePath: string;

  constructor() {
    // Platform-specific storage paths
    const os = platform();
    if (os === 'darwin') {
      this.cursorStoragePath = join(
        homedir(),
        'Library/Application Support/Cursor/User/workspaceStorage'
      );
    } else if (os === 'win32') {
      this.cursorStoragePath = join(
        process.env.APPDATA || join(homedir(), 'AppData/Roaming'),
        'Cursor/User/workspaceStorage'
      );
    } else {
      // Linux
      this.cursorStoragePath = join(homedir(), '.config/Cursor/User/workspaceStorage');
    }
  }

  getSourceLocation(): string {
    return this.cursorStoragePath;
  }

  /** Path to globalStorage state.vscdb (composer content lives here). */
  private getGlobalStorageDbPath(): string {
    return join(this.cursorStoragePath, '..', 'globalStorage', 'state.vscdb');
  }

  /** Extract first non-empty text from Cursor richText JSON (Lexical editor format). */
  private extractTextFromRichText(richTextJson: string): string {
    const visit = (node: unknown): string => {
      if (!node || typeof node !== 'object') return '';
      const n = node as Record<string, unknown>;
      if (typeof n.text === 'string' && n.text.trim().length > 0) {
        return n.text.trim().slice(0, 500);
      }
      const children = n.children;
      if (Array.isArray(children)) {
        for (const c of children) {
          const t = visit(c);
          if (t) return t;
        }
      }
      return '';
    };
    try {
      const root = JSON.parse(richTextJson) as { root?: unknown };
      return visit(root?.root) || '';
    } catch {
      return '';
    }
  }

  /** Read first prompt and message count for a composer from globalStorage (cursorDiskKV). */
  private async getComposerPromptAndCount(composerId: string): Promise<{ firstPrompt: string; messageCount: number } | null> {
    const globalPath = this.getGlobalStorageDbPath();
    try {
      await access(globalPath, constants.R_OK);
    } catch {
      return null;
    }
    try {
      const db = new Database(globalPath, { readonly: true });
      try {
        const row = db
          .prepare('SELECT value FROM cursorDiskKV WHERE key = ?')
          .get(`composerData:${composerId}`) as { value: Buffer | string } | undefined;
        if (!row) return null;
        const data = JSON.parse(row.value.toString()) as {
          fullConversationHeadersOnly?: Array<{ bubbleId: string; type: number }>;
        };
        const headers = data.fullConversationHeadersOnly;
        if (!Array.isArray(headers) || headers.length === 0) {
          return { firstPrompt: '', messageCount: 0 };
        }
        const firstUser = headers.find((h) => h.type === 1);
        let firstPrompt = '';
        if (firstUser?.bubbleId) {
          const bubbleRow = db
            .prepare('SELECT value FROM cursorDiskKV WHERE key = ?')
            .get(`bubbleId:${composerId}:${firstUser.bubbleId}`) as { value: Buffer | string } | undefined;
          if (bubbleRow) {
            const bubble = JSON.parse(bubbleRow.value.toString()) as { richText?: string };
            if (typeof bubble.richText === 'string') {
              firstPrompt = this.extractTextFromRichText(bubble.richText);
            }
          }
        }
        return { firstPrompt, messageCount: headers.length };
      } finally {
        db.close();
      }
    } catch {
      return null;
    }
  }

  async canHandle(projectPath: string): Promise<boolean> {
    // Check if any workspace storage contains sessions for this project
    try {
      const workspaces = await this.findWorkspacesForProject(projectPath);
      return workspaces.length > 0;
    } catch {
      return false;
    }
  }

  async discoverProjects(): Promise<string[]> {
    const projects: string[] = [];

    try {
      const entries = await readdir(this.cursorStoragePath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const workspacePath = join(this.cursorStoragePath, entry.name);
        const resolvedProject = await this.resolveWorkspaceProject(workspacePath);

        if (resolvedProject && !projects.includes(resolvedProject)) {
          projects.push(resolvedProject);
        }
      }
    } catch {
      // Storage path doesn't exist or not readable
    }

    return projects;
  }

  /**
   * Normalize project path for reliable comparison (resolved absolute, no trailing slash).
   * Ensures cwd(), symlinks, and workspace.json folder all match.
   */
  private normalizeProjectPath(pathStr: string): string {
    return resolve(pathStr).replace(/\/$/, '');
  }

  async discoverSessions(options?: SessionDiscoveryOptions): Promise<SessionDiscoveryResult> {
    const allSessions: NormalizedSessionEntry[] = [];
    const requestedProject = options?.projectPath
      ? this.normalizeProjectPath(options.projectPath)
      : undefined;

    try {
      const workspaceDirs = await readdir(this.cursorStoragePath, { withFileTypes: true });

      for (const dir of workspaceDirs) {
        if (!dir.isDirectory()) continue;

        const workspacePath = join(this.cursorStoragePath, dir.name);

        // If project path specified, check if this workspace matches
        if (requestedProject) {
          const resolvedProject = await this.resolveWorkspaceProject(workspacePath);
          if (
            resolvedProject === undefined ||
            this.normalizeProjectPath(resolvedProject) !== requestedProject
          ) {
            continue;
          }
        }

        // Read sessions from this workspace
        const sessions = await this.readWorkspaceSessions(workspacePath);
        allSessions.push(...sessions);
      }
    } catch {
      // Storage not available
    }

    // Apply filters
    let filtered = allSessions;

    if (options?.gitBranch) {
      filtered = filtered.filter(s => s.gitBranch === options.gitBranch);
    }

    if (options?.since) {
      filtered = filtered.filter(s => new Date(s.created) >= options.since!);
    }

    if (options?.until) {
      filtered = filtered.filter(s => new Date(s.created) <= options.until!);
    }

    // Sort
    const sortBy = options?.sortBy || 'modified';
    const sortOrder = options?.sortOrder || 'desc';
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'created':
          comparison = new Date(a.created).getTime() - new Date(b.created).getTime();
          break;
        case 'modified':
          comparison = new Date(a.modified).getTime() - new Date(b.modified).getTime();
          break;
        case 'messageCount':
          comparison = a.messageCount - b.messageCount;
          break;
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    const totalCount = filtered.length;

    // Apply limit
    if (options?.limit && options.limit > 0) {
      filtered = filtered.slice(0, options.limit);
    }

    return {
      sessions: filtered,
      source: this.source,
      totalCount,
      hasMore: totalCount > filtered.length,
    };
  }

  async getSessionEntry(sessionId: string): Promise<NormalizedSessionEntry | null> {
    const parsed = this.parseCursorSessionId(sessionId);
    if (!parsed) return null;

    try {
      const sessions = await this.readWorkspaceSessions(parsed.workspacePath);
      return sessions.find((s) => s.id === sessionId) || null;
    } catch {
      return null;
    }
  }

  async getSession(sessionId: string): Promise<NormalizedSession | null> {
    const parsed = this.parseCursorSessionId(sessionId);
    if (!parsed) return null;

    const { workspacePath, workspaceHash, composerId } = parsed;
    const dbPath = join(workspacePath, 'state.vscdb');

    try {
      await access(dbPath, constants.R_OK);
      const db = new Database(dbPath, { readonly: true });

      try {
        const promptsRow = db
          .prepare('SELECT value FROM ItemTable WHERE key = ?')
          .get('aiService.prompts') as { value: Buffer | string } | undefined;

        const prompts: CursorPrompt[] = promptsRow
          ? JSON.parse(promptsRow.value.toString())
          : [];

        const composerRow = db
          .prepare('SELECT value FROM ItemTable WHERE key = ?')
          .get('composer.composerData') as { value: Buffer | string } | undefined;

        const composerData: CursorComposerData = composerRow
          ? JSON.parse(composerRow.value.toString())
          : {};

        const projectPath = await this.resolveWorkspaceProject(workspacePath);
        const composers = (composerData.allComposers || []).filter((c) => c.composerId);

        if (composerId) {
          const composer = composers.find((c) => c.composerId === composerId);
          if (!composer) {
            db.close();
            return null;
          }
          const ts = composer.updatedAt ?? composer.createdAt;
          const created = composer.createdAt
            ? new Date(composer.createdAt).toISOString()
            : new Date().toISOString();
          const modified = ts ? new Date(ts).toISOString() : created;

          // Load message count and first prompt from globalStorage (same as list view)
          let messageCount = 0;
          let firstPrompt = '';
          const enriched = await this.getComposerPromptAndCount(composerId);
          if (enriched) {
            messageCount = enriched.messageCount;
            firstPrompt = enriched.firstPrompt;
          }

          return {
            id: sessionId,
            source: this.source,
            sourceId: composerId,
            projectPath,
            workspacePath,
            created,
            modified,
            messages: [],
            messageCount,
            firstPrompt,
            metrics: { userMessages: 0, assistantMessages: 0, toolCalls: 0 },
            sourceData: { workspaceHash, composerId },
          };
        }

        const messages = this.convertPrompts(prompts);
        const firstComposer = composers[0];
        const created = firstComposer?.createdAt
          ? new Date(firstComposer.createdAt).toISOString()
          : new Date().toISOString();

        const metrics: SessionMetrics = {
          userMessages: messages.filter((m) => m.role === 'user').length,
          assistantMessages: messages.filter((m) => m.role === 'assistant').length,
          toolCalls: 0,
        };

        return {
          id: sessionId,
          source: this.source,
          sourceId: workspaceHash,
          projectPath,
          workspacePath,
          created,
          modified: created,
          messages,
          messageCount: messages.length,
          firstPrompt: prompts[0]?.text || '',
          metrics,
          sourceData: { workspaceHash, composerCount: composers.length },
        };
      } finally {
        db.close();
      }
    } catch {
      return null;
    }
  }

  async getMessages(sessionId: string): Promise<NormalizedMessage[]> {
    const session = await this.getSession(sessionId);
    return session?.messages || [];
  }

  async hasSessionsForProject(projectPath: string): Promise<boolean> {
    const workspaces = await this.findWorkspacesForProject(projectPath);
    return workspaces.length > 0;
  }

  // ---- Private helper methods ----

  /**
   * Parse cursor session id: cursor:{workspaceHash} or cursor:{workspaceHash}:{composerId}
   */
  private parseCursorSessionId(
    sessionId: string
  ): { workspacePath: string; workspaceHash: string; composerId?: string } | null {
    if (!sessionId.startsWith('cursor:')) return null;
    const rest = sessionId.slice(7);
    const parts = rest.split(':');
    if (parts.length < 1 || !parts[0]) return null;
    const workspaceHash = parts[0];
    const composerId = parts.length > 1 ? parts.slice(1).join(':') : undefined;
    const workspacePath = join(this.cursorStoragePath, workspaceHash);
    return { workspacePath, workspaceHash, composerId };
  }

  private async findWorkspacesForProject(projectPath: string): Promise<string[]> {
    const matching: string[] = [];
    const normalizedRequested = this.normalizeProjectPath(projectPath);

    try {
      const entries = await readdir(this.cursorStoragePath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const workspacePath = join(this.cursorStoragePath, entry.name);
        const resolvedProject = await this.resolveWorkspaceProject(workspacePath);

        if (
          resolvedProject !== undefined &&
          this.normalizeProjectPath(resolvedProject) === normalizedRequested
        ) {
          matching.push(workspacePath);
        }
      }
    } catch {
      // Storage not available
    }

    return matching;
  }

  private async resolveWorkspaceProject(workspacePath: string): Promise<string | undefined> {
    // Try to read workspace.json to get the actual project path
    const workspaceJsonPath = join(workspacePath, 'workspace.json');

    try {
      const content = await readFile(workspaceJsonPath, 'utf-8');
      const workspace = JSON.parse(content);

      // workspace.json contains a "folder" field with the project URI (e.g. file:///Users/.../project)
      if (workspace.folder) {
        const raw = workspace.folder.replace(/^file:\/\//, '');
        const decoded = raw.includes('%') ? decodeURIComponent(raw) : raw;
        return this.normalizeProjectPath(decoded);
      }
    } catch {
      // workspace.json doesn't exist or is invalid
    }

    return undefined;
  }

  private async readWorkspaceSessions(workspacePath: string): Promise<NormalizedSessionEntry[]> {
    const dbPath = join(workspacePath, 'state.vscdb');
    const sessions: NormalizedSessionEntry[] = [];

    try {
      await access(dbPath, constants.R_OK);
      const db = new Database(dbPath, { readonly: true });

      try {
        const promptsRow = db
          .prepare('SELECT value FROM ItemTable WHERE key = ?')
          .get('aiService.prompts') as { value: Buffer | string } | undefined;

        const prompts: CursorPrompt[] = promptsRow
          ? JSON.parse(promptsRow.value.toString())
          : [];

        const composerRow = db
          .prepare('SELECT value FROM ItemTable WHERE key = ?')
          .get('composer.composerData') as { value: Buffer | string } | undefined;

        const composerData: CursorComposerData = composerRow
          ? JSON.parse(composerRow.value.toString())
          : {};

        const workspaceHash = basename(workspacePath);
        const projectPath = await this.resolveWorkspaceProject(workspacePath);

        const composers = (composerData.allComposers || [])
          .filter((c) => c.composerId)
          .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

        if (composers.length > 0) {
          for (const composer of composers) {
            const ts = composer.updatedAt ?? composer.createdAt;
            const created = composer.createdAt
              ? new Date(composer.createdAt).toISOString()
              : new Date().toISOString();
            const modified = ts ? new Date(ts).toISOString() : created;

            let messageCount = 0;
            let firstPrompt = '';
            const enriched = await this.getComposerPromptAndCount(composer.composerId);
            if (enriched) {
              messageCount = enriched.messageCount;
              firstPrompt = enriched.firstPrompt;
            }

            sessions.push({
              id: `cursor:${workspaceHash}:${composer.composerId}`,
              source: this.source,
              sourceId: composer.composerId,
              projectPath,
              created,
              modified,
              messageCount,
              firstPrompt,
              metrics: { userMessages: 0, assistantMessages: 0, toolCalls: 0 },
            });
          }
        } else if (prompts.length > 0) {
          const created = new Date().toISOString();
          sessions.push({
            id: `cursor:${workspaceHash}`,
            source: this.source,
            sourceId: workspaceHash,
            projectPath,
            created,
            modified: created,
            messageCount: prompts.length,
            firstPrompt: prompts[0]?.text?.slice(0, 200) || '',
          });
        }
      } finally {
        db.close();
      }
    } catch {
      // Database not available or not readable
    }

    return sessions;
  }

  private convertPrompts(prompts: CursorPrompt[]): NormalizedMessage[] {
    // Cursor only stores user prompts in aiService.prompts
    // We don't have access to assistant responses in this format
    return prompts.map((prompt, index) => ({
      id: `prompt-${index}`,
      role: 'user' as const,
      content: prompt.text,
      sourceData: { commandType: prompt.commandType },
    }));
  }
}

/**
 * Factory function for creating CursorAdapter
 */
export function createCursorAdapter(): CursorAdapter {
  return new CursorAdapter();
}
