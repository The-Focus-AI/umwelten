/**
 * Generic MCP server with upstream OAuth.
 *
 * Usage:
 *   const server = createMcpServer({
 *     name: 'twitter-mcp',
 *     upstream: twitterOAuthProvider,
 *     registerTools: registerTwitterTools,
 *     store: new NeonStore(DATABASE_URL),
 *   });
 *   server.listen(8080);
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { McpServeConfig } from './types.js';
import { handleMcpRequest, type McpHandlerConfig } from './mcp-handler.js';
import { handleProtectedResource, handleAuthServerMetadata } from './oauth/metadata.js';
import { handleRegister } from './oauth/register.js';
import { handleAuthorize, handleUpstreamCallback } from './oauth/authorize.js';
import { handleToken } from './oauth/token.js';
import { getPublicBaseUrl } from './public-url.js';

async function serveStaticIndex(staticRoot: string, res: ServerResponse): Promise<boolean> {
  try {
    const html = await readFile(resolve(staticRoot, 'index.html'), 'utf-8');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    });
    res.end(html);
    return true;
  } catch {
    return false;
  }
}

const STATIC_CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function serveStaticFile(staticRoot: string, urlPath: string, res: ServerResponse): Promise<boolean> {
  const rootAbs = resolve(staticRoot);
  const requested = resolve(rootAbs, '.' + urlPath);
  if (!requested.startsWith(rootAbs + '/') && requested !== rootAbs) return false;
  try {
    const data = await readFile(requested);
    const ext = requested.slice(requested.lastIndexOf('.')).toLowerCase();
    const contentType = STATIC_CONTENT_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=300',
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

export interface McpHttpServer {
  listen(port?: number): void;
  close(): void;
}

export function createMcpServer(config: McpServeConfig): McpHttpServer {
  const { name, version = '0.1.0', upstream, registerTools, store, staticRoot } = config;
  const port = config.port ?? 8080;

  const mcpHandlerConfig: McpHandlerConfig = {
    serverName: name,
    serverVersion: version,
    upstream,
    store,
    registerTools,
  };

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
        return await handleAuthorize(upstream, store, publicBaseUrl, req, res);
      }
      if (path === '/oauth/upstream-callback' && req.method === 'GET') {
        return await handleUpstreamCallback(upstream, store, publicBaseUrl, req, res);
      }
      if (path === '/oauth/token' && req.method === 'POST') {
        return await handleToken(store, req, res);
      }

      // MCP endpoint
      if (path === '/mcp') {
        return await handleMcpRequest(mcpHandlerConfig, req, res, publicBaseUrl);
      }

      // Health check
      if (path === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', name }));
        return;
      }

      // Optional static landing page
      if (staticRoot && req.method === 'GET' && (path === '/' || path === '/index.html')) {
        if (await serveStaticIndex(staticRoot, res)) return;
      }

      // Optional static assets (images, css, etc.)
      if (staticRoot && req.method === 'GET' && path !== '/' && !path.includes('..')) {
        if (await serveStaticFile(staticRoot, path, res)) return;
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

  return {
    listen(p?: number) {
      const listenPort = p ?? port;
      server.listen(listenPort, '0.0.0.0', () => {
        console.log(`${name} MCP server listening on port ${listenPort}`);
      });

      for (const signal of ['SIGTERM', 'SIGINT'] as const) {
        process.on(signal, () => {
          console.log(`${signal} received, shutting down...`);
          server.close(() => process.exit(0));
        });
      }
    },
    close() {
      server.close();
    },
  };
}
