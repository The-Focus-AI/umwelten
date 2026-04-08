/**
 * Habitat session tools: list, show, messages, stats, inspect, read_file.
 * Tools close over a habitat context for session management.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Tool } from 'ai';
import type { HabitatSessionMetadata } from '../types.js';
import type { SessionMessage, AssistantMessageEntry, UserMessageEntry } from '../../interaction/types/types.js';

// These imports come from the main library's session parser
import {
  summarizeSession,
  getBeatsForSession,
  extractTextContent,
  extractReasoning,
  sessionMessagesToNormalized,
} from '../../interaction/persistence/session-parser.js';
import { loadHabitatSessionTranscriptMessages } from '../../session-record/habitat-transcript-load.js';
import { FileLearningsStore } from '../../session-record/learnings-store.js';
import { compactHabitatTranscriptSegment } from '../../session-record/compaction-habitat.js';
import type { LearningKind, LearningProvenance } from '../../session-record/types.js';
import { LEARNING_KINDS } from '../../session-record/types.js';

/** Interface for the habitat context that session tools need. */
export interface SessionToolsContext {
  listSessions(): Promise<HabitatSessionMetadata[]>;
  getSessionDir(sessionId: string): Promise<string | null>;
}

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

const sessionIdSchema = z
  .string()
  .describe('Session ID (full ID or short prefix)');

const learningKindSchema = z.enum([
  'facts',
  'playbooks',
  'preferences',
  'open_loops',
  'mistakes',
] as const satisfies readonly LearningKind[]);

async function resolveSessionDir(
  ctx: SessionToolsContext,
  sessionId: string,
): Promise<{ entry: HabitatSessionMetadata; sessionDir: string } | { error: string; message: string }> {
  const all = await ctx.listSessions();
  const entry = all.find(
    (s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId),
  );
  if (!entry) {
    return { error: 'SESSION_NOT_FOUND', message: `Session "${sessionId}" not found.` };
  }
  const sessionDir = await ctx.getSessionDir(entry.sessionId);
  if (!sessionDir) {
    return { error: 'SESSION_NOT_FOUND', message: `Session "${sessionId}" not found.` };
  }
  return { entry, sessionDir };
}

