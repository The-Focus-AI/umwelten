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
      try {
        const bookmarks = await client.getBookmarks({ maxResults: limit ?? 20 });
        return { count: bookmarks.length, bookmarks };
      } catch (err) {
        if (err instanceof XAuthError && err.kind === 'needs_reauth') {
          return {
            error:
              'Twitter is not authenticated yet. Run the OAuth bootstrap and store the ' +
              'TWITTER_REFRESH_TOKEN secret on this habitat.',
            kind: err.kind,
          };
        }
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
};
