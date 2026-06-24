/**
 * `bookmarks` Agent tool — factory pattern.
 *
 * Loaded from this habitat work directory's tools/ folder by Habitat.create(),
 * which passes the Habitat in as the factory context. The tool pulls the X OAuth
 * credentials from Habitat secrets (never env-baked globals) via the token store,
 * then calls the X read client. It stays thin: no HTTP, no auth, no SQL.
 *
 * The factory builds one XTokenStore for the tool's lifetime so the access-token
 * cache + single-flight refresh are shared across calls.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { perUserTokenStores } from '../../src/token-store.js';
import { XReadClient } from '../../src/x-read-client.js';
import { XAuthError } from '../../src/x-oauth.js';

interface HabitatLike {
  getSecret(name: string): string | undefined;
  setSecret(name: string, value: string): Promise<void>;
  /** Verified speaking user (ADR 0003) — keys this user's own X token. */
  getCurrentUserId?(): string | undefined;
}

export default (habitat: unknown) => {
  // Per-user tokens (ADR 0003 / #176): resolve the speaker each call and read
  // their own X account; falls back to the shared operator token off the
  // per-user path.
  const userTokens = perUserTokenStores(habitat as HabitatLike);

  return tool({
    description:
      "Show the authenticated user's most recent X (Twitter) bookmarks (saved tweets). " +
      'Use when the user asks about their bookmarks or saved tweets.',
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('How many bookmarks to return (default 20, max 100).'),
    }),
    async execute({ limit }) {
      const client = new XReadClient(userTokens.current());
      try {
        const bookmarks = await client.getBookmarks({ maxResults: limit ?? 20 });
        return { count: bookmarks.length, bookmarks };
      } catch (err) {
        if (err instanceof XAuthError && err.kind === 'needs_reauth') {
          const sub = userTokens.currentSubject();
          return {
            error: sub
              ? "Your X account isn't connected yet. Connect it in the habitats app to see your bookmarks."
              : 'Twitter is not authenticated. Connect an X account (or run the OAuth bootstrap) for this habitat.',
            kind: 'needs_x_connect',
          };
        }
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
};
