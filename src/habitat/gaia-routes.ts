/**
 * Gaia-specific route pack.
 *
 * Gaia has two routes that aren't (yet) part of the default umwelten-web
 * surface:
 *   POST /api/chat     — legacy custom-SSE format (event: text / tool-call /
 *                        tool-result / done / error) consumed by the existing
 *                        Gaia UI in examples/gaia-ui/.
 *   POST /api/command  — bridge slash commands (/agents /switch /status etc.)
 *
 * These override the defaults from src/ui/web/. When the Gaia UI migrates to
 * the AI SDK UI Message Stream Protocol (task: rewrite examples/gaia-ui/) we
 * can delete the legacy /api/chat route and fall back to the default.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteHandler } from '../ui/web/types.js';
import type { ChannelBridge } from '../ui/bridge/channel-bridge.js';

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sseWrite(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * POST /api/chat — Gaia's legacy SSE-event chat stream.
 * Emits: event: session / text / tool-call / tool-result / done / error
 */
export const gaiaLegacyChatRoute: RouteHandler = {
  method: 'POST',
  path: '/api/chat',
  async handle(ctx) {
    const { bridge, req, res, user } = ctx;
    let body: Record<string, unknown>;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing "message" field' }));
      return;
    }

    const requestedSessionId =
      typeof body.sessionId === 'string' ? body.sessionId : undefined;
    const channelKey = requestedSessionId
      ? `web:${requestedSessionId}`
      : `web:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Emit session id early so the client can resume
    const existingSessionId = bridge.getChannelSessionId(channelKey);
    sseWrite(res, 'session', {
      sessionId: existingSessionId ?? channelKey.slice(4),
    });

    await bridge.handleMessage(
      { channelKey, text: message, userId: user.userId },
      {
        onText: (delta) => sseWrite(res, 'text', { text: delta }),
        onToolCall: (name, input) => sseWrite(res, 'tool-call', { name, input }),
        onToolResult: (name, output, isError) =>
          sseWrite(res, 'tool-result', { name, output, isError }),
        onDone: (result) => {
          sseWrite(res, 'done', {
            content: result.content,
            sessionId: result.sessionId,
          });
          res.end();
        },
        onError: (error) => {
          sseWrite(res, 'error', { error });
          res.end();
        },
      },
    );
  },
};

/**
 * POST /api/command — run a bridge slash command (/agents, /switch, /status).
 */
export const gaiaCommandRoute: RouteHandler = {
  method: 'POST',
  path: '/api/command',
  async handle(ctx) {
    const { bridge, req, res } = ctx;
    let body: Record<string, unknown>;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }
    const command = typeof body.command === 'string' ? body.command.trim() : '';
    if (!command) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing "command" field' }));
      return;
    }
    const sessionId =
      typeof body.sessionId === 'string' ? body.sessionId : 'default';
    const channelKey = `web:${sessionId}`;

    const { processBridgeCommand } = await import('../ui/bridge/commands.js');
    const result = await processBridgeCommand(bridge, channelKey, command);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  },
};

export function gaiaRoutes(): RouteHandler[] {
  return [gaiaLegacyChatRoute, gaiaCommandRoute];
}
