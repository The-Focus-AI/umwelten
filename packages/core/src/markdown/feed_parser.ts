/**
 * Fetch a URL and parse as XML. Normalize RSS 2.0 and Atom feeds to a common structure.
 * Generic XML is returned as a simplified JSON representation.
 */

import { XMLParser } from "fast-xml-parser";
import { fetchUrl } from "./fetch_url.js";

const DEFAULT_ITEM_LIMIT = 50;

export interface FeedItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
}

export interface ParsedFeed {
  url: string;
  format: "rss" | "atom" | "xml";
  feed: {
    title: string;
    link: string;
    description?: string;
  };
  items: FeedItem[];
  itemCount: number;
  truncated?: boolean;
}

function text(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val.trim();
  if (typeof val === "object" && val !== null && "#text" in val) {
    const t = (val as { "#text"?: string })["#text"];
    return typeof t === "string" ? t.trim() : "";
  }
  return String(val).trim();
}

function first<T>(x: T | T[]): T {
  return Array.isArray(x) ? x[0] : x;
}

function ensureArray<T>(x: T | T[]): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function linkFromAtom(link: unknown): string {
  if (link == null) return "";
  const arr = ensureArray(link);
  const relSelf = arr.find((l: unknown) => {
    const o = l as Record<string, unknown>;
    return (o["@_rel"] === "self" || o["@_rel"] == null) && o["@_href"];
  });
  const firstHref = arr.find((l: unknown) => (l as Record<string, unknown>)["@_href"]);
  const node = relSelf ?? firstHref ?? arr[0];
  if (node && typeof node === "object" && node !== null && "@_href" in node) {
    const h = (node as { "@_href"?: string })["@_href"];
    return typeof h === "string" ? h : "";
  }
  return "";
}

function linkFromRss(val: unknown): string {
  return text(val);
}

function extractRss(result: FetchResult, limit: number): ParsedFeed {
  const rss = result.parsed?.rss as Record<string, unknown> | undefined;
  const ch = rss?.channel as Record<string, unknown> | undefined;
  if (!ch) {
    throw new Error("Invalid RSS: missing rss.channel");
  }
  const rawItems = ensureArray(ch.item ?? []) as Record<string, unknown>[];
  const items = rawItems.slice(0, limit).map((it) => {
    const atomLink = it["atom:link"] as { "@_href"?: string } | undefined;
    return {
      title: text(it.title ?? it["dc:title"]),
      link: linkFromRss(it.link ?? it.guid ?? atomLink?.["@_href"]),
      description: text(it.description ?? it["content:encoded"] ?? it["dc:description"] ?? it.summary),
      pubDate: text(it.pubDate ?? it["dc:date"] ?? it.updated ?? it.published),
    };
  });
  const chAtomLink = ch["atom:link"] as { "@_href"?: string } | undefined;
  const link = linkFromRss(ch.link ?? chAtomLink?.["@_href"]);
  return {
    url: result.url,
    format: "rss",
    feed: {
      title: text(ch.title),
      link: link || result.url,
      description: text(ch.description),
    },
    items,
    itemCount: rawItems.length,
    truncated: rawItems.length > limit,
  };
}

function extractAtom(result: FetchResult, limit: number): ParsedFeed {
  const f = result.parsed?.feed as Record<string, unknown> | undefined;
  if (!f) {
    throw new Error("Invalid Atom: missing feed");
  }
  const rawEntries = ensureArray(f.entry ?? []) as Record<string, unknown>[];
  const items = rawEntries.slice(0, limit).map((e) => {
    const linkNode = first(e.link);
    const href =
      linkNode && typeof linkNode === "object" && linkNode !== null && "@_href" in linkNode
        ? String((linkNode as { "@_href"?: string })["@_href"] ?? "")
        : "";
    const content = text(e.content ?? e["content:encoded"] ?? e.summary ?? e["atom:summary"]);
    return {
      title: text(e.title ?? e["atom:title"]),
      link: href,
      description: content || undefined,
      pubDate: text(e.updated ?? e.published ?? e["dc:date"] ?? e.pubDate),
    };
  });
  const feedLink = linkFromAtom(f.link) || result.url;
  return {
    url: result.url,
    format: "atom",
    feed: {
      title: text(f.title ?? f["atom:title"]),
      link: feedLink,
      description: text(f.subtitle ?? f["atom:subtitle"] ?? f.description),
    },
    items,
    itemCount: rawEntries.length,
    truncated: rawEntries.length > limit,
  };
}

interface FetchResult {
  url: string;
  content: string;
  parsed: Record<string, unknown>;
}

export interface ParseFeedOptions {
  limit?: number;
}

/**
 * Fetch a URL and parse as XML. If RSS 2.0 or Atom, returns normalized feed + items.
 * Otherwise returns a generic XML structure (simplified).
 */
export async function parseFeed(
  url: string,
  options: ParseFeedOptions = {}
): Promise<ParsedFeed> {
  const limit = Math.max(1, options.limit ?? DEFAULT_ITEM_LIMIT);
  const fetched = await fetchUrl(url);
  if (fetched.statusCode !== 200) {
    throw new Error(`HTTP ${fetched.statusCode} for ${url}`);
  }
  const ct = (fetched.contentType ?? "").toLowerCase();
  if (
    !ct.includes("xml") &&
    !ct.includes("rss") &&
    !ct.includes("atom")
  ) {
    throw new Error(
      `URL did not return XML/RSS/Atom (content-type: ${fetched.contentType ?? "unknown"}). Use wget for raw content.`
    );
  }
  if (fetched.truncated) {
    throw new Error(`Feed too large: response was truncated.`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    isArray: (name) => ["item", "entry", "link"].includes(name),
  });
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(fetched.content) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid XML: ${msg}`);
  }

  const result: FetchResult = { url: fetched.url, content: fetched.content, parsed };

  const rss = parsed?.rss as Record<string, unknown> | undefined;
  const feed = parsed?.feed as Record<string, unknown> | undefined;
  if (rss?.channel) {
    return extractRss(result, limit);
  }
  if (feed && typeof feed === "object") {
    return extractAtom(result, limit);
  }

  // Generic XML: return a minimal structure
  const root = Object.keys(parsed)[0];
  const rootVal = root ? parsed[root] : null;
  const items: FeedItem[] = [];
  if (rootVal && typeof rootVal === "object" && rootVal !== null) {
    const r = rootVal as Record<string, unknown>;
    for (const key of ["item", "entry", "Item", "Entry"]) {
      const arr = ensureArray(r[key] ?? []);
      for (const n of arr.slice(0, limit)) {
        const o = (n as Record<string, unknown>) ?? {};
        items.push({
          title: text(o.title ?? o.Name ?? o.name),
          link: text(o.link ?? o.Link ?? o.url ?? o.guid),
          description: text(o.description ?? o.Description ?? o.summary ?? o.content),
          pubDate: text(o.pubDate ?? o.PubDate ?? o.date ?? o.updated ?? o.published),
        });
      }
      if (items.length > 0) break;
    }
  }

  return {
    url: fetched.url,
    format: "xml",
    feed: {
      title: root ?? "XML",
      link: url,
      description: undefined,
    },
    items,
    itemCount: items.length,
  };
}
