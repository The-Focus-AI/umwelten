/**
 * Habitat external-interaction tools: list, show, messages, stats for an
 * agent's external interactions (Claude Code, Cursor, pi, etc.).
 *
 * Source-agnostic: discovery goes through projectSessions(), per-session
 * loading goes through loadInteraction(). Cost / token totals come from
 * summarizeNormalizedSession via the canonical costs module.
 *
 * Tools close over a habitat context for config access.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { Tool } from 'ai';
import type { ModelDetails } from '@umwelten/core/cognition/types.js';
import type { HabitatConfig, AgentEntry } from '../types.js';
import { initializeAdapters } from '@umwelten/core/interaction/adapters/index.js';
import { projectSessions } from '@umwelten/core/interaction/projection/index.js';
import type { SourceSession } from '@umwelten/core/interaction/types/domain-types.js';
import {
  loadInteraction,
  summarizeNormalizedSession,
} from '@umwelten/core/interaction/adapters/load-interaction.js';
import type { SessionAdapter } from '@umwelten/core/interaction/adapters/adapter.js';
import { adapterRegistry } from '@umwelten/core/interaction/adapters/adapter.js';

/** Interface for the habitat context that external interaction tools need. */
export interface ExternalInteractionToolsContext {
  getConfig(): HabitatConfig;
  getAgent(idOrName: string): AgentEntry | undefined;
}

const agentIdSchema = z.string().describe('Agent id or name');
const externalInteractionIdSchema = z
  .string()
  .describe('External interaction ID (full or short prefix; any source)');

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Pick a model for cost calculation from the habitat config. Falls back to
 * a zero-cost stub when nothing is configured — summarizeNormalizedSession
 * will then read estimatedCost from session.metrics if the adapter
 * pre-computed it.
 */
function modelFromContext(ctx: ExternalInteractionToolsContext): ModelDetails {
  const cfg = ctx.getConfig();
  return {
    name: cfg.defaultModel ?? 'unknown',
    provider: cfg.defaultProvider ?? 'unknown',
  } as ModelDetails;
}

interface DiscoveredEntry {
  sessionId: string;
  source: SourceSession['source'];
  firstPrompt: string;
  messageCount: number;
  created: string;
  modified: string;
}

/**
 * Discover every Source Session for an agent's project, across all
 * registered adapters. Returns adapter-discovered entries with the
 * minimum surface the tools need.
 */
async function discoverEntries(projectPath: string): Promise<DiscoveredEntry[]> {
  initializeAdapters();
  const projection = await projectSessions(projectPath);
  return projection.sourceSessions.map((s) => ({
    sessionId: s.id,
    source: s.source,
    firstPrompt: s.firstPrompt ?? s.title ?? '',
    messageCount: s.messageCount,
    created: s.created,
    modified: s.modified,
  }));
}

/** Find one entry by full id or short prefix across all sources. */
function findEntry(
  entries: DiscoveredEntry[],
  idOrPrefix: string,
): DiscoveredEntry | undefined {
  return entries.find(
    (e) => e.sessionId === idOrPrefix || e.sessionId.startsWith(idOrPrefix),
  );
}

