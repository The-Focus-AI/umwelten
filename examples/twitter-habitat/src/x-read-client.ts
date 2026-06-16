/**
 * X (Twitter) API v2 read client — the private-data path for the Twitter habitat.
 *
 * Thin, token-agnostic wrapper over the official X API v2 read endpoints. It takes
 * a {@link TokenProvider} (the {@link XTokenStore} from token-store.ts) and returns
 * shaped data; the Agent tools that consume it embed no HTTP or auth logic.
 *
 * Endpoints (all GET, user-context bearer token):
 *  - #151: bookmarks       — `/users/:id/bookmarks`
 *  - #152: mentions        — `/users/:id/mentions`                       ("who replied to me")
 *  - #152: home timeline   — `/users/:id/timelines/reverse_chronological` (people you follow)
 *
 * All three return the same envelope (`data[]` + `includes.users[]`), so the tweet
 * shaping is shared in one private {@link XReadClient.shapeTweets} helper.
 *
 * Auth error handling, per reports/2026-06-16-x-oauth2-token-refresh.md and
 * reports/2026-06-16-x-api-v2-mentions-timeline.md:
 *  - **401**: the access token went stale before its clock expiry → force a refresh
 *    and retry the request exactly once.
 *  - **403**: a permission/tier problem (app not enrolled in a paid tier, or the
 *    stored token is missing a scope such as `follows.read`, which the home timeline
 *    requires). A refresh CANNOT fix this, so we do not retry — we raise a
 *    non-retryable {@link XAuthError} of kind `needs_reauth` that the tool surfaces.
 */

import { XAuthError } from './x-oauth.js';

/** Anything that can hand out a valid X access token — implemented by XTokenStore. */
export interface TokenProvider {
  getValidToken(opts?: { forceRefresh?: boolean }): Promise<string>;
}

/** Minimal `fetch` shape so callers can inject a fake in tests. */
export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

/** The authenticated user, from GET /2/users/me. */
export interface XUser {
  id: string;
  username?: string;
  name?: string;
}

/**
 * A tweet shaped for the agent — a bookmark, a mention, or a home-timeline post.
 * The shape is endpoint-agnostic; the three read methods all return it.
 */
export interface XTweet {
  id: string;
  text: string;
  createdAt?: string;
  author?: XUser;
  metrics: { likes: number; retweets: number; replies: number; quotes: number };
  /** Permalink, when the author handle is known. */
  url?: string;
}

/** @deprecated Use {@link XTweet}. Kept as an alias so existing imports keep working. */
export type XBookmark = XTweet;

export interface XReadClientOptions {
  fetchFn?: FetchLike;
  /** Override the API base (defaults to the canonical api.x.com host). */
  baseUrl?: string;
}

/** Options shared by every paged read. */
export interface XReadOptions {
  /** Page size. Clamped per-endpoint (mentions floors at 5; others at 1). */
  maxResults?: number;
}

const DEFAULT_BASE_URL = 'https://api.x.com/2';
const DEFAULT_PAGE = 20;

// X public_metrics → our flat shape.
interface PublicMetrics {
  like_count?: number;
  retweet_count?: number;
  reply_count?: number;
  quote_count?: number;
}
interface RawTweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: PublicMetrics;
}
interface RawUser {
  id: string;
  username?: string;
  name?: string;
}
/** The common timeline envelope shared by bookmarks, mentions, and the home timeline. */
interface TimelineBody {
  data?: RawTweet[];
  includes?: { users?: RawUser[] };
}

/** Tweet fields + expansions every read requests — identical across the three endpoints. */
const TWEET_QUERY = {
  'tweet.fields': 'created_at,public_metrics,author_id',
  expansions: 'author_id',
  'user.fields': 'username,name',
} as const;

export class XReadClient {
  private readonly tokens: TokenProvider;
  private readonly fetchFn: FetchLike;
  private readonly baseUrl: string;
  private me: XUser | undefined;

  constructor(tokens: TokenProvider, opts: XReadClientOptions = {}) {
    this.tokens = tokens;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  }

