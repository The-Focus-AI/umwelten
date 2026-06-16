import { describe, it, expect } from 'vitest';
import { XReadClient, type TokenProvider } from './x-read-client.js';

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