export function createExternalInteractionTools(
  ctx: ExternalInteractionToolsContext,
): Record<string, Tool> {
  const listTool = tool({
    description:
      'List recent external interactions (Claude Code, Cursor, pi, ...) for an agent.',
    inputSchema: z.object({
      agentId: agentIdSchema,
      limit: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .default(10)
        .describe('Max interactions to return'),
    }),
    execute: async ({ agentId, limit }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent)
        return { error: 'AGENT_NOT_FOUND', message: `No agent "${agentId}".` };

      const entries = await discoverEntries(agent.projectPath);
      if (entries.length === 0) {
        return {
          error: 'NO_EXTERNAL_INTERACTIONS',
          message: `No external interactions found for project: ${agent.projectPath}`,
        };
      }
      const sorted = [...entries].sort(
        (a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime(),
      );
      const slice = sorted.slice(0, limit);
      return {
        agentId: agent.id,
        projectPath: agent.projectPath,
        externalInteractions: slice.map((e) => ({
          externalInteractionId: e.sessionId,
          source: e.source,
          shortId: e.sessionId.split(/[:-]/)[0],
          firstPrompt:
            e.firstPrompt.slice(0, 120) +
            (e.firstPrompt.length > 120 ? '...' : ''),
          messageCount: e.messageCount,
          created: e.created,
          modified: e.modified,
        })),
        totalCount: entries.length,
      };
    },
  });

  const showTool = tool({
    description:
      'Show summary for an external interaction. ID can be full or short prefix.',
    inputSchema: z.object({
      agentId: agentIdSchema,
      externalInteractionId: externalInteractionIdSchema,
    }),
    execute: async ({ agentId, externalInteractionId }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent)
        return { error: 'AGENT_NOT_FOUND', message: `No agent "${agentId}".` };

      const entries = await discoverEntries(agent.projectPath);
      const entry = findEntry(entries, externalInteractionId);
      if (!entry)
        return {
          error: 'EXTERNAL_INTERACTION_NOT_FOUND',
          message: `External interaction "${externalInteractionId}" not found.`,
        };

      const adapter = adapterRegistry.get(entry.source as SessionAdapter['source']);
      const normalized = adapter ? await adapter.getSession(entry.sessionId) : null;
      if (!normalized)
        return {
          error: 'EXTERNAL_INTERACTION_LOAD_FAILED',
          message: `Could not load "${entry.sessionId}" via adapter "${entry.source}".`,
        };

      const summary = summarizeNormalizedSession(normalized, modelFromContext(ctx));
      return {
        externalInteractionId: entry.sessionId,
        source: entry.source,
        firstPrompt: entry.firstPrompt,
        messageCount: summary.messageCount,
        created: entry.created,
        modified: entry.modified,
        userMessages: summary.userMessages,
        assistantMessages: summary.assistantMessages,
        toolCalls: summary.toolCalls,
        totalTokens: summary.totalTokens,
        estimatedCost: summary.estimatedCost.toFixed(4),
        duration: summary.durationMs > 0 ? formatDuration(summary.durationMs) : undefined,
      };
    },
  });

  const messagesTool = tool({
    description:
      'Get conversation messages for an external interaction (user and assistant text, any source).',
    inputSchema: z.object({
      agentId: agentIdSchema,
      externalInteractionId: externalInteractionIdSchema,
      limit: z
        .number()
        .min(1)
        .max(200)
        .optional()
        .describe('Max messages to return'),
    }),
    execute: async ({ agentId, externalInteractionId, limit }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent)
        return { error: 'AGENT_NOT_FOUND', message: `No agent "${agentId}".` };

      const entries = await discoverEntries(agent.projectPath);
      const entry = findEntry(entries, externalInteractionId);
      if (!entry)
        return {
          error: 'EXTERNAL_INTERACTION_NOT_FOUND',
          message: `External interaction "${externalInteractionId}" not found.`,
        };

      const interaction = await loadInteraction(
        entry.sessionId,
        modelFromContext(ctx),
      );
      if (!interaction)
        return {
          error: 'EXTERNAL_INTERACTION_LOAD_FAILED',
          message: `Could not load "${entry.sessionId}".`,
        };

      const out: { role: string; content: string }[] = [];
      const max = limit ?? 1e9;
      // Interaction.messages is CoreMessage[]. We filtered out tool-role
      // messages in interactionFromNormalizedSession, and the runner's
      // role union is "user" | "assistant" | "system" | "tool" — so we
      // only surface user/assistant turns here for the conversation view.
      for (const m of interaction.messages) {
        if (out.length >= max) break;
        if (m.role !== 'user' && m.role !== 'assistant') continue;
        const text =
          typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.content)
              ? m.content
                  .filter((p) => typeof p === 'object' && p !== null && 'text' in p)
                  .map((p) => (p as { text: string }).text)
                  .join('\n')
              : '';
        out.push({ role: m.role, content: text || '(no text)' });
      }
      return { externalInteractionId: entry.sessionId, messages: out };
    },
  });

  const statsTool = tool({
    description: 'Get token usage, cost, and duration stats for an external interaction.',
    inputSchema: z.object({
      agentId: agentIdSchema,
      externalInteractionId: externalInteractionIdSchema,
    }),
    execute: async ({ agentId, externalInteractionId }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent)
        return { error: 'AGENT_NOT_FOUND', message: `No agent "${agentId}".` };

      const entries = await discoverEntries(agent.projectPath);
      const entry = findEntry(entries, externalInteractionId);
      if (!entry)
        return {
          error: 'EXTERNAL_INTERACTION_NOT_FOUND',
          message: `External interaction "${externalInteractionId}" not found.`,
        };

      const adapter = adapterRegistry.get(entry.source as SessionAdapter['source']);
      const normalized = adapter ? await adapter.getSession(entry.sessionId) : null;
      if (!normalized)
        return {
          error: 'EXTERNAL_INTERACTION_LOAD_FAILED',
          message: `Could not load "${entry.sessionId}".`,
        };

      const summary = summarizeNormalizedSession(normalized, modelFromContext(ctx));
      return {
        externalInteractionId: entry.sessionId,
        source: entry.source,
        tokens: {
          input: summary.inputTokens,
          output: summary.outputTokens,
          cacheWrite: summary.cacheWriteTokens,
          cacheRead: summary.cacheReadTokens,
          total: summary.totalTokens,
        },
        estimatedCost: summary.estimatedCost.toFixed(4),
        messages: {
          total: summary.messageCount,
          user: summary.userMessages,
          assistant: summary.assistantMessages,
          toolCalls: summary.toolCalls,
        },
        durationMs: summary.durationMs,
        duration: summary.durationMs > 0 ? formatDuration(summary.durationMs) : undefined,
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
