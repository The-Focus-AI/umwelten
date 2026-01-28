/**
 * Fetch a URL with timeout and size limit. Used by wget tool and url-to-markdown.
 */

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const TEXT_TYPES = new Set([
  "text/html",
  "text/plain",
  "text/css",
  "text/csv",
  "text/xml",
  "application/json",
  "application/javascript",
  "application/xml",
  "application/xhtml+xml",
  "application/rss+xml",
]);

function isTextContentType(contentType: string | null): boolean {
  if (!contentType) return true;
  const base = contentType.split(";")[0].trim().toLowerCase();
  if (TEXT_TYPES.has(base)) return true;
  if (base.startsWith("text/")) return true;
  return false;
}

export interface FetchUrlResult {
  url: string;
  statusCode: number;
  contentType: string | null;
  content: string;
  truncated?: boolean;
}

export interface FetchUrlOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * Fetch a URL and return status, content-type, and body as text.
 * Respects timeout and max size; non-text types return a placeholder message.
 */
export async function fetchUrl(
  url: string,
  options: FetchUrlOptions = {}
): Promise<FetchUrlResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Umwelten/1.0 (URL fetch; https://github.com/The-Focus-AI/umwelten)",
      },
      redirect: "follow",
    });
    clearTimeout(timeoutId);

    const contentType = response.headers.get("content-type");
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > maxBytes) {
      return {
        url,
        statusCode: response.status,
        contentType,
        content: `[Response too large: ${contentLength} bytes; max ${maxBytes}]`,
        truncated: true,
      };
    }

    const buf = await response.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      return {
        url,
        statusCode: response.status,
        contentType,
        content: `[Response truncated: ${buf.byteLength} bytes; max ${maxBytes}]`,
        truncated: true,
      };
    }

    if (!isTextContentType(contentType)) {
      return {
        url,
        statusCode: response.status,
        contentType,
        content: `[Binary or non-text response; contentType=${contentType ?? "unknown"}]`,
      };
    }

    const decoder = new TextDecoder("utf-8", { fatal: false });
    const content = decoder.decode(buf);
    return {
      url,
      statusCode: response.status,
      contentType,
      content,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error) {
      if (err.name === "AbortError") {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw err;
    }
    throw err;
  }
}
