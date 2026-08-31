/**
 * Session browsing routes.
 *
 * Consumers: the core Gaia session adapter uses list + messages;
 * umwelten-web-demo uses list; the maintained gaia-ui example uses the
 * summary + beats views.
 */

import { join } from 'node:path';
import type { RouteHandler } from '../types.js';
import { quickTranscriptStats } from '../../tools/session-tools.js';
import type { AgentHost, HabitatSessionMetadata } from '../../types.js';
import {
  parseSessionFile,
  summarizeSession,
  getBeatsForSession,
  sessionMessagesToNormalized,
} from '@umwelten/core/interaction/persistence/session-parser.js';
import { summarizeNormalizedSession } from '@umwelten/core/interaction/adapters/load-interaction.js';
import type {
  AssistantMessageEntry,
  UserMessageEntry,
} from '@umwelten/core/interaction/types/types.js';

// ── Helpers (lifted from gaia-server.ts) ─────────────────────────────

function findSession(
  sessions: HabitatSessionMetadata[],
  idOrPrefix: string,
): HabitatSessionMetadata | undefined {
  return sessions.find(
    (s) => s.sessionId === idOrPrefix || s.sessionId.startsWith(idOrPrefix),
  );
}

async function getTranscriptPath(
  habitat: AgentHost,
  sessionId: string,
): Promise<string | null> {
  const dir = await habitat.getSessionDir(sessionId);
  if (!dir) return null;
  return join(dir, 'transcript.jsonl');
}

function msgContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Array<Record<string, unknown>>)
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text as string)
    .join('\n');
}

function extractToolCallsFromMessage(
  content: unknown,
): Array<{ id: string; name: string; input: unknown }> {
  if (typeof content === 'string' || !Array.isArray(content)) return [];
  return (content as Array<Record<string, unknown>>)
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({
      id: b.id as string,
      name: b.name as string,
      input: b.input,
    }));
}

function extractToolResults(
  content: unknown,
): Array<{ tool_use_id: string; content: string; is_error: boolean }> {
  if (typeof content === 'string' || !Array.isArray(content)) return [];
  return (content as Array<Record<string, unknown>>)
    .filter((b) => b.type === 'tool_result')
    .map((b) => ({
      tool_use_id: b.tool_use_id as string,
      content:
        typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
      is_error: !!b.is_error,
    }));
}


