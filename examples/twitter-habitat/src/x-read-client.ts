/**
 * X (Twitter) API v2 read client — the private-data path for the Twitter habitat.
 *
 * Thin, token-agnostic wrapper over the official X API v2 read endpoints. It takes
 * a {@link TokenProvider} (the {@link XTokenStore} from token-store.ts) and returns
 * shaped data; the Agent tools that consume it embed no HTTP or auth logic.
 *
 * This slice (#151) implements only the **bookmarks** call. Later slices (#152)
 * extend the same client with mentions + my-timeline.
 *
 * Reactive 401 handling, per reports/2026-06-16-x-oauth2-token-refresh.md: a 401
 * from a resource call means the access token went stale before its clock expiry,
 * so we force a refresh and retry the request exactly once.
 */

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

/** A bookmarked tweet, shaped for the agent. */
export interface XBookmark {
  id: string;
  text: string;
  createdAt?: string;
  author?: XUser;
  metrics: { likes: number; retweets: number; replies: number; quotes: number };
  /** Permalink, when the author handle is known. */
  url?: string;
}

export interface XReadClientOptions {
  fetchFn?: FetchLike;
  /** Override the API base (defaults to the canonical api.x.com host). */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api.x.com/2';

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

  /** GET a JSON resource with a bearer token; on 401, force-refresh and retry once. */
  private async authedGetJson(path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    let token = await this.tokens.getValidToken();
    let res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });

    if (res.status === 401) {
      token = await this.tokens.getValidToken({ forceRefresh: true });
      res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`X read failed: ${res.status} ${body.slice(0, 200)}`);
    }
    return res.json();
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
  async getBookmarks(opts: { maxResults?: number } = {}): Promise<XBookmark[]> {
    const max = Math.min(Math.max(opts.maxResults ?? 20, 1), 100);
    const me = await this.getMe();
    const params = new URLSearchParams({
      max_results: String(max),
      'tweet.fields': 'created_at,public_metrics,author_id',
      expansions: 'author_id',
      'user.fields': 'username,name',
    });
    const body = (await this.authedGetJson(
      `/users/${me.id}/bookmarks?${params.toString()}`,
    )) as { data?: RawTweet[]; includes?: { users?: RawUser[] } };

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
}
