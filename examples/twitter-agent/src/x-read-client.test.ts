import { describe, it, expect } from 'vitest';
import { XReadClient, type TokenProvider } from './x-read-client.js';
import { XAuthError } from './x-oauth.js';

// ── Test doubles ─────────────────────────────────────────────────────

/** Token provider that records how many times a forced refresh was requested. */
function fakeTokens(): TokenProvider & { forceCount: number; calls: number } {
  return {
    forceCount: 0,
    calls: 0,
    async getValidToken(opts) {
      this.calls++;
      if (opts?.forceRefresh) this.forceCount++;
      return this.forceCount > 0 ? 'token-refreshed' : 'token-1';
    },
  };
}

interface Queued {
  status?: number;
  json?: unknown;
  body?: string;
}
function fakeFetch(responses: Queued[]) {
  const calls: Array<{ url: string; authorization?: string }> = [];
  let i = 0;
  const fn = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(input), authorization: headers.Authorization });
    const next = responses[i++];
    if (!next) throw new Error('fakeFetch: no queued response');
    const status = next.status ?? 200;
    const payload = next.body ?? JSON.stringify(next.json ?? {});
    return new Response(payload, { status });
  };
  return { fn, calls };
}

const ME = { json: { data: { id: 'u-me', username: 'me', name: 'Me' } } };