function json(res: any, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
function notFound(res: any, message = 'Not found') {
  json(res, { error: message }, 404);
}

// ── Routes ───────────────────────────────────────────────────────────

/** Consumed by umwelten-web-demo and the core Gaia session adapter. */
export const sessionsListRoute: RouteHandler = {
  method: 'GET',
  path: '/api/sessions',
  async handle(ctx) {
    const sessions = await ctx.habitat.listSessions();
    const sorted = [...sessions].sort(
      (a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime(),
    );

    const result = await Promise.all(
      sorted.map(async (s) => {
        const transcriptPath = await getTranscriptPath(ctx.habitat, s.sessionId);
        let messageCount = 0;
        let firstPrompt = '';
        if (transcriptPath) {
          const stats = await quickTranscriptStats(transcriptPath);
          messageCount = stats.messageCount;
          firstPrompt = stats.firstPrompt;
        }
        if (!firstPrompt && typeof s.metadata?.firstPrompt === 'string') {
          firstPrompt = (s.metadata.firstPrompt as string).slice(0, 200);
        }
        return {
          sessionId: s.sessionId,
          type: s.type,
          created: s.created,
          lastUsed: s.lastUsed,
          firstPrompt,
          messageCount,
          chatId: s.chatId,
        };
      }),
    );

    json(ctx.res, { sessions: result, total: result.length });
  },
};

/** Consumed by the maintained gaia-ui session-detail example. */
export const sessionShowRoute: RouteHandler = {
  method: 'GET',
  path: '/api/sessions/:id',
  async handle(ctx, params) {
    const sessions = await ctx.habitat.listSessions();
    const entry = findSession(sessions, params.id);
    if (!entry) return notFound(ctx.res, `Session "${params.id}" not found`);

    const transcriptPath = await getTranscriptPath(ctx.habitat, entry.sessionId);
    if (!transcriptPath) return notFound(ctx.res, `Session directory not found`);

    try {
      const messages = await parseSessionFile(transcriptPath);
      const summary = summarizeSession(messages);
      const { beats } = await getBeatsForSession(messages);
      const normalized = summarizeNormalizedSession({
        id: entry.sessionId,
        source: 'habitat',
        sourceId: entry.sessionId,
        created: entry.created,
        modified: entry.lastUsed,
        messageCount: summary.totalMessages,
        firstPrompt: summary.firstMessage ?? '',
        messages: sessionMessagesToNormalized(messages),
      });

      json(ctx.res, {
        sessionId: entry.sessionId,
        type: entry.type,
        created: entry.created,
        lastUsed: entry.lastUsed,
        firstPrompt: summary.firstMessage,
        lastMessage: summary.lastMessage,
        userMessages: summary.userMessages,
        assistantMessages: summary.assistantMessages,
        toolCalls: summary.toolCalls,
        totalTokens: normalized.inputTokens + normalized.outputTokens,
        estimatedCost: summary.estimatedCost,
        duration: summary.duration,
        beatCount: beats.length,
      });
    } catch {
      json(ctx.res, {
        sessionId: entry.sessionId,
        type: entry.type,
        created: entry.created,
        lastUsed: entry.lastUsed,
        error: 'Could not parse transcript',
      });
    }
  },
};

/** Consumed by the core Gaia session adapter when loading an Exploration. */
export const sessionMessagesRoute: RouteHandler = {
  method: 'GET',
  path: '/api/sessions/:id/messages',
  async handle(ctx, params) {
    const sessions = await ctx.habitat.listSessions();
    const entry = findSession(sessions, params.id);
    if (!entry) return notFound(ctx.res, `Session "${params.id}" not found`);

    const transcriptPath = await getTranscriptPath(ctx.habitat, entry.sessionId);
    if (!transcriptPath) return notFound(ctx.res, `Session directory not found`);

    try {
      const rawMessages = await parseSessionFile(transcriptPath);
      const messages: Array<{
        index: number;
        role: string;
        content: string;
        timestamp?: string;
        toolCalls?: Array<{ id: string; name: string; input: unknown }>;
        toolResults?: Array<{
          tool_use_id: string;
          content: string;
          is_error: boolean;
        }>;
        model?: string;
      }> = [];

      for (let i = 0; i < rawMessages.length; i++) {
        const msg = rawMessages[i];
        if (msg.type === 'user') {
          const userMsg = msg as UserMessageEntry;
          const text = msgContentToText(userMsg.message.content);
          const toolResults = extractToolResults(userMsg.message.content);

          if (!text.trim() && toolResults.length > 0) {
            if (messages.length > 0) {
              const prev = messages[messages.length - 1];
              if (prev.role === 'assistant' && prev.toolCalls) {
                for (const tr of toolResults) {
                  const tc = prev.toolCalls.find((t) => t.id === tr.tool_use_id);
                  if (tc) {
                    (tc as any).output = tr.content.slice(0, 5000);
                    (tc as any).is_error = tr.is_error;
                  }
                }
              }
            }
            continue;
          }

          messages.push({
            index: i,
            role: 'user',
            content: text,
            timestamp: userMsg.timestamp,
          });
        } else if (msg.type === 'assistant') {
          const assistantMsg = msg as AssistantMessageEntry;
          const text = msgContentToText(assistantMsg.message.content);
          const toolCalls = extractToolCallsFromMessage(
            assistantMsg.message.content,
          );
          messages.push({
            index: i,
            role: 'assistant',
            content: text,
            timestamp: assistantMsg.timestamp,
            model: assistantMsg.message.model,
            ...(toolCalls.length > 0 ? { toolCalls } : {}),
          });
        }
      }

      json(ctx.res, { sessionId: entry.sessionId, messages });
    } catch (err) {
      json(ctx.res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  },
};

/** Consumed by the maintained gaia-ui beat browser example. */
export const sessionBeatsRoute: RouteHandler = {
  method: 'GET',
  path: '/api/sessions/:id/beats',
  async handle(ctx, params) {
    const sessions = await ctx.habitat.listSessions();
    const entry = findSession(sessions, params.id);
    if (!entry) return notFound(ctx.res, `Session "${params.id}" not found`);

    const transcriptPath = await getTranscriptPath(ctx.habitat, entry.sessionId);
    if (!transcriptPath) return notFound(ctx.res, `Session directory not found`);

    try {
      const rawMessages = await parseSessionFile(transcriptPath);
      const { beats } = await getBeatsForSession(rawMessages);
      json(ctx.res, {
        sessionId: entry.sessionId,
        beats: beats.map((b) => ({
          index: b.index,
          userPreview: b.userPreview,
          topic: b.topic,
          toolCount: b.toolCount,
          toolDurationMs: b.toolDurationMs,
          assistantPreview: b.assistantPreview,
          messageCount: b.messages.length,
          messageIds: b.messageIds,
        })),
      });
    } catch (err) {
      json(ctx.res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  },
};
