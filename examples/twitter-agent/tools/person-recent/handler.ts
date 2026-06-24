/**
 * `person_recent` Agent tool — factory pattern (public-data path, #153).
 *
 * "What's <person> been posting?" — reads a tracked person's recent tweets from
 * the Neon store the twitter-feed pipeline syncs. Thin: pulls DATABASE_URL from
 * the habitat, delegates to the FeedReader, embeds no SQL.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { lazyFeedReader, toErrorResult, type HabitatSecretReader } from '../../src/feed-tool-support.js';

export default (habitat: unknown) => {
  const getReader = lazyFeedReader(habitat as HabitatSecretReader);

  return tool({
    description:
      "Show a specific person's recent tweets from the tracked public feed (the " +
      'twitter-feed Neon store). Use when the user asks what someone has been ' +
      'posting or saying, e.g. "what\'s @karpathy been up to?". Public data — no ' +
      "X login needed. Returns each tweet's text, engagement, and a permalink.",
    inputSchema: z.object({
      handle: z
        .string()
        .min(1)
        .describe('The X @handle to look up (with or without the leading @).'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('How many recent tweets to return (default 20, max 100).'),
      sinceHours: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Only tweets newer than this many hours, when set.'),
    }),
    async execute({ handle, limit, sinceHours }) {
      try {
        const reader = await getReader();
        const tweets = await reader.getPersonRecent(handle, { limit, sinceHours });
        return { handle, count: tweets.length, tweets };
      } catch (err) {
        return toErrorResult(err);
      }
    },
  });
};
