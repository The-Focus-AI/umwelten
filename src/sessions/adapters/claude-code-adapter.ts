/**
 * Claude Code session adapter
 *
 * Reads sessions from Claude Code's JSONL storage format.
 * Location: ~/.claude/projects/{encoded-path}/
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdir, access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

import type { SessionAdapter } from './adapter.js';
import type {
  SessionSource,
  NormalizedSession,
  NormalizedSessionEntry,
  NormalizedMessage,
  NormalizedTokenUsage,
  SessionMetrics,
  SessionDiscoveryOptions,
  SessionDiscoveryResult,
} from '../normalized-types.js';
import type {
  SessionIndexEntry,
  SessionMessage,
  UserMessageEntry,
  AssistantMessageEntry,
  ContentBlock,
  TokenUsage,
} from '../types.js';
import {
  getClaudeProjectPath,
  getSessionsIndexPath,
  hasSessionsIndex,
  getProjectSessionsIncludingFromDirectory,
} from '../session-store.js';
import {
  parseSessionFile,
  parseSessionFileMetadata,
  extractToolCalls,
  calculateTokenUsage,
  calculateCost,
  extractTextContent,
} from '../session-parser.js';

/**
 * Claude Code session adapter implementation
 */
export class ClaudeCodeAdapter implements SessionAdapter {
  readonly source: SessionSource = 'claude-code';
  readonly displayName = 'Claude Code';

  private claudeDir: string;

  constructor() {
    this.claudeDir = join(homedir(), '.claude', 'projects');
  }

  getSourceLocation(): string {
    return this.claudeDir;
  }

  async canHandle(projectPath: string): Promise<boolean> {
    return hasSessionsIndex(projectPath);
  }

