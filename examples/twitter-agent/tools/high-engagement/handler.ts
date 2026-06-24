/**
 * `high_engagement` Agent tool — factory pattern (public-data path, #153).
 *
 * The most notable tweets across the tracked public feed, ranked by engagement
 * (likes + retweets + replies). Thin: delegates ranking to the FeedReader / SQL.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { lazyFeedReader, toErrorResult, type HabitatSecretReader } from '../../src/feed-tool-support.js';

/** Default window for "what's notable" so all-time blockbusters don't dominate. */
const DEFAULT_SINCE_HOURS = 24;

export default (habitat: unknown) => {
  const getReader = lazyFeedReader(habitat as HabitatSecretReader);

  return tool({
    description:
      'Show the most notable tweets across the tracked public feed, ranked by ' +
      'engagement (likes + retweets + replies). Use when the user asks what is ' +
      'notable / popular / trending among tracked people, or "what are the top ' +
      'tweets right now". Public data, read-only. Defaults to the last 24 hours.',
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('How many tweets to return (default 20, max 100).'),
      sinceHours: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Look-back window in hours (default 24).'),
    }),
    async execute({ limit, sinceHours }) {
      try {
        const reader = await getReader();
        const tweets = await reader.getHighEngagement({
          limit,
          sinceHours: sinceHours ?? DEFAULT_SINCE_HOURS,
        });
        return { count: tweets.length, sinceHours: sinceHours ?? DEFAULT_SINCE_HOURS, tweets };
      } catch (err) {
        return toErrorResult(err);
      }
    },
  });
};