function bookmarksPage() {
  return {
    json: {
      data: [
        {
          id: 't1',
          text: 'first bookmark',
          created_at: '2026-06-01T00:00:00.000Z',
          author_id: 'a1',
          public_metrics: { like_count: 10, retweet_count: 2, reply_count: 1, quote_count: 0 },
        },
        {
          id: 't2',
          text: 'second bookmark',
          author_id: 'a2',
          public_metrics: { like_count: 5 },
        },
      ],
      includes: {
        users: [
          { id: 'a1', username: 'alice', name: 'Alice' },
          { id: 'a2', username: 'bob', name: 'Bob' },
        ],
      },
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('XReadClient.getBookmarks', () => {
  it('returns shaped bookmarks with author, metrics, and permalink', async () => {
    const tokens = fakeTokens();
    const { fn, calls } = fakeFetch([ME, bookmarksPage()]);
    const client = new XReadClient(tokens, { fetchFn: fn });

    const bookmarks = await client.getBookmarks({ maxResults: 20 });

    expect(bookmarks).toHaveLength(2);
    expect(bookmarks[0]).toMatchObject({
      id: 't1',
      text: 'first bookmark',
      createdAt: '2026-06-01T00:00:00.000Z',
      author: { id: 'a1', username: 'alice', name: 'Alice' },
      metrics: { likes: 10, retweets: 2, replies: 1, quotes: 0 },
      url: 'https://x.com/alice/status/t1',
    });
    // Missing metric fields default to 0.
    expect(bookmarks[1].metrics).toEqual({ likes: 5, retweets: 0, replies: 0, quotes: 0 });
    // Sends a bearer token on each request.
    expect(calls[0].authorization).toBe('Bearer token-1');
  });

  it('requests the authenticated user id, then that user\'s bookmarks', async () => {
    const tokens = fakeTokens();
    const { fn, calls } = fakeFetch([ME, bookmarksPage()]);
    const client = new XReadClient(tokens, { fetchFn: fn });

    await client.getBookmarks();

    expect(calls[0].url).toContain('/users/me');
    expect(calls[1].url).toContain('/users/u-me/bookmarks');
    expect(calls[1].url).toContain('expansions=author_id');
  });

  it('caps max_results at 100 and floors it at 1', async () => {
    const tokens = fakeTokens();
    const { fn, calls } = fakeFetch([ME, bookmarksPage()]);
    const client = new XReadClient(tokens, { fetchFn: fn });

    await client.getBookmarks({ maxResults: 9999 });
    expect(calls[1].url).toContain('max_results=100');
  });

  it('force-refreshes the token and retries once on a 401', async () => {
    const tokens = fakeTokens();
    // me OK, then bookmarks 401, then bookmarks OK after refresh.
    const { fn, calls } = fakeFetch([ME, { status: 401, body: 'unauthorized' }, bookmarksPage()]);
    const client = new XReadClient(tokens, { fetchFn: fn });

    const bookmarks = await client.getBookmarks();

    expect(bookmarks).toHaveLength(2);
    expect(tokens.forceCount).toBe(1); // exactly one forced refresh
    expect(calls).toHaveLength(3); // me, 401, retry
    expect(calls[2].authorization).toBe('Bearer token-refreshed'); // retry uses the new token
  });

  it('throws when a non-401 error persists', async () => {
    const tokens = fakeTokens();
    const { fn } = fakeFetch([ME, { status: 503, body: 'upstream' }]);
    const client = new XReadClient(tokens, { fetchFn: fn });

    await expect(client.getBookmarks()).rejects.toThrow(/503/);
  });

  it('caches the authenticated user across calls', async () => {
    const tokens = fakeTokens();
    const { fn, calls } = fakeFetch([ME, bookmarksPage(), bookmarksPage()]);
    const client = new XReadClient(tokens, { fetchFn: fn });

    await client.getBookmarks();
    await client.getBookmarks();

    // /users/me fetched once; two bookmark fetches.
    expect(calls.filter((c) => c.url.includes('/users/me'))).toHaveLength(1);
  });
});

// A generic timeline page (same envelope as bookmarks) reused by mentions + home timeline.
function timelinePage() {
  return {
    json: {
      data: [
        {
          id: 'm1',
          text: '@me nice work',
          created_at: '2026-06-10T00:00:00.000Z',
          author_id: 'a1',
          public_metrics: { like_count: 3, retweet_count: 1, reply_count: 0, quote_count: 0 },
        },
      ],
      includes: { users: [{ id: 'a1', username: 'alice', name: 'Alice' }] },
    },
  };
}

describe('XReadClient.getMentions', () => {
  it('returns shaped mentions with author, metrics, and permalink', async () => {
    const tokens = fakeTokens();
    const { fn } = fakeFetch([ME, timelinePage()]);
    const client = new XReadClient(tokens, { fetchFn: fn });

    const mentions = await client.getMentions();

    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({
      id: 'm1',
      text: '@me nice work',
      author: { id: 'a1', username: 'alice', name: 'Alice' },
      metrics: { likes: 3, retweets: 1, replies: 0, quotes: 0 },
      url: 'https://x.com/alice/status/m1',
    });
  });

  it("requests the authenticated user's mentions timeline", async () => {
    const tokens = fakeTokens();
    const { fn, calls } = fakeFetch([ME, timelinePage()]);
    const client = new XReadClient(tokens, { fetchFn: fn });

    await client.getMentions();

    expect(calls[0].url).toContain('/users/me');
    expect(calls[1].url).toContain('/users/u-me/mentions');
    expect(calls[1].url).toContain('expansions=author_id');
  });

  it('floors max_results at 5 (the X minimum for mentions) and caps at 100', async () => {
    const tokens = fakeTokens();
    const { fn, calls } = fakeFetch([ME, timelinePage(), timelinePage()]);
    const client = new XReadClient(tokens, { fetchFn: fn });

    await client.getMentions({ maxResults: 2 });
    expect(calls[1].url).toContain('max_results=5');

    await client.getMentions({ maxResults: 9999 });
    expect(calls[2].url).toContain('max_results=100');
  });

  it('force-refreshes the token and retries once on a 401', async () => {
    const tokens = fakeTokens();
    const { fn, calls } = fakeFetch([ME, { status: 401, body: 'unauthorized' }, timelinePage()]);
    const client = new XReadClient(tokens, { fetchFn: fn });

    const mentions = await client.getMentions();

    expect(mentions).toHaveLength(1);
    expect(tokens.forceCount).toBe(1);
    expect(calls[2].authorization).toBe('Bearer token-refreshed');
  });
});

describe('XReadClient.getHomeTimeline', () => {
  it('returns shaped timeline posts', async () => {
    const tokens = fakeTokens();
    const { fn } = fakeFetch([ME, timelinePage()]);
    const client = new XReadClient(tokens, { fetchFn: fn });

    const posts = await client.getHomeTimeline();

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id: 'm1', author: { username: 'alice' } });
  });

  it("requests the authenticated user's reverse_chronological timeline by their own id", async () => {
    const tokens = fakeTokens();
    const { fn, calls } = fakeFetch([ME, timelinePage()]);
    const client = new XReadClient(tokens, { fetchFn: fn });

    await client.getHomeTimeline({ maxResults: 50 });

    expect(calls[1].url).toContain('/users/u-me/timelines/reverse_chronological');
    expect(calls[1].url).toContain('max_results=50');
  });
});

describe('XReadClient 403 handling', () => {
  it('raises a non-retryable needs_reauth error on 403 (no force-refresh, no retry)', async () => {
    const tokens = fakeTokens();
    // me OK, then a 403 from the home timeline (missing follows.read / not enrolled).
    const { fn, calls } = fakeFetch([
      ME,
      { status: 403, body: '{"detail":"client-not-enrolled"}' },
    ]);
    const client = new XReadClient(tokens, { fetchFn: fn });

    await expect(client.getHomeTimeline()).rejects.toMatchObject({
      name: 'XAuthError',
      kind: 'needs_reauth',
      status: 403,
    });
    // A 403 must NOT trigger a forced refresh or a retry.
    expect(tokens.forceCount).toBe(0);
    expect(calls).toHaveLength(2); // me + the 403, nothing after
  });

  it('surfaces the X reason text in the error', async () => {
    const tokens = fakeTokens();
    // ME (cached after the first call), then a 403 for each of the two getMentions calls.
    const { fn } = fakeFetch([
      ME,
      { status: 403, body: 'client-not-enrolled' },
      { status: 403, body: 'client-not-enrolled' },
    ]);
    const client = new XReadClient(tokens, { fetchFn: fn });

    await expect(client.getMentions()).rejects.toThrow(/client-not-enrolled/);
    await expect(client.getMentions()).rejects.toBeInstanceOf(XAuthError);
  });
});
