/**
 * URL tools: wget (fetch URL content) and markify (fetch URL and convert to markdown).
 * Uses native fetch and the Markify service (MARKIFY_URL). No extra dependencies.
 */

import { tool } from "ai";
import { z } from "zod";
import { fetchUrl } from "../../markdown/fetch_url.js";
import { urlToMarkdown } from "../../markdown/url_to_markdown.js";

const urlSchema = z.object({
  url: z.string().url().describe("The URL to fetch"),
});

/**
 * Wget-style tool: fetch a URL and return status, content-type, and body (text).
 * Non-text responses return a short placeholder. Response size is limited.
 */
export const wgetTool = tool({
  description:
    "Fetch a URL and return the raw response (status, content-type, and body as text). Use for APIs, plain text, or when you need the unprocessed page content. Size and time limits apply.",
  inputSchema: urlSchema,
  execute: async ({ url }) => {
    try {
      const result = await fetchUrl(url);
      return {
        url: result.url,
        statusCode: result.statusCode,
        contentType: result.contentType ?? undefined,
        content: result.content,
        ...(result.truncated && { truncated: true }),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        url,
        error: message,
        statusCode: undefined,
        content: "",
      };
    }
  },
});

/**
 * Markify tool: fetch a URL and convert it to clean markdown.
 * Uses built-in conversion (Turndown). Set MARKIFY_URL to use the Markify service instead.
 */
export const markifyTool = tool({
  description:
    "Fetch a URL and convert the page to readable markdown. Use for articles, docs, or any webpage the user wants as markdown. Fails if the URL is not HTML or the Markify service is unavailable.",
  inputSchema: urlSchema,
  execute: async ({ url }) => {
    try {
      const result = await urlToMarkdown(url);
      return {
        url: result.url,
        markdown: result.markdown,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        url,
        error: message,
        markdown: "",
      };
    }
  },
});
