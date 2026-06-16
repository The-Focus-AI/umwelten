/**
 * `mentions` Agent tool — factory pattern.
 *
 * "Who replied to / mentioned me?" Reads the authenticated user's X mentions
 * timeline through their own OAuth token (managed by the X token store) and the
 * X read client. Stays thin: no HTTP, no auth, no SQL.
 *
 * Mirrors the bookmarks tool — see tools/bookmarks/handler.ts for the shared
 * factory shape and why credentials come from Habitat secrets, never env globals.
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
      'Show recent tweets that mention or reply to the authenticated user on X (Twitter). ' +
      'Use when the user asks "who replied to me?", "who mentioned me?", or about replies/mentions.',
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .min(5)
        .max(100)
        .optional()
        .describe('How many mentions to return (default 20, min 5, max 100).'),
    }),
    async execute({ limit }) {
      try {
        const mentions = await client.getMentions({ maxResults: limit ?? 20 });
        return { count: mentions.length, mentions };
      } catch (err) {
        if (err instanceof XAuthError && err.kind === 'needs_reauth') {
          return { error: err.message, kind: err.kind };
        }
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
};
