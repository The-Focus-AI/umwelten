/**
 * startWebServer — HTTP server for the umwelten web adapter.
 *
 * Composition:
 *   HTTP request
 *     → auth middleware (resolves UserContext)
 *     → /api/chat → WebAdapter → ChannelBridge → AI SDK UI stream
 *     → /api/* → default route set (me, sessions, habitat)
 *     → custom routes (passed via config.routes)
 *     → static assets (staticRoot)
 *     → 404
 *
 * Mirrors the shape of src/habitat/mcp-serve/server.ts but for HTTP chat
 * rather than MCP. Built on Node's built-in http module — no Express.
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { ChannelBridge } from '../bridge/channel-bridge.js';
import { devAuth } from './auth/dev-auth.js';
import { WebAdapter } from './WebAdapter.js';
import type {
  AuthProvider,
  RouteContext,
  RouteHandler,
  StartedWebServer,
  WebServerConfig,
} from './types.js';
import { defaultRoutes } from './routes/index.js';

// ── Helpers ──────────────────────────────────────────────────────────

function parseRoute(url: string): { path: string; query: Record<string, string> } {
  const [path, qs] = url.split('?', 2);
  const query: Record<string, string> = {};
  if (qs) {
    for (const pair of qs.split('&')) {
      const [k, v] = pair.split('=', 2);
      if (k) query[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
  }
  return { path: path ?? '/', query };
}

/**
 * Match a route pattern with :params against a path.
 * Returns param values if matched, null otherwise.
 */
function matchRoute(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (p !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  });
  res.end(JSON.stringify(data));
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function serveStatic(
  staticRoot: string,
  urlPath: string,
  res: ServerResponse,
): Promise<boolean> {
  // Normalize: "/" → "/index.html", strip leading "/", reject ".."
  let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  if (rel.includes('..')) return false;
  const abs = resolve(staticRoot, rel);
  try {
    const s = await stat(abs);
    if (s.isDirectory()) {
      // Try index.html inside directory
      const indexAbs = resolve(abs, 'index.html');
      const idx = await stat(indexAbs).catch(() => null);
      if (!idx) return false;
      const body = await readFile(indexAbs);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(body);
      return true;
    }
    const body = await readFile(abs);
    const ext = extname(abs).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

// ── startWebServer ───────────────────────────────────────────────────

export async function startWebServer(
  config: WebServerConfig,
): Promise<StartedWebServer> {
  const {
    habitat,
    staticRoot,
    port = 3000,
    host = '0.0.0.0',
    platformInstruction = 'You are responding via a web interface. Markdown is rendered natively.',
  } = config;

  const auth: AuthProvider =
    config.auth === 'dev' ? devAuth() : config.auth;

  const bridge = new ChannelBridge(habitat, { platformInstruction });
  const webAdapter = new WebAdapter(bridge);

  // Compose the full route set: user-supplied first so they can override
  // defaults on path+method collisions (first match wins in the loop).
  const allRoutes: RouteHandler[] = [
    ...(config.routes ?? []),
    ...defaultRoutes(),
  ];

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const { path, query } = parseRoute(req.url ?? '/');

    // CORS preflight (permissive; tighten when adding cookie auth)
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }

    try {
      // Let the auth provider handle its own routes first (/auth/login etc.)
      if (auth.handleAuthRoute) {
        const handled = await auth.handleAuthRoute(req, res);
        if (handled) return;
      }

      // Match registered routes first so callers can override any default
      // (including /api/chat) by passing a matching entry in config.routes.
      for (const route of allRoutes) {
        if (route.method !== req.method) continue;
        const params = matchRoute(route.path, path);
        if (!params) continue;

        let user = null;
        if (!route.skipAuth) {
          user = await auth.authenticate(req);
          if (!user) {
            sendJson(res, { error: 'Unauthorized' }, 401);
            return;
          }
        }

        const ctx: RouteContext = {
          habitat,
          bridge,
          user: user ?? { userId: 'anonymous', provider: 'dev' },
          req,
          res,
          path,
          query,
        };
        return await route.handle(ctx, params);
      }

      // POST /api/chat — the default AI SDK UI Message Stream endpoint.
      // Runs last so apps can override it with a custom route (e.g. Gaia's
      // legacy SSE format).
      if (path === '/api/chat' && req.method === 'POST') {
        const user = await auth.authenticate(req);
        if (!user) {
          sendJson(res, { error: 'Unauthorized' }, 401);
          return;
        }
        return await webAdapter.handleChat(req, res, user);
      }

      // Static assets
      if (staticRoot && req.method === 'GET') {
        const served = await serveStatic(staticRoot, path, res);
        if (served) return;

        // SPA fallback: any unmatched GET falls back to index.html so client
        // routing works. Only when the path looks like a page (no file ext).
        if (!extname(path)) {
          const fell = await serveStatic(staticRoot, '/', res);
          if (fell) return;
        }
      }

      sendJson(res, { error: 'Not found', path }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[web-serve]', message);
      if (!res.headersSent) {
        sendJson(res, { error: message }, 500);
      } else {
        res.end();
      }
    }
  });

  return new Promise<StartedWebServer>((resolvePromise, rejectPromise) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        rejectPromise(new Error(`Port ${port} is already in use. Try --port ${port + 1}`));
      } else {
        rejectPromise(err);
      }
    });
    server.listen(port, host, () => {
      const actualPort = (server.address() as { port: number }).port;
      resolvePromise({
        port: actualPort,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}
