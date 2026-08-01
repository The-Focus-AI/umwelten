/**
 * Bearer token auth — checks Authorization: Bearer <token> against known keys.
 *
 * Accepts one or many. Every habitat Gaia starts gets its own key, so keys are
 * already per-consumer down there; this gives Gaia itself the same property.
 * Hand each caller — the dashboard, an agent, a person — a distinct value and
 * revoke it by removing it from the list, without rotating the others.
 *
 * All keys are equivalent: same rights, same 'bearer-user' identity. This is a
 * list of accepted values, not a set of roles.
 *
 * Static assets and /health should be excluded at the server level.
 */

import type { IncomingMessage } from 'node:http';
import type { AuthProvider, UserContext } from '../types.js';

/**
 * Split a comma-separated env value into keys.
 *
 * Blanks are dropped, so a trailing comma or a fully empty variable yields no
 * keys rather than a key that matches the empty string.
 */
export function parseApiKeys(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0);
}

export function bearerAuth(apiKey: string | string[]): AuthProvider {
  const keys = new Set(
    (Array.isArray(apiKey) ? apiKey : [apiKey]).filter(k => k.length > 0),
  );

  return {
    name: 'bearer',
    async authenticate(req: IncomingMessage): Promise<UserContext | null> {
      const header = req.headers.authorization;
      if (!header) return null;

      const [scheme, token] = header.split(' ', 2);
      if (scheme?.toLowerCase() !== 'bearer' || !token) return null;

      if (!keys.has(token)) return null;

      return {
        userId: 'bearer-user',
        provider: 'oauth',
      };
    },
  };
}
