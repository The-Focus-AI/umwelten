/**
 * GET /api/usage — per-user rollup of token and cost usage.
 *
 * v1: compute on-the-fly from disk. Filter the habitat's sessions by the
 * authenticated user's userId, parse each transcript via summarizeSession,
 * aggregate. When we back this with a Neon `threads` table (where totals are
 * maintained on-write), we'll swap the implementation here with a SQL query
 * and keep the response shape the same.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RouteHandler } from '../types.js';
import type { AgentHost } from '../../types.js';
import {
  parseSessionFile,
  summarizeSession,
} from '@umwelten/core/interaction/persistence/session-parser.js';

interface SessionUsage {
  sessionId: string;
  type: string;
  firstPrompt: string;
  lastUsed: string;
  provider?: string;
  model?: string;
  tokens: number;
  cost: number;
  userMessages: number;
  assistantMessages: number;
}

interface UsageResponse {
  userId: string;
  totals: {
    sessions: number;
    tokens: number;
    cost: number;
    userMessages: number;
    assistantMessages: number;
  };
  byProvider: Array<{ provider: string; tokens: number; cost: number; sessions: number }>;
  sessions: SessionUsage[];
  /** ISO range covered by this response, for client-side cache keying. */
  generatedAt: string;
}

async function getTranscriptPath(
  habitat: AgentHost,
  sessionId: string,
): Promise<string | null> {
  const dir = await habitat.getSessionDir(sessionId);
  if (!dir) return null;
  return join(dir, 'transcript.jsonl');
}

export const usageRoute: RouteHandler = {
  method: 'GET',
  path: '/api/usage',
  async handle(ctx) {
    const sessions = await ctx.habitat.listSessions();
    const mine = sessions.filter((s) => s.userId === ctx.user.userId);

    const perSession: SessionUsage[] = [];
    const byProviderMap = new Map<
      string,
      { tokens: number; cost: number; sessions: number }
    >();
    let totalTokens = 0;
    let totalCost = 0;
    let totalUser = 0;
    let totalAssistant = 0;

    for (const s of mine) {
      const path = await getTranscriptPath(ctx.habitat, s.sessionId);
      if (!path) continue;
      try {
        const msgs = await parseSessionFile(path);
        const sum = summarizeSession(msgs);
        const tokens =
          sum.tokenUsage.input_tokens + sum.tokenUsage.output_tokens;
        const cost = sum.estimatedCost ?? 0;
        totalTokens += tokens;
        totalCost += cost;
        totalUser += sum.userMessages;
        totalAssistant += sum.assistantMessages;

        perSession.push({
          sessionId: s.sessionId,
          type: s.type,
          firstPrompt: sum.firstMessage ?? '',
          lastUsed: s.lastUsed,
          provider: s.provider,
          model: s.model,
          tokens,
          cost,
          userMessages: sum.userMessages,
          assistantMessages: sum.assistantMessages,
        });

        if (s.provider) {
          const bucket = byProviderMap.get(s.provider) ?? {
            tokens: 0,
            cost: 0,
            sessions: 0,
          };
          bucket.tokens += tokens;
          bucket.cost += cost;
          bucket.sessions += 1;
          byProviderMap.set(s.provider, bucket);
        }
      } catch {
        // Skip unparseable transcripts — keep the endpoint resilient.
      }
    }

    const response: UsageResponse = {
      userId: ctx.user.userId,
      totals: {
        sessions: perSession.length,
        tokens: totalTokens,
        cost: totalCost,
        userMessages: totalUser,
        assistantMessages: totalAssistant,
      },
      byProvider: [...byProviderMap.entries()]
        .map(([provider, v]) => ({ provider, ...v }))
        .sort((a, b) => b.tokens - a.tokens),
      sessions: perSession.sort(
        (a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime(),
      ),
      generatedAt: new Date().toISOString(),
    };

    ctx.res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    });
    ctx.res.end(JSON.stringify(response));
  },
};
