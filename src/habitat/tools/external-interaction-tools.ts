/**
 * Habitat external-interaction tools: list, show, messages, stats for an agent's
 * external interactions (Claude Code, Cursor conversation history).
 * Tools close over a habitat context for config access.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { Tool } from 'ai';
import type { HabitatConfig, AgentEntry } from '../types.js';
import {
  getProjectSessions,
  hasSessionsIndex,
} from '../../interaction/persistence/session-store.js';
import {
  parseSessionFile,
  summarizeSession,
  extractConversation,
  extractTextContent,
} from '../../interaction/persistence/session-parser.js';

/** Interface for the habitat context that external interaction tools need. */
export interface ExternalInteractionToolsContext {
  getConfig(): HabitatConfig;
  getAgent(idOrName: string): AgentEntry | undefined;
}

const agentIdSchema = z.string().describe('Agent id or name');
const externalInteractionIdSchema = z.string().describe('External interaction ID (full UUID or short prefix)');

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function createExternalInteractionTools(ctx: ExternalInteractionToolsContext): Record<string, Tool> {
  const listTool = tool({
    description: 'List recent external interactions (Claude Code, Cursor) for an agent.',
    inputSchema: z.object({
      agentId: agentIdSchema,
      limit: z.number().min(1).max(100).optional().default(10).describe('Max interactions to return'),
    }),
    execute: async ({ agentId, limit }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent) return { error: 'AGENT_NOT_FOUND', message: `No agent "${agentId}".` };
      if (!(await hasSessionsIndex(agent.projectPath))) {
        return { error: 'NO_EXTERNAL_INTERACTIONS', message: `No external interactions found for project: ${agent.projectPath}` };
      }
      const entries = await getProjectSessions(agent.projectPath);
      const sorted = [...entries].sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
      const slice = sorted.slice(0, limit);
      return {
        agentId: agent.id,
        projectPath: agent.projectPath,
        externalInteractions: slice.map((e) => ({
          externalInteractionId: e.sessionId,
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

  const showTool = tool({
    description: 'Show summary for an external interaction. ID can be full UUID or short prefix.',
    inputSchema: z.object({ agentId: agentIdSchema, externalInteractionId: externalInteractionIdSchema }),
    execute: async ({ agentId, externalInteractionId }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent) return { error: 'AGENT_NOT_FOUND', message: `No agent "${agentId}".` };
      if (!(await hasSessionsIndex(agent.projectPath))) {
        return { error: 'NO_EXTERNAL_INTERACTIONS', message: `No external interactions for project: ${agent.projectPath}` };
      }
      const entries = await getProjectSessions(agent.projectPath);
      const entry = entries.find(e => e.sessionId === externalInteractionId || e.sessionId.startsWith(externalInteractionId));
      if (!entry) return { error: 'EXTERNAL_INTERACTION_NOT_FOUND', message: `External interaction "${externalInteractionId}" not found.` };
      const messages = await parseSessionFile(entry.fullPath!);
      const summary = summarizeSession(messages);
      return {
        externalInteractionId: entry.sessionId,
        firstPrompt: entry.firstPrompt,
        messageCount: entry.messageCount,
        created: entry.created,
        modified: entry.modified,
        userMessages: summary.userMessages,
        assistantMessages: summary.assistantMessages,
        toolCalls: summary.toolCalls,
        totalTokens: summary.tokenUsage.input_tokens + summary.tokenUsage.output_tokens + (summary.tokenUsage.cache_creation_input_tokens || 0) + (summary.tokenUsage.cache_read_input_tokens || 0),
        estimatedCost: summary.estimatedCost.toFixed(4),
        duration: summary.duration != null ? formatDuration(summary.duration) : undefined,
      };
    },
  });

  const messagesTool = tool({
    description: 'Get conversation messages for an external interaction (user and assistant text).',
    inputSchema: z.object({
      agentId: agentIdSchema,
      externalInteractionId: externalInteractionIdSchema,
      limit: z.number().min(1).max(200).optional().describe('Max messages to return'),
    }),
    execute: async ({ agentId, externalInteractionId, limit }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent) return { error: 'AGENT_NOT_FOUND', message: `No agent "${agentId}".` };
      const entries = await getProjectSessions(agent.projectPath);
      const entry = entries.find(e => e.sessionId === externalInteractionId || e.sessionId.startsWith(externalInteractionId));
      if (!entry) return { error: 'EXTERNAL_INTERACTION_NOT_FOUND', message: `External interaction "${externalInteractionId}" not found.` };
      const messages = await parseSessionFile(entry.fullPath!);
      const { user, assistant } = extractConversation(messages);
      const out: { role: string; content: string }[] = [];
      let ui = 0, ai = 0;
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
      return { externalInteractionId: entry.sessionId, messages: out };
    },
  });

  const statsTool = tool({
    description: 'Get token usage, cost, and duration stats for an external interaction.',
    inputSchema: z.object({ agentId: agentIdSchema, externalInteractionId: externalInteractionIdSchema }),
    execute: async ({ agentId, externalInteractionId }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent) return { error: 'AGENT_NOT_FOUND', message: `No agent "${agentId}".` };
      const entries = await getProjectSessions(agent.projectPath);
      const entry = entries.find(e => e.sessionId === externalInteractionId || e.sessionId.startsWith(externalInteractionId));
      if (!entry) return { error: 'EXTERNAL_INTERACTION_NOT_FOUND', message: `External interaction "${externalInteractionId}" not found.` };
      const messages = await parseSessionFile(entry.fullPath!);
      const summary = summarizeSession(messages);
      const u = summary.tokenUsage;
      return {
        externalInteractionId: entry.sessionId,
        tokens: {
          input: u.input_tokens, output: u.output_tokens,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          total: u.input_tokens + u.output_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        },
        estimatedCost: summary.estimatedCost.toFixed(4),
        messages: { total: summary.totalMessages, user: summary.userMessages, assistant: summary.assistantMessages, toolCalls: summary.toolCalls },
        durationMs: summary.duration,
        duration: summary.duration != null ? formatDuration(summary.duration) : undefined,
      };
    },
  });

  return {
    external_interactions_list: listTool,
    external_interactions_show: showTool,
    external_interactions_messages: messagesTool,
    external_interactions_stats: statsTool,
  };
}
