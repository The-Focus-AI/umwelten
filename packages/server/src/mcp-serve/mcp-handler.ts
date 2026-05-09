/**
 * MCP request handler — creates a stateless McpServer per request,
 * authenticates via Bearer token, and registers tools for the user.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServeStore, UpstreamOAuthProvider, McpToolRegistrar } from './types.js';
import { hashToken } from './oauth/token.js';

export interface McpHandlerConfig {
  serverName: string;
  serverVersion: string;
  upstream: UpstreamOAuthProvider;
  store: McpServeStore;
  registerTools: McpToolRegistrar;
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

export async function handleMcpRequest(
  config: McpHandlerConfig,
  req: IncomingMessage,
  res: ServerResponse,
  publicBaseUrl: string,
): Promise<void> {
  const { store, upstream } = config;

  // Handle DELETE for session termination
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

  // Authenticate
  const userId = await authenticateRequest(req, store);
  if (!userId) {
    sendUnauthorized(res, publicBaseUrl);
    return;
  }

  // Parse request body
  const rawBody = await new Promise<string>((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

  let parsedBody: unknown;
  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: Invalid JSON' }, id: null }));
    return;
  }

  // Create fresh McpServer for this request (stateless)
  const mcpServer = new McpServer({
    name: config.serverName,
    version: config.serverVersion,
  });

  // Register tools with a token-getter closure
  const getUpstreamToken = () => getValidUpstreamToken(userId, store, upstream);
  await config.registerTools(mcpServer, userId, getUpstreamToken);

  // Create transport in stateless mode
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    console.error('MCP request error:', error);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end('Internal server error');
    }
  } finally {
    try { await transport.close(); } catch { /* ignore cleanup errors */ }
  }
}
