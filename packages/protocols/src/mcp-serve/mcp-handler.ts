/**
 * MCP request handler — authenticates via Bearer token, then serves the
 * request through the official SDK 2.x `createMcpHandler` (protocol revision
 * 2026-07-28 with the stateless 2025-era fallback). A fresh `McpServer` is
 * built per request by the factory, with tools registered for the
 * authenticated user and, when configured, the Skills extension attached.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createMcpHandler,
  McpServer,
  type AuthInfo,
  type McpRequestContext,
} from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { McpServeStore, UpstreamOAuthProvider, McpToolRegistrar } from './types.js';
import type { SkillsExtension } from '@modelcontextprotocol/server/ext/skills';
import { hashToken } from './oauth/token.js';

export interface McpHandlerConfig {
  serverName: string;
  serverVersion: string;
  upstream: UpstreamOAuthProvider;
  store: McpServeStore;
  registerTools: McpToolRegistrar;
  skills?: SkillsExtension;
}

/** The authenticated principal, carried to the server factory through `AuthInfo.extra`. */
interface McpServePrincipal {
  userId: string;
}

async function authenticateRequest(req: IncomingMessage, store: McpServeStore): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;

  const token = auth.slice(7);
  const hash = hashToken(token);
  return store.getUserByTokenHash(hash);
}

function sendUnauthorized(res: ServerResponse, publicBaseUrl: string, opts?: { head?: boolean }): void {
  const body = JSON.stringify({ error: 'unauthorized' });
  const headers: Record<string, string | number> = {
    'WWW-Authenticate': `Bearer resource_metadata="${publicBaseUrl}/.well-known/oauth-protected-resource"`,
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };
  if (opts?.head) {
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  res.writeHead(401, headers);
  res.end(opts?.head ? undefined : body);
}

/**
 * Get a valid upstream access token for a user, refreshing if needed.
 */
async function getValidUpstreamToken(
  userId: string,
  store: McpServeStore,
  upstream: UpstreamOAuthProvider,
): Promise<string> {
  const tokens = await store.getUpstreamTokens(userId);
  if (!tokens) throw new Error('No upstream tokens found for user');

  // Refresh if expired (with 5-minute buffer)
  if (tokens.expires_at && tokens.expires_at < new Date(Date.now() + 5 * 60 * 1000)) {
    const refreshed = await upstream.refreshToken(tokens.refresh_token);
    await store.upsertUpstreamTokens(userId, refreshed);
    return refreshed.access_token;
  }

  return tokens.access_token;
}

/**
 * Build the Node request handler for one mcp-serve config. The SDK handler is
 * created once; the factory runs per request with the principal the bearer
 * check established.
 */
export function createMcpRequestHandler(config: McpHandlerConfig): (
  req: IncomingMessage,
  res: ServerResponse,
  publicBaseUrl: string,
) => Promise<void> {
  const { store, upstream } = config;

  const sdkHandler = createMcpHandler(
    async (ctx: McpRequestContext) => {
      const principal = ctx.authInfo?.extra as McpServePrincipal | undefined;
      if (!principal?.userId) throw new Error('mcp-serve: request reached the server factory unauthenticated');
      const mcpServer = new McpServer({ name: config.serverName, version: config.serverVersion });
      config.skills?.attach(mcpServer);
      await config.registerTools(mcpServer, principal.userId, () =>
        getValidUpstreamToken(principal.userId, store, upstream),
      );
      return mcpServer;
    },
    { onerror: (error) => console.error('MCP request error:', error) },
  );
  const nodeHandler = toNodeHandler(sdkHandler, {
    onerror: (error) => console.error('MCP adapter error:', error),
  });

  return async (req, res, publicBaseUrl) => {
    // Handle DELETE for session termination (stateless: nothing to drop).
    if (req.method === 'DELETE') {
      res.writeHead(200);
      res.end('Session terminated');
      return;
    }

    // Handle HEAD probes (e.g., from Claude Code OAuth)
    if (req.method === 'HEAD') {
      const userId = await authenticateRequest(req, store);
      if (!userId) {
        sendUnauthorized(res, publicBaseUrl, { head: true });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end();
      return;
    }

    if (req.method !== 'POST' && req.method !== 'GET') {
      res.writeHead(405, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        Allow: 'GET, HEAD, POST, DELETE',
      });
      res.end(JSON.stringify({
        error: 'method_not_allowed',
        error_description: 'Use GET, HEAD, POST, or DELETE',
      }));
      return;
    }

    const userId = await authenticateRequest(req, store);
    if (!userId) {
      sendUnauthorized(res, publicBaseUrl);
      return;
    }

    const token = req.headers.authorization!.slice(7);
    const authInfo: AuthInfo = {
      token,
      clientId: userId,
      scopes: [],
      extra: { userId } satisfies McpServePrincipal,
    };
    (req as IncomingMessage & { auth?: AuthInfo }).auth = authInfo;
    await nodeHandler(req as IncomingMessage & { auth?: AuthInfo }, res);
  };
}
