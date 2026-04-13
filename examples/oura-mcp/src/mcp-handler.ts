import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Store } from './store.js';
import { hashToken } from './oauth/token.js';
import { registerOuraTools } from './oura-tool-set.js';

export interface McpHandlerConfig {
  ouraClientId: string;
  ouraClientSecret: string;
}

/**
 * Validate Bearer token and return user_id, or null if invalid.
 */
async function authenticateRequest(
  req: IncomingMessage,
  store: Store,
): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  
  const token = auth.slice(7);
  const hash = hashToken(token);
  const userId = await store.getUserByTokenHash(hash);
  return userId;
}

/**
 * Handle an MCP request over Streamable HTTP.
 * Creates a fresh McpServer per request (stateless pattern).
 */
function sendMcpUnauthorized(
  res: ServerResponse,
  publicBaseUrl: string,
  opts?: { head?: boolean },
): void {
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

export async function handleMcpRequest(
  config: McpHandlerConfig,
  store: Store,
  req: IncomingMessage,
  res: ServerResponse,
  publicBaseUrl: string,
): Promise<void> {
  // Handle DELETE for session termination
  if (req.method === 'DELETE') {
    res.writeHead(200);
    res.end('Session terminated');
    return;
  }

  // Clients (e.g. Claude Code OAuth) often probe with HEAD; plain 405 + non-JSON breaks their error parser.
  if (req.method === 'HEAD') {
    const userId = await authenticateRequest(req, store);
    if (!userId) {
      sendMcpUnauthorized(res, publicBaseUrl, { head: true });
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
    res.end(
      JSON.stringify({
        error: 'method_not_allowed',
        error_description: 'Use GET, HEAD, POST, or DELETE',
      }),
    );
    return;
  }

  // Authenticate
  const userId = await authenticateRequest(req, store);
  if (!userId) {
    sendMcpUnauthorized(res, publicBaseUrl);
    return;
  }

  // Read and parse request body as JSON (SDK expects parsed object)
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

  // Create fresh McpServer for this request
  const mcpServer = new McpServer({
    name: 'oura-mcp',
    version: '0.1.0',
  });

  // Register oura tools for this user
  await registerOuraTools(
    mcpServer,
    userId,
    store,
    config.ouraClientId,
    config.ouraClientSecret,
  );

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
