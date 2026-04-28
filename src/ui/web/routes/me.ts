import type { RouteHandler } from '../types.js';

/** GET /api/me — returns the authenticated user's context. */
export const meRoute: RouteHandler = {
  method: 'GET',
  path: '/api/me',
  async handle(ctx) {
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(ctx.user));
  },
};
