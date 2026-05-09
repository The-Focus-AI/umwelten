/**
 * Bearer token auth — checks Authorization: Bearer <token> against a known key.
 *
 * If no key is configured, all requests are allowed (open access).
 * Static assets and /health should be excluded at the server level.
 */

import type { IncomingMessage } from 'node:http';
import type { AuthProvider, UserContext } from '../types.js';

export function bearerAuth(apiKey: string): AuthProvider {
  return {
    name: 'bearer',
    async authenticate(req: IncomingMessage): Promise<UserContext | null> {
      const header = req.headers.authorization;
      if (!header) return null;

      const [scheme, token] = header.split(' ', 2);
      if (scheme?.toLowerCase() !== 'bearer' || !token) return null;

      if (token !== apiKey) return null;

      return {
        userId: 'bearer-user',
        provider: 'oauth',
      };
    },
  };
}