function parseLearningCounts(raw?: Record<string, number>):
  | import('../../session-record/types.js').CompactionEventV1['learningCounts']
  | undefined {
  if (!raw) return undefined;
  const out: Partial<Record<LearningKind, number>> = {};
  for (const k of LEARNING_KINDS) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function createSessionTools(ctx: SessionToolsContext): Record<string, Tool> {
  const sessionsListTool = tool({
    description: 'List recent sessions. Returns sessionId, firstPrompt, messageCount, created, modified.',
    inputSchema: z.object({
      limit: z.number().min(1).max(100).optional().default(20).describe('Max sessions to return'),
    }),
    execute: async ({ limit }) => {
      try {
        const all = await ctx.listSessions();
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
              firstPrompt: firstPrompt.slice(0, 120) + (firstPrompt.length > 120 ? '...' : ''),
              messageCount: mc,
              created: s.created,
              modified: s.lastUsed,
              type: s.type,
            };
          }),
          totalCount: all.length,
        };
      } catch (err) {
        return { error: 'SESSIONS_LIST_ERROR', message: err instanceof Error ? err.message : String(err), sessions: [], totalCount: 0 };
      }
    },
  });

  const sessionsShowTool = tool({
    description: 'Show summary for a session. Session ID can be full or short prefix.',
    inputSchema: z.object({ sessionId: sessionIdSchema }),
    execute: async ({ sessionId }) => {
      try {
        const resolved = await resolveSessionDir(ctx, sessionId);
        if ('error' in resolved) return resolved;
        const { entry, sessionDir } = resolved;

        let summary: ReturnType<typeof summarizeSession>;
        let beatCount: number;
        try {
          const messages = await loadHabitatSessionTranscriptMessages(sessionDir);
          summary = summarizeSession(messages);
          const { beats } = await getBeatsForSession(messages);
          beatCount = beats.length;
        } catch {
          return {
            sessionId: entry.sessionId,
            firstPrompt: firstPromptFromMeta(entry),
            messageCount: messageCountFromMeta(entry),
            created: entry.created,
            modified: entry.lastUsed,
            type: entry.type,
            userMessages: 0, assistantMessages: 0, toolCalls: 0,
          };
        }

        const u = summary.tokenUsage;
        const totalTokens = u.input_tokens + u.output_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);

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
          duration: summary.duration != null ? formatDuration(summary.duration) : undefined,
          beatCount,
          reasoningCount: summary.reasoningCount,
          totalReasoningChars: summary.totalReasoningChars,
          sizeBreakdown: summary.sizeBreakdown,
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  const sessionsMessagesTool = tool({
    description: 'Get conversation messages for a session (user and assistant text).',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      limit: z.number().min(1).max(200).optional().describe('Max messages to return'),
    }),
    execute: async ({ sessionId, limit }) => {
      try {
        const resolved = await resolveSessionDir(ctx, sessionId);
        if ('error' in resolved) return resolved;
        const { entry, sessionDir } = resolved;

        let messages: SessionMessage[];
        try {
          messages = await loadHabitatSessionTranscriptMessages(sessionDir);
        } catch {
          return { sessionId: entry.sessionId, messages: [] };
        }
        const normalized = sessionMessagesToNormalized(messages);
        const max = limit ?? 1e9;
        const out: { role: string; content: string; tool?: string }[] = [];
        for (const msg of normalized) {
          if (out.length >= max) break;
          if (msg.role === 'tool' && msg.tool) {
            const inputSummary = msg.tool.input
              ? Object.entries(msg.tool.input).slice(0, 3).map(([k, v]) => {
                  const vs = typeof v === 'string' ? v : JSON.stringify(v);
                  return `${k}: ${vs.length > 60 ? vs.slice(0, 60) + '...' : vs}`;
                }).join(', ')
              : '';
            out.push({
              role: 'tool',
              content: `[${msg.tool.name}] ${inputSummary}`.trim(),
              tool: msg.tool.name,
            });
          } else {
            out.push({ role: msg.role, content: msg.content || '(no text)' });
          }
        }
        return { sessionId: entry.sessionId, messages: out };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  const sessionsStatsTool = tool({
    description: 'Get token usage, cost, and message-count stats for a session.',
    inputSchema: z.object({ sessionId: sessionIdSchema }),
    execute: async ({ sessionId }) => {
      try {
        const resolved = await resolveSessionDir(ctx, sessionId);
        if ('error' in resolved) return resolved;
        const { entry, sessionDir } = resolved;

        let messages: SessionMessage[];
        try {
          messages = await loadHabitatSessionTranscriptMessages(sessionDir);
        } catch {
          return {
            sessionId: entry.sessionId,
            tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 },
            estimatedCost: '0.0000',
            messages: { total: 0, user: 0, assistant: 0, toolCalls: 0 },
          };
        }
        const summary = summarizeSession(messages);
        const u = summary.tokenUsage;
        return {
          sessionId: entry.sessionId,
          tokens: {
            input: u.input_tokens, output: u.output_tokens,
            cacheWrite: u.cache_creation_input_tokens ?? 0,
            cacheRead: u.cache_read_input_tokens ?? 0,
            total: u.input_tokens + u.output_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
          },
          estimatedCost: summary.estimatedCost.toFixed(4),
          messages: {
            total: summary.userMessages + summary.assistantMessages,
            user: summary.userMessages,
            assistant: summary.assistantMessages,
            toolCalls: summary.toolCalls,
          },
          durationMs: summary.duration,
          duration: summary.duration != null ? formatDuration(summary.duration) : undefined,
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  function getMessageByIndexOrUuid(messages: SessionMessage[], indexOrUuid: string): SessionMessage | null {
    const idx = parseInt(indexOrUuid, 10);
    if (!Number.isNaN(idx) && idx >= 0 && idx < messages.length) return messages[idx];
    return messages.find((m) => (m as { uuid?: string }).uuid === indexOrUuid) ?? null;
  }

  const sessionsInspectTool = tool({
    description: 'Inspect one message in a session by index or UUID. Returns full content, reasoning, and tool calls/results.',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      messageIndexOrUuid: z.string().describe('Message index (0-based) or UUID'),
    }),
    execute: async ({ sessionId, messageIndexOrUuid }) => {
      try {
        const resolved = await resolveSessionDir(ctx, sessionId);
        if ('error' in resolved) return resolved;
        const { entry, sessionDir } = resolved;

        const messages = await loadHabitatSessionTranscriptMessages(sessionDir);
        const msg = getMessageByIndexOrUuid(messages, messageIndexOrUuid);
        if (!msg) return { error: 'MESSAGE_NOT_FOUND', sessionId: entry.sessionId, messageIndexOrUuid };

        const uuid = (msg as { uuid?: string }).uuid ?? '';
        const result: Record<string, unknown> = { sessionId: entry.sessionId, messageIndexOrUuid, uuid, type: msg.type };

        if (msg.type === 'user') {
          const content = (msg as UserMessageEntry).message.content;
          const texts = extractTextContent(content);
          result.content = texts.join('\n');
          if (typeof content !== 'string' && Array.isArray(content)) {
            const toolResults = content.filter((b) => b.type === 'tool_result');
            if (toolResults.length > 0)
              result.toolResults = toolResults.map((tr) => ({
                tool_use_id: tr.tool_use_id,
                content: typeof tr.content === 'string' ? tr.content.slice(0, 2000) : JSON.stringify(tr.content).slice(0, 2000),
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
              result.toolCalls = toolCalls.map((tc) => ({ id: tc.id, name: tc.name, input: tc.input }));
          }
        }
        return result;
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  const sessionsReadFileTool = tool({
    description: 'Read a file from a session directory (e.g. transcript.jsonl, media files).',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      path: z.string().describe('Path within the session directory'),
      offset: z.number().int().min(0).optional().describe('Line offset (0-based)'),
      limit: z.number().int().min(1).optional().describe('Max lines to return'),
    }),
    execute: async ({ sessionId, path: filePath, offset, limit }) => {
      try {
        const resolved = await resolveSessionDir(ctx, sessionId);
        if ('error' in resolved) return resolved;
        const { entry, sessionDir } = resolved;

        const fullPath = join(sessionDir, filePath);
        const content = await readFile(fullPath, 'utf-8');

        if (offset !== undefined || limit !== undefined) {
          const lines = content.split('\n');
          const totalLines = lines.length;
          const start = offset ?? 0;
          const end = limit != null ? start + limit : totalLines;
          const sliced = lines.slice(start, end).join('\n');
          return { sessionId: entry.sessionId, path: filePath, content: sliced, totalLines, startLine: start, endLine: Math.min(end, totalLines), hasMore: end < totalLines };
        }

        return { sessionId: entry.sessionId, path: filePath, content };
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')
          return { error: 'FILE_NOT_FOUND', sessionId, path: filePath };
        return { error: err instanceof Error ? err.message : String(err), sessionId, path: filePath };
      }
    },
  });

  const sessionsLearningsAppendTool = tool({
    description:
      'Append one structured learning row to the session directory (per-kind JSONL: facts, playbooks, preferences, open_loops, mistakes).',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      kind: learningKindSchema,
      payload: z
        .record(z.string(), z.unknown())
        .describe('JSON object stored as the learning payload'),
      provenance: z.record(z.string(), z.unknown()).optional(),
    }),
    execute: async ({ sessionId, kind, payload, provenance }) => {
      try {
        const resolved = await resolveSessionDir(ctx, sessionId);
        if ('error' in resolved) return resolved;
        const store = new FileLearningsStore(resolved.sessionDir);
        const rec = await store.append(kind, {
          payload,
          provenance: provenance as LearningProvenance | undefined,
        });
        return { ok: true as const, id: rec.id, kind: rec.kind, createdAt: rec.createdAt };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  const sessionsLearningsReadTool = tool({
    description:
      'Read learnings JSONL for a session. Omit kind to return all kinds with row counts and optional cap per kind.',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      kind: learningKindSchema.optional(),
      limitPerKind: z.number().int().min(1).max(500).optional(),
    }),
    execute: async ({ sessionId, kind, limitPerKind }) => {
      try {
        const resolved = await resolveSessionDir(ctx, sessionId);
        if ('error' in resolved) return resolved;
        const store = new FileLearningsStore(resolved.sessionDir);
        if (kind) {
          const rows = await store.read(kind);
          const cap = limitPerKind ?? rows.length;
          return { sessionId: resolved.entry.sessionId, kind, rows: rows.slice(-cap) };
        }
        const all = await store.readAll();
        const out: Record<string, { count: number; rows: unknown[] }> = {};
        const cap = limitPerKind ?? 1e9;
        for (const k of LEARNING_KINDS) {
          const rows = all[k];
          out[k] = { count: rows.length, rows: rows.slice(-Math.min(cap, rows.length)) };
        }
        return { sessionId: resolved.entry.sessionId, kinds: out };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  const sessionsTranscriptCompactTool = tool({
    description:
      'Freeze the current live transcript.jsonl to transcript.{iso}.jsonl and start a new live file whose first line is a compaction marker with the given summary. Run AFTER capturing learnings/summary you want preserved; this tool only performs file operations.',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      summary: z.string().min(1).describe('Human-readable summary of the frozen segment'),
      runId: z.string().optional(),
      learningCounts: z
        .record(z.string(), z.number().int().min(0))
        .optional()
        .describe('Optional counts per learning kind for the compaction record'),
    }),
    execute: async ({ sessionId, summary, runId, learningCounts }) => {
      try {
        const resolved = await resolveSessionDir(ctx, sessionId);
        if ('error' in resolved) return resolved;
        const result = await compactHabitatTranscriptSegment({
          sessionDir: resolved.sessionDir,
          summary,
          runId,
          learningCounts: parseLearningCounts(learningCounts),
        });
        return {
          ok: true as const,
          sessionId: resolved.entry.sessionId,
          frozenRelative: result.frozenRelative,
          livePath: result.livePath,
        };
      } catch (err) {
        return {
          error: 'COMPACTION_FAILED',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  return {
    sessions_list: sessionsListTool,
    sessions_show: sessionsShowTool,
    sessions_messages: sessionsMessagesTool,
    sessions_stats: sessionsStatsTool,
    sessions_inspect: sessionsInspectTool,
    sessions_read_file: sessionsReadFileTool,
    sessions_learnings_append: sessionsLearningsAppendTool,
    sessions_learnings_read: sessionsLearningsReadTool,
    sessions_transcript_compact: sessionsTranscriptCompactTool,
  };
}

/**
 * Create a `current_session` tool that lets the agent introspect its own session.
 * Call this after session creation and add the tool to the habitat/stimulus.
 */
export function createCurrentSessionTool(info: {
  sessionId: string;
  sessionDir: string;
  startedAt: Date;
  getMessageCount: () => number;
}): Tool {
  return tool({
    description:
      'Get information about your current session: session ID, directory, uptime, and message count. ' +
      'Use the returned sessionId with sessions_show, sessions_messages, sessions_inspect, etc. to reflect on your own conversation.',
    inputSchema: z.object({}),
    execute: async () => {
      const now = new Date();
      const uptimeMs = now.getTime() - info.startedAt.getTime();
      return {
        sessionId: info.sessionId,
        sessionDir: info.sessionDir,
        startedAt: info.startedAt.toISOString(),
        uptime: formatDuration(uptimeMs),
        uptimeMs,
        messageCount: info.getMessageCount(),
      };
    },
  });
}
