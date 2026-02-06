/**
 * Jeeves session tools: list, show, messages, stats, read_file.
 * Structure mirrors external-interactions. Sessions use Claude-style JSONL
 * (transcript.jsonl) and session-parser (parseSessionFile, summarizeSession, etc.).
 */

import { tool } from 'ai';
import { z } from 'zod';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { listSessions, getSessionDir } from '../session-manager.js';
import {
  parseSessionFile,
  summarizeSession,
  getBeatsForSession,
  extractConversation,
  extractTextContent,
  extractReasoning,
} from '../../../src/sessions/session-parser.js';
import type { SessionMessage, AssistantMessageEntry, UserMessageEntry } from '../../../src/sessions/types.js';

const sessionIdSchema = z
  .string()
  .describe('Session ID (e.g. telegram-123456789 or cli-1234567890-abc123); full ID or short prefix)');

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function firstPromptFromMeta(meta: { metadata?: Record<string, unknown> }): string {
  const fp = meta.metadata?.firstPrompt;
  return typeof fp === 'string' ? fp : '';
}

function messageCountFromMeta(meta: { metadata?: Record<string, unknown> }): number {
  const n = meta.metadata?.messageCount;
  return typeof n === 'number' && n >= 0 ? n : 0;
}

export const sessionsListTool = tool({
  description:
    'List recent Jeeves sessions (CLI runs, Telegram chats). Returns sessionId, shortId, firstPrompt, messageCount, created, modified. Sessions use Claude-style JSONL (transcript.jsonl).',
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .describe('Max number of sessions to return'),
  }),
  execute: async ({ limit }) => {
    try {
      const all = await listSessions();
      const sorted = [...all].sort(
        (a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime()
      );
      const slice = sorted.slice(0, limit);
      return {
        sessions: slice.map((s) => {
          const firstPrompt = firstPromptFromMeta(s);
          const mc = messageCountFromMeta(s);
          return {
            sessionId: s.sessionId,
            shortId: s.sessionId.split('-').slice(0, 2).join('-'),
            firstPrompt:
              firstPrompt.slice(0, 120) + (firstPrompt.length > 120 ? '...' : ''),
            messageCount: mc,
            created: s.created,
            modified: s.lastUsed,
            type: s.type,
          };
        }),
        totalCount: all.length,
      };
    } catch (err) {
      return {
        error: 'SESSIONS_LIST_ERROR',
        message: err instanceof Error ? err.message : String(err),
        sessions: [],
        totalCount: 0,
      };
    }
  },
});

