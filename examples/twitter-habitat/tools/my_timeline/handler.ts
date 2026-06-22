/**
 * `my_timeline` Agent tool — factory pattern.
 *
 * The authenticated user's reverse-chronological home timeline: recent posts,
 * retweets, and replies from the accounts they follow. Reads through their own
 * OAuth token (managed by the X token store) and the X read client. Stays thin:
 * no HTTP, no auth, no SQL.
 *
 * Mirrors the bookmarks tool — see tools/bookmarks/handler.ts. NOTE: the home
 * timeline needs the `follows.read` scope; a token minted without it returns 403,
 * which surfaces here as a needs-reauth message telling the operator to re-bootstrap.
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
  const userTokens = perUserTokenStores(habitat as HabitatLike);

  return tool({
    description:
      "Show the authenticated user's X (Twitter) home timeline — recent posts, retweets, " +
      'and replies from the accounts they follow, newest first. Use when the user asks ' +
      '"what\'s on my timeline?", "my home feed", or "what are the people I follow posting?".',
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('How many timeline posts to return (default 20, max 100).'),
    }),
    async execute({ limit }) {
      const client = new XReadClient(userTokens.current());
      try {
        const posts = await client.getHomeTimeline({ maxResults: limit ?? 20 });
        return { count: posts.length, posts };
      } catch (err) {
        if (err instanceof XAuthError && err.kind === 'needs_reauth') {
          const sub = userTokens.currentSubject();
          return {
            error: sub
              ? "Your X account isn't connected yet. Connect it in the habitats app to see your timeline."
              : 'Twitter is not authenticated. Connect an X account (or run the OAuth bootstrap) for this habitat.',
            kind: 'needs_x_connect',
          };
        }
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
};
