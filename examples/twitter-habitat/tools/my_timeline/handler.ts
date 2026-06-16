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
import { XTokenStore, habitatSecretStore } from '../../src/token-store.js';
import { XReadClient } from '../../src/x-read-client.js';
import { XAuthError } from '../../src/x-oauth.js';

interface HabitatLike {
  getSecret(name: string): string | undefined;
  setSecret(name: string, value: string): Promise<void>;
}

export default (habitat: unknown) => {
  const secrets = habitatSecretStore(habitat as HabitatLike);
  const tokens = new XTokenStore({ secrets });
  const client = new XReadClient(tokens);

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
      try {
        const posts = await client.getHomeTimeline({ maxResults: limit ?? 20 });
        return { count: posts.length, posts };
      } catch (err) {
        if (err instanceof XAuthError && err.kind === 'needs_reauth') {
          return { error: err.message, kind: err.kind };
        }
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
};
