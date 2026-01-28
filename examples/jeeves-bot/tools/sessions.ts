/**
 * Session management tools for Jeeves bot.
 * Allows listing, viewing, and accessing session directories.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { listSessions, getSessionMetadata, getSessionDir } from '../session-manager.js';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const sessionListSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum number of sessions to return (default: 20, max: 100)'),
});

export const sessionsListTool = tool({
  description: 'List all Jeeves bot sessions (Telegram chats, CLI interactions, etc.). Returns session metadata including sessionId, type, created date, and last used date.',
  inputSchema: sessionListSchema,
  execute: async ({ limit = 20 }) => {
    try {
      const sessions = await listSessions();
      return {
        sessions: sessions.slice(0, limit),
        total: sessions.length,
        shown: Math.min(limit, sessions.length),
      };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
        sessions: [],
      };
    }
  },
});

const sessionShowSchema = z.object({
  sessionId: z.string().describe('The session ID to show details for (e.g., "telegram-123456789" or "cli-1234567890-abc123")'),
});

export const sessionsShowTool = tool({
  description: 'Show detailed information about a specific session, including metadata and directory contents.',
  inputSchema: sessionShowSchema,
  execute: async ({ sessionId }) => {
    try {
      const metadata = await getSessionMetadata(sessionId);
      if (!metadata) {
        return {
          error: 'SESSION_NOT_FOUND',
          message: `Session ${sessionId} not found`,
        };
      }

      const sessionDir = await getSessionDir(sessionId);
      let contents: string[] = [];
      if (sessionDir) {
        try {
          const entries = await readdir(sessionDir, { withFileTypes: true });
          contents = entries.map(e => e.isDirectory() ? `${e.name}/` : e.name);
        } catch {
          // Directory might not exist or be readable
        }
      }

      return {
        sessionId: metadata.sessionId,
        type: metadata.type,
        created: metadata.created,
        lastUsed: metadata.lastUsed,
        chatId: metadata.chatId,
        metadata: metadata.metadata,
        directory: sessionDir,
        contents,
      };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

const sessionReadSchema = z.object({
  sessionId: z.string().describe('The session ID'),
  path: z.string().describe('Path to file within the session directory (relative to session root)'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Optional line offset (0-based) to start reading from'),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Optional maximum number of lines to read'),
});

export const sessionsReadFileTool = tool({
  description: 'Read a file from a session directory. Use this to access media files, downloaded content, or other files stored in a session.',
  inputSchema: sessionReadSchema,
  execute: async ({ sessionId, path: filePath, offset, limit }) => {
    try {
      const sessionDir = await getSessionDir(sessionId);
      if (!sessionDir) {
        return {
          error: 'SESSION_NOT_FOUND',
          message: `Session ${sessionId} not found`,
        };
      }

      const fullPath = join(sessionDir, filePath);
      const content = await readFile(fullPath, 'utf-8');

      // If offset or limit is specified, slice the content by lines
      if (offset !== undefined || limit !== undefined) {
        const lines = content.split('\n');
        const totalLines = lines.length;
        const startLine = offset ?? 0;
        const endLine = limit !== undefined ? startLine + limit : totalLines;
        const slicedLines = lines.slice(startLine, endLine);
        const slicedContent = slicedLines.join('\n');

        return {
          sessionId,
          path: filePath,
          content: slicedContent,
          totalLines,
          startLine,
          endLine: Math.min(endLine, totalLines),
          hasMore: endLine < totalLines,
        };
      }

      return {
        sessionId,
        path: filePath,
        content,
      };
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        return {
          error: 'FILE_NOT_FOUND',
          sessionId,
          path: filePath,
        };
      }
      return {
        error: err instanceof Error ? err.message : String(err),
        sessionId,
        path: filePath,
      };
    }
  },
});