  /**
   * GET a JSON resource with a bearer token. On 401, force-refresh the token and
   * retry once. On 403, raise a non-retryable needs-reauth error (refresh can't help).
   */
  private async authedGetJson(path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    let token = await this.tokens.getValidToken();
    let res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });

    if (res.status === 401) {
      token = await this.tokens.getValidToken({ forceRefresh: true });
      res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
    }

    // 403 is a permission/tier problem, not a stale token — refreshing won't fix it.
    // Most common causes: the X app isn't enrolled in a paid tier, or the stored
    // token lacks a required scope (the home timeline needs `follows.read`).
    if (res.status === 403) {
      const body = await res.text().catch(() => '');
      throw new XAuthError(
        `X denied this read (403). The X app likely needs Basic+/pay-per-use enrollment, ` +
          `or the stored token is missing a required scope (the home timeline needs ` +
          `follows.read) — re-run the OAuth bootstrap to re-authorize. ${body.slice(0, 200)}`,
        'needs_reauth',
        403,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`X read failed: ${res.status} ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  /** Map an X timeline envelope into our flat {@link XTweet}s (shared by all reads). */
  private shapeTweets(body: TimelineBody): XTweet[] {
    const usersById = new Map<string, RawUser>();
    for (const u of body.includes?.users ?? []) usersById.set(u.id, u);

    return (body.data ?? []).map((t) => {
      const author = t.author_id ? usersById.get(t.author_id) : undefined;
      const m = t.public_metrics ?? {};
      return {
        id: t.id,
        text: t.text,
        createdAt: t.created_at,
        author: author
          ? { id: author.id, username: author.username, name: author.name }
          : t.author_id
            ? { id: t.author_id }
            : undefined,
        metrics: {
          likes: m.like_count ?? 0,
          retweets: m.retweet_count ?? 0,
          replies: m.reply_count ?? 0,
          quotes: m.quote_count ?? 0,
        },
        url: author?.username ? `https://x.com/${author.username}/status/${t.id}` : undefined,
      };
    });
  }

  /** The authenticated user (cached after the first call). */
  async getMe(): Promise<XUser> {
    if (this.me) return this.me;
    const data = (await this.authedGetJson('/users/me?user.fields=username,name')) as {
      data?: RawUser;
    };
    if (!data.data?.id) throw new Error('X /users/me returned no user');
    this.me = { id: data.data.id, username: data.data.username, name: data.data.name };
    return this.me;
  }

  /**
   * The authenticated user's bookmarks, most-recent first, shaped for the agent.
   * @param opts.maxResults 1–100 (X caps the page at 100); defaults to 20.
   */
  async getBookmarks(opts: XReadOptions = {}): Promise<XTweet[]> {
    const max = clamp(opts.maxResults ?? DEFAULT_PAGE, 1, 100);
    const me = await this.getMe();
    const params = new URLSearchParams({ max_results: String(max), ...TWEET_QUERY });
    const body = (await this.authedGetJson(
      `/users/${me.id}/bookmarks?${params.toString()}`,
    )) as TimelineBody;
    return this.shapeTweets(body);
  }

  /**
   * Recent tweets that mention/reply to the authenticated user, most-recent first.
   * Answers "who replied to me?". Reads `/users/:id/mentions`.
   * @param opts.maxResults 5–100 (X requires a minimum of 5 here); defaults to 20.
   */
  async getMentions(opts: XReadOptions = {}): Promise<XTweet[]> {
    // NOTE: mentions floors max_results at 5 (not 1) — a smaller value 400s.
    const max = clamp(opts.maxResults ?? DEFAULT_PAGE, 5, 100);
    const me = await this.getMe();
    const params = new URLSearchParams({ max_results: String(max), ...TWEET_QUERY });
    const body = (await this.authedGetJson(
      `/users/${me.id}/mentions?${params.toString()}`,
    )) as TimelineBody;
    return this.shapeTweets(body);
  }

  /**
   * The authenticated user's reverse-chronological home timeline — recent posts,
   * retweets, and replies from the accounts they follow. Reads
   * `/users/:id/timelines/reverse_chronological`, which is user-context only and
   * REQUIRES `:id` to be the authenticated user's own id (always `me.id`) plus the
   * `follows.read` scope.
   * @param opts.maxResults 1–100; defaults to 20.
   */
  async getHomeTimeline(opts: XReadOptions = {}): Promise<XTweet[]> {
    const max = clamp(opts.maxResults ?? DEFAULT_PAGE, 1, 100);
    const me = await this.getMe(); // id MUST be the authenticated user — always me.id
    const params = new URLSearchParams({ max_results: String(max), ...TWEET_QUERY });
    const body = (await this.authedGetJson(
      `/users/${me.id}/timelines/reverse_chronological?${params.toString()}`,
    )) as TimelineBody;
    return this.shapeTweets(body);
  }
}

/** Clamp n into [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
