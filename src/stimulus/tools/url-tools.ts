/**
 * URL tools: wget (fetch URL content), markify (fetch URL and convert to markdown),
 * and parse_feed (fetch and parse XML/RSS/Atom feeds).
 * Uses native fetch and the Markify service (MARKIFY_URL). No extra dependencies.
 */

import { tool } from "ai";
import { z } from "zod";
import { writeFile, mkdir } from "fs/promises";
import { join, resolve } from "path";
import { homedir } from "os";
import { fetchUrl } from "../../markdown/fetch_url.js";
import { urlToMarkdown } from "../../markdown/url_to_markdown.js";
import { parseFeed } from "../../markdown/feed_parser.js";

const MAX_LINES_INLINE = 500;
const MAX_SIZE_INLINE = 1024; // 1KB in bytes

/**
 * Count lines in a string
 */
function countLines(text: string): number {
  return text.split('\n').length;
}

/**
 * Check if content should be saved to a file (too large by lines or size)
 */
function shouldSaveToFile(content: string): { save: boolean; reason?: string; lineCount?: number; sizeBytes?: number } {
  const lineCount = countLines(content);
  const sizeBytes = Buffer.byteLength(content, 'utf-8');
  
  if (lineCount > MAX_LINES_INLINE || sizeBytes > MAX_SIZE_INLINE) {
    const reasons: string[] = [];
    if (lineCount > MAX_LINES_INLINE) {
      reasons.push(`${lineCount} lines (exceeds ${MAX_LINES_INLINE} line limit)`);
    }
    if (sizeBytes > MAX_SIZE_INLINE) {
      const sizeKB = (sizeBytes / 1024).toFixed(1);
      const maxKB = (MAX_SIZE_INLINE / 1024).toFixed(0);
      reasons.push(`${sizeKB}KB (exceeds ${maxKB}KB size limit)`);
    }
    return {
      save: true,
      reason: reasons.join(', '),
      lineCount,
      sizeBytes,
    };
  }
  
  return { save: false };
}

/**
 * Get the sessions directory (from env or default)
 */
function getSessionsDir(): string {
  const env = process.env.JEEVES_SESSIONS_DIR;
  if (env) {
    return resolve(env);
  }
  return join(homedir(), '.jeeves-sessions');
}

/**
 * Get or create a default session directory for downloads
 */
async function getDefaultSessionDir(): Promise<string> {
  const sessionsDir = getSessionsDir();
  const defaultSessionDir = join(sessionsDir, 'default-downloads');
  await mkdir(defaultSessionDir, { recursive: true });
  return defaultSessionDir;
}

/**
 * Write content to a session directory file and return the path
 */
async function writeToSessionFile(content: string, prefix: string, extension: string): Promise<string> {
  const sessionDir = await getDefaultSessionDir();
  
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  const filename = `${prefix}-${timestamp}-${random}.${extension}`;
  const filePath = join(sessionDir, filename);
  
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

const urlSchema = z.object({
  url: z.string().url().describe("The URL to fetch"),
});

const parseFeedSchema = z.object({
  url: z.string().url().describe("The URL of the XML, RSS, or Atom feed to fetch and parse"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Max number of feed items to return (default 50)"),
});

/**
 * Wget-style tool: fetch a URL and return status, content-type, and body (text).
 * Non-text responses return a short placeholder. Response size is limited.
 * Files larger than 500 lines or 1KB are saved to a temp file and the file path is returned instead.
 */
export const wgetTool = tool({
  description:
    "Fetch a URL and return the raw response (status, content-type, and body as text). Use for APIs, plain text, or when you need the unprocessed page content. Size and time limits apply. Files larger than 500 lines or 1KB are automatically saved to the session directory (path returned in 'filePath' field).",
  inputSchema: urlSchema,
  execute: async ({ url }) => {
    try {
      const result = await fetchUrl(url);
      
      // Check if content is large (by lines or size)
      const sizeCheck = shouldSaveToFile(result.content);
      if (sizeCheck.save) {
        // Determine file extension from content type or URL
        let extension = 'txt';
        if (result.contentType) {
          if (result.contentType.includes('json')) extension = 'json';
          else if (result.contentType.includes('html')) extension = 'html';
          else if (result.contentType.includes('xml')) extension = 'xml';
          else if (result.contentType.includes('css')) extension = 'css';
          else if (result.contentType.includes('javascript')) extension = 'js';
        }
        
        const filePath = await writeToSessionFile(result.content, 'wget', extension);
        return {
          url: result.url,
          statusCode: result.statusCode,
          contentType: result.contentType ?? undefined,
          filePath,
          lineCount: sizeCheck.lineCount,
          sizeBytes: sizeCheck.sizeBytes,
          message: `Content is ${sizeCheck.reason}. Saved to session directory. Use read_file with path set to the filePath above (full path) to read; use offset/limit for portions.`,
          ...(result.truncated && { truncated: true }),
        };
      }
      
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
 * Files larger than 500 lines or 1KB are saved to a temp file and the file path is returned instead.
 */
export const markifyTool = tool({
  description:
    "Fetch a URL and convert the page to readable markdown. Use for articles, docs, or any webpage the user wants as markdown. Fails if the URL is not HTML or the Markify service is unavailable. Files larger than 500 lines or 1KB are automatically saved to the session directory (path returned in 'filePath' field).",
  inputSchema: urlSchema,
  execute: async ({ url }) => {
    try {
      const result = await urlToMarkdown(url);
      
      // Check if markdown is large (by lines or size)
      const sizeCheck = shouldSaveToFile(result.markdown);
      if (sizeCheck.save) {
        const filePath = await writeToSessionFile(result.markdown, 'markify', 'md');
        return {
          url: result.url,
          filePath,
          lineCount: sizeCheck.lineCount,
          sizeBytes: sizeCheck.sizeBytes,
          message: `Markdown is ${sizeCheck.reason}. Saved to session directory. Use read_file with path set to the filePath above (full path) to read; use offset/limit for portions.`,
        };
      }
      
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

/**
 * Parse-feed tool: fetch a URL and parse as XML, RSS, or Atom.
 * Returns normalized feed metadata and items (title, link, description, pubDate).
 * Use for RSS/Atom feeds, sitemaps, or other XML that exposes item-like entries.
 */
export const parseFeedTool = tool({
  description:
    "Fetch a URL and parse it as XML, RSS, or Atom. Returns feed title/link/description and a list of items (title, link, description, pubDate). Use for RSS feeds, Atom feeds, or XML with item-like entries. Fails if the URL does not return XML/RSS/Atom.",
  inputSchema: parseFeedSchema,
  execute: async ({ url, limit }) => {
    try {
      const result = await parseFeed(url, { limit });
      return {
        url: result.url,
        format: result.format,
        feed: result.feed,
        items: result.items,
        itemCount: result.itemCount,
        ...(result.truncated && { truncated: true }),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        url,
        error: message,
        format: undefined,
        feed: undefined,
        items: [],
        itemCount: 0,
      };
    }
  },
});
