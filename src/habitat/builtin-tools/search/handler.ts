/**
 * Tavily web search tool. Self-contained — reads TAVILY_API_KEY from env.
 * Direct Tool export (no factory needed).
 */

import { tool } from 'ai';
import { z } from 'zod';
import { tavily } from '@tavily/core';

const searchSchema = z.object({
  query: z.string().min(1, 'query is required').describe('Search query for the web'),
  max_results: z.number().min(1).max(20).optional().default(5).describe('Max results to return (1-20)'),
});

export default tool({
  description: 'Search the web for current information. Use for facts, recent events, or when the user asks to look something up. Always provide a non-empty query.',
  inputSchema: searchSchema,
  execute: async ({ query, max_results }) => {
    const trimmed = typeof query === 'string' ? query.trim() : '';
    if (!trimmed) {
      return {
        error: 'Search requires a non-empty query. Please call search again with a specific search query.',
        results: [],
      };
    }
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return {
        error: 'TAVILY_API_KEY is not set. Add it to your environment.',
        results: [],
      };
    }
    try {
      const client = tavily({ apiKey });
      const response = await client.search(trimmed, {
        maxResults: max_results,
        searchDepth: 'basic',
        includeAnswer: false,
      });
      return {
        query: response.query,
        results: (response.results ?? []).map((r: { title?: string; url?: string; content?: string }) => ({
          title: r.title,
          url: r.url,
          content: r.content,
        })),
        responseTime: response.responseTime,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: message, results: [] };
    }
  },
});
