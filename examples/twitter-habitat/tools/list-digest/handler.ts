/**
 * `list_digest` Agent tool — factory pattern (public-data path, #153).
 *
 * Digest a tracked list: its members, their top tweets by engagement, and the
 * latest pre-generated summary. Degrades gracefully for an unknown list so the
 * agent can say "I don't track that list" instead of erroring.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { lazyFeedReader, toErrorResult, type HabitatSecretReader } from '../../src/feed-tool-support.js';

export default (habitat: unknown) => {
  const getReader = lazyFeedReader(habitat as HabitatSecretReader);

  return tool({
    description:
      'Digest a tracked list (e.g. "ai-engineers", "AI Engineers"): its high-signal ' +
      'recent tweets ranked by engagement, plus the latest pre-generated summary ' +
      'when one exists. Use when the user asks to digest/summarize a list or "what\'s ' +
      'the AI engineers list up to?". Public data, read-only. Unknown lists return ' +
      'found=false rather than an error.',
    inputSchema: z.object({
      list: z
        .string()
        .min(1)
        .describe('The list to digest — its slug (e.g. "ai-engineers") or display name.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('How many top tweets to include (default 20, max 100).'),
      sinceHours: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Look-back window for the top tweets in hours (default 48).'),
    }),
    async execute({ list, limit, sinceHours }) {
      try {
        const reader = await getReader();
        const digest = await reader.getListDigest(list, { limit, sinceHours });
        if (!digest.found) {
          return {
            found: false,
            message: `No tracked list matches "${list}". Ask for the tracked lists or try its slug.`,
          };
        }
        return {
          found: true,
          list: digest.list,
          memberCount: digest.members.length,
          members: digest.members,
          summary: digest.summary ?? null,
          topTweets: digest.topTweets,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    },
  });
};
