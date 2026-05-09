/**
 * Dev auth — a no-login AuthProvider that pins every request to a fixed userId.
 *
 * Use this for local development, internal tools, and the Gaia UI where the
 * server runs on the user's machine and auth adds nothing.
 */

import type { AuthProvider, UserContext } from '../types.js';

export function devAuth(options?: {
  userId?: string;
  displayName?: string;
}): AuthProvider {
  const userId = options?.userId ?? 'dev';
  const displayName = options?.displayName ?? 'dev';
  const user: UserContext = {
    userId,
    displayName,
    provider: 'dev',
  };
  return {
    name: 'dev',
    async authenticate() {
      return user;
    },
  };
}
