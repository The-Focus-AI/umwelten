/**
 * Context retrieval routes — fetch an A2A conversation by its contextId.
 *
 * A2A defines no history-retrieval method, so these are extensions alongside
 * the protocol, same posture as the artifacts routes. Resolution is the pure
 * resolver in context-resolver.ts; these handlers only add HTTP concerns.
 * Bearer gating comes from the shared registered-routes dispatch (neither
 * route sets skipAuth).
 */

import { readFile } from 'node:fs/promises';
import type { RouteHandler } from '../types.js';
import { resolveContextSession } from '../../context-resolver.js';
import { loadHabitatSessionTranscriptMessages } from '@umwelten/core/session-record/habitat-transcript-load.js';
import { sessionMessagesToNormalized } from '@umwelten/core/interaction/persistence/session-parser.js';

function json(res: any, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function notFound(res: any, contextId: string) {
  json(res, { error: `Context "${contextId}" not found` }, 404);
}

/** GET /api/contexts/:contextId — session metadata + normalized messages. */
export const contextShowRoute: RouteHandler = {
  method: 'GET',
  path: '/api/contexts/:contextId',
  async handle(ctx, params) {
    const resolved = await resolveContextSession(
      ctx.habitat.getSessionsDir(),
      params.contextId,
    );
    if (!resolved) return notFound(ctx.res, params.contextId);

    const raw = await loadHabitatSessionTranscriptMessages(resolved.sessionDir);
    const messages = sessionMessagesToNormalized(raw);

    json(ctx.res, {
      contextId: resolved.contextId,
      sessionId: resolved.metadata?.sessionId ?? resolved.contextId,
      type: resolved.metadata?.type ?? null,
      created: resolved.metadata?.created ?? null,
      lastUsed: resolved.metadata?.lastUsed ?? null,
      agentId: resolved.metadata?.agentId,
      messageCount: messages.length,
      messages,
      ...(resolved.nativeSessionRef && {
        nativeSessionRef: resolved.nativeSessionRef,
      }),
    });
  },
};

/** GET /api/contexts/:contextId/transcript — raw transcript JSONL. */
export const contextTranscriptRoute: RouteHandler = {
  method: 'GET',
  path: '/api/contexts/:contextId/transcript',
  async handle(ctx, params) {
    const resolved = await resolveContextSession(
      ctx.habitat.getSessionsDir(),
      params.contextId,
    );
    if (!resolved) return notFound(ctx.res, params.contextId);

    let body = '';
    for (const path of resolved.transcriptReadPaths) {
      try {
        const chunk = await readFile(path, 'utf-8');
        body += chunk.endsWith('\n') || chunk === '' ? chunk : `${chunk}\n`;
      } catch {
        // segment vanished between listing and read — skip
      }
    }

    ctx.res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
    });
    ctx.res.end(body);
  },
};