export const sessionsShowTool = tool({
  description:
    'Show summary for a Jeeves session (CLI or Telegram). Session ID can be full or short prefix. Uses Claude-style JSONL.',
  inputSchema: z.object({
    sessionId: sessionIdSchema,
  }),
  execute: async ({ sessionId }) => {
    try {
      const all = await listSessions();
      const entry = all.find(
        (s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId)
      );
      if (!entry)
        return {
          error: 'SESSION_NOT_FOUND',
          message: `Session "${sessionId}" not found.`,
        };

      const sessionDir = await getSessionDir(entry.sessionId);
      if (!sessionDir)
        return { error: 'SESSION_NOT_FOUND', message: `Session "${sessionId}" not found.` };

      const transcriptPath = join(sessionDir, 'transcript.jsonl');
      let summary: ReturnType<typeof summarizeSession>;
      let beatCount: number;
      try {
        const messages = await parseSessionFile(transcriptPath);
        summary = summarizeSession(messages);
        const { beats } = await getBeatsForSession(messages);
        beatCount = beats.length;
      } catch {
        const firstPrompt = firstPromptFromMeta(entry);
        const messageCount = messageCountFromMeta(entry);
        return {
          sessionId: entry.sessionId,
          firstPrompt,
          messageCount,
          created: entry.created,
          modified: entry.lastUsed,
          type: entry.type,
          userMessages: 0,
          assistantMessages: 0,
          toolCalls: 0,
        };
      }

      const u = summary.tokenUsage;
      const totalTokens =
        u.input_tokens +
        u.output_tokens +
        (u.cache_creation_input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0);

      return {
        sessionId: entry.sessionId,
        firstPrompt: summary.firstMessage ?? firstPromptFromMeta(entry),
        messageCount: summary.userMessages + summary.assistantMessages,
        created: entry.created,
        modified: entry.lastUsed,
        type: entry.type,
        userMessages: summary.userMessages,
        assistantMessages: summary.assistantMessages,
        toolCalls: summary.toolCalls,
        totalTokens,
        estimatedCost: summary.estimatedCost.toFixed(4),
        duration:
          summary.duration != null ? formatDuration(summary.duration) : undefined,
        beatCount,
        reasoningCount: summary.reasoningCount,
        totalReasoningChars: summary.totalReasoningChars,
        sizeBreakdown: summary.sizeBreakdown,
      };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

export const sessionsMessagesTool = tool({
  description:
    'Get conversation messages for a Jeeves session (user and assistant text). Uses Claude-style JSONL.',
  inputSchema: z.object({
    sessionId: sessionIdSchema,
    limit: z
      .number()
      .min(1)
      .max(200)
      .optional()
      .describe('Max messages to return (default all)'),
  }),
  execute: async ({ sessionId, limit }) => {
    try {
      const all = await listSessions();
      const entry = all.find(
        (s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId)
      );
      if (!entry)
        return {
          error: 'SESSION_NOT_FOUND',
          message: `Session "${sessionId}" not found.`,
        };

      const sessionDir = await getSessionDir(entry.sessionId);
      if (!sessionDir)
        return { error: 'SESSION_NOT_FOUND', message: `Session "${sessionId}" not found.` };

      const transcriptPath = join(sessionDir, 'transcript.jsonl');
      let messages: Awaited<ReturnType<typeof parseSessionFile>>;
      try {
        messages = await parseSessionFile(transcriptPath);
      } catch {
        return { sessionId: entry.sessionId, messages: [] };
      }
      const { user, assistant } = extractConversation(messages);
      const out: { role: string; content: string }[] = [];
      let ui = 0;
      let ai = 0;
      const max = limit ?? 1e9;
      while ((ui < user.length || ai < assistant.length) && out.length < max) {
        const u = user[ui];
        const a = assistant[ai];
        const uTime = u ? new Date(u.timestamp ?? 0).getTime() : Infinity;
        const aTime = a ? new Date(a.timestamp ?? 0).getTime() : Infinity;
        if (uTime <= aTime && ui < user.length) {
          const content = u!.message.content;
          const texts = extractTextContent(
            typeof content === 'string' ? content : content
          );
          out.push({ role: 'user', content: texts.join('\n') || '(no text)' });
          ui++;
        } else if (ai < assistant.length) {
          const content = a!.message.content;
          const texts = extractTextContent(
            typeof content === 'string' ? content : content
          );
          out.push({ role: 'assistant', content: texts.join('\n') || '(no text)' });
          ai++;
        }
      }
      return { sessionId: entry.sessionId, messages: out };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

export const sessionsStatsTool = tool({
  description:
    'Get token usage, cost, and message-count stats for a Jeeves session. Uses Claude-style JSONL (tokens/cost are 0 if not recorded).',
  inputSchema: z.object({
    sessionId: sessionIdSchema,
  }),
  execute: async ({ sessionId }) => {
    try {
      const all = await listSessions();
      const entry = all.find(
        (s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId)
      );
      if (!entry)
        return {
          error: 'SESSION_NOT_FOUND',
          message: `Session "${sessionId}" not found.`,
        };

      const sessionDir = await getSessionDir(entry.sessionId);
      if (!sessionDir)
        return { error: 'SESSION_NOT_FOUND', message: `Session "${sessionId}" not found.` };

      const transcriptPath = join(sessionDir, 'transcript.jsonl');
      let messages: Awaited<ReturnType<typeof parseSessionFile>>;
      try {
        messages = await parseSessionFile(transcriptPath);
      } catch {
        return {
          sessionId: entry.sessionId,
          tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 },
          estimatedCost: '0.0000',
          messages: { total: 0, user: 0, assistant: 0, toolCalls: 0 },
          durationMs: undefined,
          duration: undefined,
        };
      }
      const summary = summarizeSession(messages);
      const u = summary.tokenUsage;
      return {
        sessionId: entry.sessionId,
        tokens: {
          input: u.input_tokens,
          output: u.output_tokens,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          total:
            u.input_tokens +
            u.output_tokens +
            (u.cache_creation_input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0),
        },
        estimatedCost: summary.estimatedCost.toFixed(4),
        messages: {
          total: summary.userMessages + summary.assistantMessages,
          user: summary.userMessages,
          assistant: summary.assistantMessages,
          toolCalls: summary.toolCalls,
        },
        durationMs: summary.duration,
        duration:
          summary.duration != null ? formatDuration(summary.duration) : undefined,
      };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

const sessionInspectSchema = z.object({
  sessionId: sessionIdSchema,
  messageIndexOrUuid: z
    .string()
    .describe('Message index (0-based) or UUID to inspect. Returns full content and tool response if applicable.'),
});

function getMessageByIndexOrUuid(
  messages: SessionMessage[],
  indexOrUuid: string
): SessionMessage | null {
  const idx = parseInt(indexOrUuid, 10);
  if (!Number.isNaN(idx) && idx >= 0 && idx < messages.length) return messages[idx];
  return messages.find((m) => (m as { uuid?: string }).uuid === indexOrUuid) ?? null;
}

export const sessionsInspectTool = tool({
  description:
    'Inspect one message in a Jeeves session by index or UUID. Returns full content (text, reasoning if any). If the message is an assistant tool call, includes the corresponding tool result(s).',
  inputSchema: sessionInspectSchema,
  execute: async ({ sessionId, messageIndexOrUuid }) => {
    try {
      const all = await listSessions();
      const entry = all.find(
        (s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId)
      );
      if (!entry)
        return { error: 'SESSION_NOT_FOUND', message: `Session "${sessionId}" not found.` };

      const sessionDir = await getSessionDir(entry.sessionId);
      if (!sessionDir)
        return { error: 'SESSION_NOT_FOUND', message: `Session "${sessionId}" not found.` };

      const transcriptPath = join(sessionDir, 'transcript.jsonl');
      const messages = await parseSessionFile(transcriptPath);
      const msg = getMessageByIndexOrUuid(messages, messageIndexOrUuid);
      if (!msg)
        return {
          error: 'MESSAGE_NOT_FOUND',
          sessionId: entry.sessionId,
          messageIndexOrUuid,
        };

      const uuid = (msg as { uuid?: string }).uuid ?? '';
      const result: Record<string, unknown> = {
        sessionId: entry.sessionId,
        messageIndexOrUuid,
        uuid,
        type: msg.type,
      };

      if (msg.type === 'user') {
        const content = (msg as UserMessageEntry).message.content;
        const texts = extractTextContent(content);
        result.content = texts.join('\n');
        if (typeof content !== 'string' && Array.isArray(content)) {
          const toolResults = content.filter((b) => b.type === 'tool_result');
          if (toolResults.length > 0)
            result.toolResults = toolResults.map((tr) => ({
              tool_use_id: tr.tool_use_id,
              content:
                typeof tr.content === 'string'
                  ? tr.content.slice(0, 2000)
                  : JSON.stringify(tr.content).slice(0, 2000),
              is_error: tr.is_error,
            }));
        }
      } else if (msg.type === 'assistant') {
        const am = msg as AssistantMessageEntry;
        const reasoning = extractReasoning(am);
        if (reasoning) result.reasoning = reasoning.slice(0, 5000);
        const content = am.message.content;
        const texts = extractTextContent(content);
        result.content = texts.join('\n');
        if (typeof content !== 'string' && Array.isArray(content)) {
          const toolCalls = content.filter((b) => b.type === 'tool_use');
          if (toolCalls.length > 0)
            result.toolCalls = toolCalls.map((tc) => ({
              id: tc.id,
              name: tc.name,
              input: tc.input,
            }));
        }
      }
      return result;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
});

const sessionReadSchema = z.object({
  sessionId: sessionIdSchema,
  path: z
    .string()
    .describe(
      'Path to file within the session directory (e.g. transcript.jsonl, media/…)'
    ),
  offset: z.number().int().min(0).optional().describe('Line offset (0-based)'),
  limit: z.number().int().min(1).optional().describe('Max lines to return'),
});

export const sessionsReadFileTool = tool({
  description:
    'Read a file from a session directory (e.g. transcript.jsonl, media files). Sessions use Claude-style JSONL.',
  inputSchema: sessionReadSchema,
  execute: async ({ sessionId, path: filePath, offset, limit }) => {
    try {
      const all = await listSessions();
      const entry = all.find(
        (s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId)
      );
      if (!entry)
        return {
          error: 'SESSION_NOT_FOUND',
          message: `Session "${sessionId}" not found.`,
        };

      const sessionDir = await getSessionDir(entry.sessionId);
      if (!sessionDir)
        return { error: 'SESSION_NOT_FOUND', message: `Session "${sessionId}" not found.` };

      const fullPath = join(sessionDir, filePath);
      const content = await readFile(fullPath, 'utf-8');

      if (offset !== undefined || limit !== undefined) {
        const lines = content.split('\n');
        const totalLines = lines.length;
        const start = offset ?? 0;
        const end = limit != null ? start + limit : totalLines;
        const sliced = lines.slice(start, end).join('\n');
        return {
          sessionId: entry.sessionId,
          path: filePath,
          content: sliced,
          totalLines,
          startLine: start,
          endLine: Math.min(end, totalLines),
          hasMore: end < totalLines,
        };
      }

      return { sessionId: entry.sessionId, path: filePath, content };
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ENOENT'
      )
        return {
          error: 'FILE_NOT_FOUND',
          sessionId,
          path: filePath,
        };
      return {
        error: err instanceof Error ? err.message : String(err),
        sessionId,
        path: filePath,
      };
    }
  },
});
