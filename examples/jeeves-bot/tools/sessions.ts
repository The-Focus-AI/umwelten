/**
 * Jeeves session tools: list, show, messages, stats for an agent's Claude Code sessions.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { loadConfig, getAgentById } from '../config.js';
import {
  getProjectSessions,
  hasSessionsIndex,
} from '../../../src/sessions/session-store.js';
import {
  parseSessionFile,
  summarizeSession,
  extractConversation,
  extractTextContent,
} from '../../../src/sessions/session-parser.js';

const agentIdSchema = z.string().describe('Agent id or name');
const sessionIdSchema = z.string().describe('Session ID (full UUID or short prefix)');

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export const sessionsListTool = tool({
  description: 'List recent Claude Code sessions for an agent (by agent id or name).',
  inputSchema: z.object({
    agentId: agentIdSchema,
    limit: z.number().min(1).max(100).optional().default(10).describe('Max number of sessions to return'),
  }),
  execute: async ({ agentId, limit }) => {
    const config = await loadConfig();
    const agent = getAgentById(config, agentId);
    if (!agent) return { error: 'AGENT_NOT_FOUND', message: `No agent "${agentId}".` };
    if (!(await hasSessionsIndex(agent.projectPath))) {
      return { error: 'NO_SESSIONS', message: `No Claude Code sessions found for project: ${agent.projectPath}` };
    }
    const entries = await getProjectSessions(agent.projectPath);
    const sorted = [...entries].sort(
      (a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime()
    );
    const slice = sorted.slice(0, limit);
    return {
      agentId: agent.id,
      projectPath: agent.projectPath,
      sessions: slice.map(e => ({
        sessionId: e.sessionId,
        shortId: e.sessionId.split('-')[0],
        firstPrompt: e.firstPrompt.slice(0, 120) + (e.firstPrompt.length > 120 ? '...' : ''),
        messageCount: e.messageCount,
        created: e.created,
        modified: e.modified,
      })),
      totalCount: entries.length,
    };
  },
});

export const sessionsShowTool = tool({
  description: 'Show session summary for an agent session (session id can be short prefix).',
  inputSchema: z.object({
    agentId: agentIdSchema,
    sessionId: sessionIdSchema,
  }),
  execute: async ({ agentId, sessionId }) => {
    const config = await loadConfig();
    const agent = getAgentById(config, agentId);
    if (!agent) return { error: 'AGENT_NOT_FOUND', message: `No agent "${agentId}".` };
    if (!(await hasSessionsIndex(agent.projectPath))) {
      return { error: 'NO_SESSIONS', message: `No sessions for project: ${agent.projectPath}` };
    }
    const entries = await getProjectSessions(agent.projectPath);
    const entry = entries.find(
      e => e.sessionId === sessionId || e.sessionId.startsWith(sessionId)
    );
    if (!entry) return { error: 'SESSION_NOT_FOUND', message: `Session "${sessionId}" not found.` };
    const messages = await parseSessionFile(entry.fullPath);
    const summary = summarizeSession(messages);
    return {
      sessionId: entry.sessionId,
      firstPrompt: entry.firstPrompt,
      messageCount: entry.messageCount,
      created: entry.created,
      modified: entry.modified,
      userMessages: summary.userMessages,
      assistantMessages: summary.assistantMessages,
      toolCalls: summary.toolCalls,
      totalTokens:
        summary.tokenUsage.input_tokens +
        summary.tokenUsage.output_tokens +
        (summary.tokenUsage.cache_creation_input_tokens || 0) +
        (summary.tokenUsage.cache_read_input_tokens || 0),
      estimatedCost: summary.estimatedCost.toFixed(4),
      duration: summary.duration != null ? formatDuration(summary.duration) : undefined,
    };
  },
});

export const sessionsMessagesTool = tool({
  description: 'Get conversation messages for an agent session (user and assistant text).',
  inputSchema: z.object({
    agentId: agentIdSchema,
    sessionId: sessionIdSchema,
    limit: z.number().min(1).max(200).optional().describe('Max messages to return (default all)'),
  }),
  execute: async ({ agentId, sessionId, limit }) => {
    const config = await loadConfig();
    const agent = getAgentById(config, agentId);
    if (!agent) return { error: 'AGENT_NOT_FOUND', message: `No agent "${agentId}".` };
    const entries = await getProjectSessions(agent.projectPath);
    const entry = entries.find(
      e => e.sessionId === sessionId || e.sessionId.startsWith(sessionId)
    );
    if (!entry) return { error: 'SESSION_NOT_FOUND', message: `Session "${sessionId}" not found.` };
    const messages = await parseSessionFile(entry.fullPath);
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
        const texts = extractTextContent(typeof content === 'string' ? content : content);
        out.push({ role: 'user', content: texts.join('\n') || '(no text)' });
        ui++;
      } else if (ai < assistant.length) {
        const content = a!.message.content;
        const texts = extractTextContent(typeof content === 'string' ? content : content);
        out.push({ role: 'assistant', content: texts.join('\n') || '(no text)' });
        ai++;
      }
    }
    return { sessionId: entry.sessionId, messages: out };
  },
});

export const sessionsStatsTool = tool({
  description: 'Get token usage, cost, and duration stats for an agent session.',
  inputSchema: z.object({
    agentId: agentIdSchema,
    sessionId: sessionIdSchema,
  }),
  execute: async ({ agentId, sessionId }) => {
    const config = await loadConfig();
    const agent = getAgentById(config, agentId);
    if (!agent) return { error: 'AGENT_NOT_FOUND', message: `No agent "${agentId}".` };
    const entries = await getProjectSessions(agent.projectPath);
    const entry = entries.find(
      e => e.sessionId === sessionId || e.sessionId.startsWith(sessionId)
    );
    if (!entry) return { error: 'SESSION_NOT_FOUND', message: `Session "${sessionId}" not found.` };
    const messages = await parseSessionFile(entry.fullPath);
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
        total: summary.totalMessages,
        user: summary.userMessages,
        assistant: summary.assistantMessages,
        toolCalls: summary.toolCalls,
      },
      durationMs: summary.duration,
      duration: summary.duration != null ? formatDuration(summary.duration) : undefined,
    };
  },
});
