/**
 * Habitat web search tool using Tavily.
 * Reads TAVILY_API_KEY from habitat secrets or process.env.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { Tool } from 'ai';

/** Interface for the habitat context that search tools need. */
export interface SearchToolsContext {
  getSecret(name: string): string | undefined;
}

export function createSearchTools(ctx: SearchToolsContext): Record<string, Tool> {
  const searchTool = tool({
    description:
      'Search the web for current information. Use for facts, recent events, or when the user asks to look something up. Always provide a non-empty query.',
    inputSchema: z.object({
      query: z.string().min(1, 'query is required').describe('Search query for the web'),
      max_results: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe('Max results to return (1-20)'),
    }),
    execute: async ({ query, max_results }) => {
      const trimmed = typeof query === 'string' ? query.trim() : '';
      if (!trimmed) {
        return {
          error: 'Search requires a non-empty query. Please call search again with a specific search query.',
          results: [],
        };
      }
      const apiKey = ctx.getSecret('TAVILY_API_KEY');
      if (!apiKey) {
        return {
          error: 'TAVILY_API_KEY is not set. Add it via "umwelten habitat secrets set TAVILY_API_KEY <key>" or set the environment variable.',
          results: [],
        };
      }
      try {
        const { tavily } = await import('@tavily/core');
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

  return { search: searchTool };
}
