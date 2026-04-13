import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { Habitat } from 'umwelten';
import { Store } from './store.js';
import { handleMcpRequest, type McpHandlerConfig } from './mcp-handler.js';
import { handleProtectedResource, handleAuthServerMetadata } from './oauth/metadata.js';
import { handleRegister } from './oauth/register.js';
import { handleAuthorize, handleOuraCallback, type AuthorizeConfig } from './oauth/authorize.js';
import { handleToken } from './oauth/token.js';
import { getPublicBaseUrl } from './public-url.js';

// Required environment variables
function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`${name} environment variable required`);
  return val;
}

const DATABASE_URL = requireEnv('DATABASE_URL');
const OURA_CLIENT_ID = requireEnv('OURA_CLIENT_ID');
const OURA_CLIENT_SECRET = requireEnv('OURA_CLIENT_SECRET');
const PORT = parseInt(process.env.PORT || '8080', 10);

async function main() {
  // 1. Boot Habitat
  const habitat = await Habitat.create({
    workDir: new URL('../habitat', import.meta.url).pathname,
    skipBuiltinTools: true,
  });

  // Store Oura credentials as habitat secrets (if not already present)
  if (!habitat.getSecret('OURA_CLIENT_ID')) {
    await habitat.setSecret('OURA_CLIENT_ID', OURA_CLIENT_ID);
  }
  if (!habitat.getSecret('OURA_CLIENT_SECRET')) {
    await habitat.setSecret('OURA_CLIENT_SECRET', OURA_CLIENT_SECRET);
  }

  // 2. Create store
  const store = new Store(DATABASE_URL);

  // 3. Configs
  const authorizeStatic: Omit<AuthorizeConfig, 'baseUrl'> = {
    ouraClientId: OURA_CLIENT_ID,
    ouraClientSecret: OURA_CLIENT_SECRET,
  };

  const mcpConfig: McpHandlerConfig = {
    ouraClientId: OURA_CLIENT_ID,
    ouraClientSecret: OURA_CLIENT_SECRET,
  };

  // 4. Create HTTP server
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
      });
      res.end();
      return;
    }

    try {
      const publicBaseUrl = getPublicBaseUrl(req);

      // Well-known endpoints
      if (path === '/.well-known/oauth-protected-resource') {
        return handleProtectedResource(publicBaseUrl, req, res);
      }
      if (path === '/.well-known/oauth-authorization-server') {
        return handleAuthServerMetadata(publicBaseUrl, req, res);
      }

      // OAuth endpoints
      if (path === '/oauth/register' && req.method === 'POST') {
        return await handleRegister(store, req, res);
      }
      if (path === '/oauth/authorize' && req.method === 'GET') {
        return await handleAuthorize(
          { ...authorizeStatic, baseUrl: publicBaseUrl },
          store,
          req,
          res,
        );
      }
      if (path === '/oauth/oura-callback' && req.method === 'GET') {
        return await handleOuraCallback(
          { ...authorizeStatic, baseUrl: publicBaseUrl },
          store,
          req,
          res,
        );
      }
      if (path === '/oauth/token' && req.method === 'POST') {
        return await handleToken(store, req, res);
      }

      // MCP endpoint
      if (path === '/mcp') {
        return await handleMcpRequest(mcpConfig, store, req, res, publicBaseUrl);
      }

      // Health check
      if (path === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', habitat: habitat.getConfig().name }));
        return;
      }

      // Not found
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (error) {
      console.error('Request error:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
  });

  // 5. Start
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`oura-mcp server listening on port ${PORT}`);
    console.log(
      'Public base URL: from X-Forwarded-Proto/Host on Fly; else BASE_URL env; else Host (see public-url.ts)',
    );
    console.log(`Habitat: ${habitat.getConfig().name}`);
  });

  // Graceful shutdown
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      console.log(`${signal} received, shutting down...`);
      server.close(() => process.exit(0));
    });
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