  async discoverProjects(): Promise<string[]> {
    try {
      const entries = await readdir(this.claudeDir, { withFileTypes: true });
      const projects: string[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Decode project path: -Users-foo-project -> /Users/foo/project
          const projectPath = entry.name.replace(/^-/, '/').replace(/-/g, '/');

          // Check if the decoded path has a sessions index
          const indexPath = join(this.claudeDir, entry.name, 'sessions-index.json');
          try {
            await access(indexPath, constants.R_OK);
            projects.push(projectPath);
          } catch {
            // No sessions index, skip
          }
        }
      }

      return projects;
    } catch {
      return [];
    }
  }

  async discoverSessions(options?: SessionDiscoveryOptions): Promise<SessionDiscoveryResult> {
    const projectPath = options?.projectPath;
    if (!projectPath) {
      // Need a project path to discover sessions
      return {
        sessions: [],
        source: this.source,
        totalCount: 0,
        hasMore: false,
      };
    }

    if (!(await this.canHandle(projectPath))) {
      return {
        sessions: [],
        source: this.source,
        totalCount: 0,
        hasMore: false,
      };
    }

    let entries = await getProjectSessionsIncludingFromDirectory(projectPath);

    // Enrich firstPrompt for entries that have empty firstPrompt but have a file (e.g. from index)
    await Promise.all(
      entries.map(async (e) => {
        if (
          (e.firstPrompt === '' || e.firstPrompt === '(no prompt)') &&
          e.fullPath
        ) {
          const meta = await parseSessionFileMetadata(e.fullPath, e.fileMtime);
          if (meta?.firstPrompt && meta.firstPrompt !== '(no prompt)') {
            e.firstPrompt = meta.firstPrompt;
          }
        }
      })
    );

    // Apply filters
    if (options?.gitBranch) {
      entries = entries.filter(e => e.gitBranch === options.gitBranch);
    }

    if (options?.since) {
      entries = entries.filter(e => new Date(e.created) >= options.since!);
    }

    if (options?.until) {
      entries = entries.filter(e => new Date(e.created) <= options.until!);
    }

    if (options?.includeSidechains === false) {
      entries = entries.filter(e => !e.isSidechain);
    }

    // Sort
    const sortBy = options?.sortBy || 'modified';
    const sortOrder = options?.sortOrder || 'desc';
    entries.sort((a, b) => {
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

    const totalCount = entries.length;

    // Apply limit
    if (options?.limit && options.limit > 0) {
      entries = entries.slice(0, options.limit);
    }

    // Convert to normalized entries
    const sessions = entries.map(e => this.toNormalizedEntry(e));

    return {
      sessions,
      source: this.source,
      totalCount,
      hasMore: totalCount > sessions.length,
    };
  }

  async getSessionEntry(sessionId: string): Promise<NormalizedSessionEntry | null> {
    // sessionId format: claude-code:{originalId}
    const originalId = sessionId.startsWith('claude-code:')
      ? sessionId.slice('claude-code:'.length)
      : sessionId;

    // We need to find which project this session belongs to
    const projects = await this.discoverProjects();

    for (const projectPath of projects) {
      try {
        const entries = await getProjectSessionsIncludingFromDirectory(projectPath);
        const entry = entries.find(
          e => e.sessionId === originalId || e.sessionId.startsWith(originalId)
        );
        if (entry) {
          return this.toNormalizedEntry(entry);
        }
      } catch {
        // Continue to next project
      }
    }

    return null;
  }

  async getSession(sessionId: string): Promise<NormalizedSession | null> {
    const originalId = sessionId.startsWith('claude-code:')
      ? sessionId.slice('claude-code:'.length)
      : sessionId;

    // Find the session entry first
    const projects = await this.discoverProjects();

    for (const projectPath of projects) {
      try {
        const entries = await getProjectSessionsIncludingFromDirectory(projectPath);
        const entry = entries.find(
          e => e.sessionId === originalId || e.sessionId.startsWith(originalId)
        );

        if (entry?.fullPath) {
          // Parse the full session file
          const messages = await parseSessionFile(entry.fullPath);
          return this.toNormalizedSession(entry, messages);
        }
      } catch {
        // Continue to next project
      }
    }

    return null;
  }

  async getMessages(sessionId: string): Promise<NormalizedMessage[]> {
    const session = await this.getSession(sessionId);
    return session?.messages || [];
  }

  async hasSessionsForProject(projectPath: string): Promise<boolean> {
    return hasSessionsIndex(projectPath);
  }

  // ---- Private conversion methods ----

  private toNormalizedEntry(entry: SessionIndexEntry): NormalizedSessionEntry {
    return {
      id: `claude-code:${entry.sessionId}`,
      source: this.source,
      sourceId: entry.sessionId,
      projectPath: entry.projectPath,
      gitBranch: entry.gitBranch,
      created: entry.created,
      modified: entry.modified,
      messageCount: entry.messageCount,
      firstPrompt: entry.firstPrompt,
      isSidechain: entry.isSidechain,
      sourceData: { fullPath: entry.fullPath, fileMtime: entry.fileMtime },
    };
  }

  private toNormalizedSession(
    entry: SessionIndexEntry,
    rawMessages: SessionMessage[]
  ): NormalizedSession {
    // Convert messages
    const messages = this.convertMessages(rawMessages);

    // Calculate metrics
    const toolCalls = extractToolCalls(rawMessages);
    const tokenUsage = calculateTokenUsage(rawMessages);
    const estimatedCost = calculateCost(tokenUsage);

    const userMessages = messages.filter(m => m.role === 'user').length;
    const assistantMessages = messages.filter(m => m.role === 'assistant').length;

    const metrics: SessionMetrics = {
      userMessages,
      assistantMessages,
      toolCalls: toolCalls.length,
      totalTokens:
        tokenUsage.input_tokens +
        tokenUsage.output_tokens +
        (tokenUsage.cache_read_input_tokens || 0) +
        (tokenUsage.cache_creation_input_tokens || 0),
      inputTokens: tokenUsage.input_tokens,
      outputTokens: tokenUsage.output_tokens,
      cacheReadTokens: tokenUsage.cache_read_input_tokens,
      cacheWriteTokens: tokenUsage.cache_creation_input_tokens,
      estimatedCost,
    };

    // Calculate duration from first to last message
    let duration: number | undefined;
    const timestamps = messages
      .filter(m => m.timestamp)
      .map(m => new Date(m.timestamp!).getTime());
    if (timestamps.length >= 2) {
      duration = Math.max(...timestamps) - Math.min(...timestamps);
    }

    return {
      id: `claude-code:${entry.sessionId}`,
      source: this.source,
      sourceId: entry.sessionId,
      projectPath: entry.projectPath,
      gitBranch: entry.gitBranch,
      created: entry.created,
      modified: entry.modified,
      duration,
      messages,
      messageCount: entry.messageCount,
      firstPrompt: entry.firstPrompt,
      metrics,
      isSidechain: entry.isSidechain,
      sourceData: {
        fullPath: entry.fullPath,
        fileMtime: entry.fileMtime,
      },
    };
  }

  private convertMessages(rawMessages: SessionMessage[]): NormalizedMessage[] {
    const normalized: NormalizedMessage[] = [];

    for (const msg of rawMessages) {
      if (msg.type === 'user') {
        const userMsg = msg as UserMessageEntry;
        const content = this.extractContent(userMsg.message.content);

        // Skip tool result messages (they're handled separately)
        if (this.isToolResultMessage(userMsg.message.content)) {
          continue;
        }

        normalized.push({
          id: userMsg.uuid || `user-${normalized.length}`,
          role: 'user',
          content,
          timestamp: userMsg.timestamp,
          sourceData: { type: 'user', uuid: userMsg.uuid },
        });
      } else if (msg.type === 'assistant') {
        const assistantMsg = msg as AssistantMessageEntry;
        const content = this.extractContent(assistantMsg.message.content);

        // Extract token usage
        const tokens = this.convertTokenUsage(assistantMsg.message.usage);

        // Check for tool calls
        const toolCalls = this.extractToolCallsFromContent(assistantMsg.message.content);

        if (toolCalls.length > 0) {
          // Add text content first (if any)
          if (content.trim()) {
            normalized.push({
              id: assistantMsg.uuid || `assistant-${normalized.length}`,
              role: 'assistant',
              content,
              timestamp: assistantMsg.timestamp,
              tokens,
              model: assistantMsg.message.model,
              sourceData: { type: 'assistant', uuid: assistantMsg.uuid },
            });
          }

          // Add tool calls as separate messages
          for (const toolCall of toolCalls) {
            normalized.push({
              id: toolCall.id,
              role: 'tool',
              content: `Tool: ${toolCall.name}`,
              timestamp: assistantMsg.timestamp,
              tool: {
                name: toolCall.name,
                input: toolCall.input,
              },
              sourceData: { type: 'tool_use', toolUseId: toolCall.id },
            });
          }
        } else {
          normalized.push({
            id: assistantMsg.uuid || `assistant-${normalized.length}`,
            role: 'assistant',
            content,
            timestamp: assistantMsg.timestamp,
            tokens,
            model: assistantMsg.message.model,
            sourceData: { type: 'assistant', uuid: assistantMsg.uuid },
          });
        }
      }
    }

    return normalized;
  }

  private extractContent(content: string | ContentBlock[]): string {
    const texts = extractTextContent(content);
    return texts.join('\n');
  }

  private isToolResultMessage(content: string | ContentBlock[]): boolean {
    if (typeof content === 'string') return false;
    return content.some(block => block.type === 'tool_result');
  }

  private extractToolCallsFromContent(
    content: string | ContentBlock[]
  ): Array<{ id: string; name: string; input: Record<string, unknown> }> {
    if (typeof content === 'string') return [];

    return content
      .filter(block => block.type === 'tool_use')
      .map(block => {
        const toolUse = block as { id: string; name: string; input: Record<string, unknown> };
        return {
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input,
        };
      });
  }

  private convertTokenUsage(usage?: TokenUsage): NormalizedTokenUsage | undefined {
    if (!usage) return undefined;

    return {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cacheRead: usage.cache_read_input_tokens,
      cacheWrite: usage.cache_creation_input_tokens,
      total:
        usage.input_tokens +
        usage.output_tokens +
        (usage.cache_read_input_tokens || 0) +
        (usage.cache_creation_input_tokens || 0),
    };
  }
}

/**
 * Factory function for creating ClaudeCodeAdapter
 */
export function createClaudeCodeAdapter(): ClaudeCodeAdapter {
  return new ClaudeCodeAdapter();
}
