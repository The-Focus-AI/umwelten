/**
 * Fetch a URL and convert its HTML to markdown.
 * Uses built-in Turndown by default; set MARKIFY_URL to use the Markify service instead.
 */

import { fetchUrl } from "./fetch_url.js";
import { fromHtmlBuiltIn, fromHtmlViaMarkify } from "./from_html.js";

export interface UrlToMarkdownResult {
  url: string;
  markdown: string;
}

/**
 * Fetch a URL and convert the response to markdown.
 * Uses built-in conversion (Turndown). If MARKIFY_URL is set, uses the Markify service instead.
 * Only HTML (or text) responses are converted; others return an error.
 */
export async function urlToMarkdown(url: string): Promise<UrlToMarkdownResult> {
  const result = await fetchUrl(url);
  if (result.statusCode !== 200) {
    throw new Error(`HTTP ${result.statusCode} for ${url}`);
  }
  const ct = (result.contentType ?? "").toLowerCase();
  if (!ct.includes("text/html") && !ct.includes("text/plain")) {
    throw new Error(
      `URL did not return HTML (content-type: ${result.contentType ?? "unknown"}). Use wget for raw content.`
    );
  }
  if (result.truncated) {
    throw new Error(`Page too large: ${result.content}`);
  }
  const markdown = process.env.MARKIFY_URL
    ? await fromHtmlViaMarkify(result.content)
    : fromHtmlBuiltIn(result.content);
  return { url, markdown };
}
