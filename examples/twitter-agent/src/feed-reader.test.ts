import { describe, it, expect } from 'vitest';
import {
  FeedReader,
  normalizeHandle,
  type QueryExecutor,
} from './feed-reader.js';

/**
 * Tests drive the FeedReader through a seeded in-memory fixture that interprets
 * the small, known set of queries the module issues — so ranking, windowing,
 * handle-normalization and graceful degradation are asserted as *observable
 * behavior* (the returned data), never as internal call sequencing. No real
 * database. This is the "seeded fixture" path from issue #153's acceptance
 * criteria.
 */

interface TweetFixture {
  tweet_id: string;
  username: string;
  display_name?: string;
  text: string;
  created_at: string;
  like_count: number;
  retweet_count: number;
  reply_count: number;
  quote_count?: number;
  impression_count?: number;
}
interface ListFixture {
  id: string; // surrogate twitter_lists.id
  file_id: string;
  name: string;
  description?: string;
  member_count?: number;
}
interface MemberFixture {
  list_id: string; // surrogate id
  username: string;
  display_name?: string;
}
interface SummaryFixture {
  list_id: string; // file_id slug
  report_date: string;
  report_type: string;
  title?: string;
  content: string;
  generated_at?: string;
}
interface Dataset {
  tweets?: TweetFixture[];
  profiles?: Record<string, string>;
  lists?: ListFixture[];
  members?: MemberFixture[];
  summaries?: SummaryFixture[];
}

function eng(t: TweetFixture): number {
  return t.like_count + t.retweet_count + t.reply_count;
}

/** A fixture executor: a tiny interpreter for the queries FeedReader emits. */
function makeFixtureExecutor(ds: Dataset) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const nowMs = Date.now();

  const exec: QueryExecutor = async <T>(text: string, params: unknown[] = []) => {
    calls.push({ text, params });

    if (/FROM cached_tweets/.test(text)) {
      let rows = (ds.tweets ?? []).slice();

      if (/t\.username = \$1/.test(text)) {
        rows = rows.filter((t) => t.username === params[0]);
      }
      const anyMatch = /t\.username = ANY\(\$(\d+)\)/.exec(text);
      if (anyMatch) {
        const arr = params[Number(anyMatch[1]) - 1] as string[];
        rows = rows.filter((t) => arr.includes(t.username));
      }
      const sinceMatch = /make_interval\(hours => \$(\d+)\)/.exec(text);
      if (sinceMatch) {
        const hours = params[Number(sinceMatch[1]) - 1] as number;
        const cutoff = nowMs - hours * 3600 * 1000;
        rows = rows.filter((t) => new Date(t.created_at).getTime() >= cutoff);
      }

      if (/ORDER BY \(t\.like_count/.test(text)) {
        rows.sort(
          (a, b) =>
            eng(b) - eng(a) ||
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
      } else {
        rows.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
      }

      const limit = params[params.length - 1] as number;
      return rows.slice(0, limit).map((t) => ({
        ...t,
        display_name: t.display_name ?? ds.profiles?.[t.username],
      })) as T[];
    }

    if (/FROM twitter_lists/.test(text)) {
      const key = String(params[0]);
      const l = (ds.lists ?? []).find(
        (x) => x.file_id === key || x.name.toLowerCase() === key.toLowerCase(),
      );
      return (l ? [l] : []) as T[];
    }

    if (/FROM twitter_list_members/.test(text)) {
      const sid = params[0];
      return (ds.members ?? [])
        .filter((m) => m.list_id === sid)
        .map((m) => ({ username: m.username, display_name: m.display_name }))
        .sort((a, b) => (a.username < b.username ? -1 : 1)) as T[];
    }

    if (/FROM summaries/.test(text)) {
      const fid = params[0];
      const ss = (ds.summaries ?? [])
        .filter((s) => s.list_id === fid)
        .sort((a, b) => (b.report_date > a.report_date ? 1 : -1));
      return ss.slice(0, 1) as T[];
    }

    return [] as T[];
  };

  return { exec, calls };
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

describe('normalizeHandle', () => {
  it('strips @, lowercases, trims', () => {
    expect(normalizeHandle('@Elon')).toBe('elon');
    expect(normalizeHandle('  @@PaulG  ')).toBe('paulg');
    expect(normalizeHandle('karpathy')).toBe('karpathy');
  });
});

describe('FeedReader.getPersonRecent', () => {
  const ds: Dataset = {
    profiles: { karpathy: 'Andrej Karpathy' },
    tweets: [
      { tweet_id: '1', username: 'karpathy', text: 'old', created_at: hoursAgo(100), like_count: 5, retweet_count: 1, reply_count: 0 },
      { tweet_id: '2', username: 'karpathy', text: 'new', created_at: hoursAgo(1), like_count: 9, retweet_count: 2, reply_count: 3, quote_count: 4, impression_count: 1000 },
      { tweet_id: '3', username: 'someoneelse', text: 'noise', created_at: hoursAgo(2), like_count: 99, retweet_count: 99, reply_count: 99 },
    ],
  };

  it('normalizes the handle and returns only that person, most-recent first', async () => {
    const { exec, calls } = makeFixtureExecutor(ds);
    const reader = new FeedReader(exec);
    const out = await reader.getPersonRecent('@Karpathy');

    expect(out.map((t) => t.id)).toEqual(['2', '1']); // recency order, no 'someoneelse'
    expect(calls[0].params[0]).toBe('karpathy'); // normalized handle hit the boundary
  });

  it('maps engagement, metrics, display name, url and ISO timestamp', async () => {
    const { exec } = makeFixtureExecutor(ds);
    const reader = new FeedReader(exec);
    const [newest] = await reader.getPersonRecent('karpathy');

    expect(newest.id).toBe('2');
    expect(newest.displayName).toBe('Andrej Karpathy');
    expect(newest.engagement).toMatchObject({ likes: 9, retweets: 2, replies: 3, quotes: 4, impressions: 1000, total: 14 });
    expect(newest.url).toBe('https://x.com/karpathy/status/2');
    expect(newest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('clamps the limit (max 100) and passes it as the last param', async () => {
    const { exec, calls } = makeFixtureExecutor(ds);
    const reader = new FeedReader(exec);
    await reader.getPersonRecent('karpathy', { limit: 9999 });
    expect(calls[0].params[calls[0].params.length - 1]).toBe(100);

    const { exec: exec2, calls: calls2 } = makeFixtureExecutor(ds);
    await new FeedReader(exec2).getPersonRecent('karpathy', { limit: 0 });
    expect(calls2[0].params[calls2[0].params.length - 1]).toBe(1);

    const { exec: exec3, calls: calls3 } = makeFixtureExecutor(ds);
    await new FeedReader(exec3).getPersonRecent('karpathy');
    expect(calls3[0].params[calls3[0].params.length - 1]).toBe(20); // default
  });

  it('applies a sinceHours window when set', async () => {
    const { exec } = makeFixtureExecutor(ds);
    const reader = new FeedReader(exec);
    const out = await reader.getPersonRecent('karpathy', { sinceHours: 24 });
    expect(out.map((t) => t.id)).toEqual(['2']); // tweet '1' (100h old) excluded
  });
});

describe('FeedReader.getHighEngagement', () => {
  const ds: Dataset = {
    tweets: [
      { tweet_id: 'a', username: 'u1', text: 'meh', created_at: hoursAgo(2), like_count: 1, retweet_count: 1, reply_count: 1 }, // 3
      { tweet_id: 'b', username: 'u2', text: 'viral', created_at: hoursAgo(3), like_count: 100, retweet_count: 50, reply_count: 10 }, // 160
      { tweet_id: 'c', username: 'u1', text: 'mid', created_at: hoursAgo(1), like_count: 20, retweet_count: 5, reply_count: 5 }, // 30
      { tweet_id: 'd', username: 'u3', text: 'stale-viral', created_at: hoursAgo(200), like_count: 999, retweet_count: 999, reply_count: 999 },
    ],
  };

  it('ranks by engagement (likes + retweets + replies) descending', async () => {
    const { exec } = makeFixtureExecutor(ds);
    const out = await new FeedReader(exec).getHighEngagement({ limit: 3, sinceHours: 48 });
    expect(out.map((t) => t.id)).toEqual(['b', 'c', 'a']); // 160, 30, 3 — stale 'd' excluded by window
    expect(out[0].engagement.total).toBe(160);
  });

  it('scopes to the given usernames when set', async () => {
    const { exec } = makeFixtureExecutor(ds);
    const out = await new FeedReader(exec).getHighEngagement({ usernames: ['@U1'], sinceHours: 48 });
    expect(out.map((t) => t.id)).toEqual(['c', 'a']); // only u1, ranked by engagement
  });

  it('delegates engagement ordering to SQL', async () => {
    const { exec, calls } = makeFixtureExecutor(ds);
    await new FeedReader(exec).getHighEngagement({});
    expect(calls[0].text).toMatch(/ORDER BY \(t\.like_count \+ t\.retweet_count \+ t\.reply_count\) DESC/);
  });
});

describe('FeedReader.getListDigest', () => {
  const ds: Dataset = {
    lists: [{ id: 'srg-1', file_id: 'ai-engineers', name: 'AI Engineers', member_count: 2 }],
    members: [
      { list_id: 'srg-1', username: 'karpathy', display_name: 'Andrej Karpathy' },
      { list_id: 'srg-1', username: 'swyx' },
    ],
    summaries: [
      { list_id: 'ai-engineers', report_date: '2026-06-15', report_type: 'evening', title: 'Older', content: '# Older' },
      { list_id: 'ai-engineers', report_date: '2026-06-16', report_type: 'morning', title: 'Latest digest', content: '# Latest digest\n...' },
    ],
    tweets: [
      { tweet_id: 't1', username: 'karpathy', text: 'big', created_at: hoursAgo(1), like_count: 100, retweet_count: 10, reply_count: 5 }, // 115
      { tweet_id: 't2', username: 'swyx', text: 'small', created_at: hoursAgo(2), like_count: 3, retweet_count: 0, reply_count: 0 }, // 3
      { tweet_id: 't3', username: 'outsider', text: 'not in list', created_at: hoursAgo(1), like_count: 9999, retweet_count: 0, reply_count: 0 },
    ],
  };

  it('assembles list, members, latest summary, and member top-tweets ranked by engagement', async () => {
    const { exec } = makeFixtureExecutor(ds);
    const digest = await new FeedReader(exec).getListDigest('ai-engineers');

    expect(digest.found).toBe(true);
    expect(digest.list?.name).toBe('AI Engineers');
    expect(digest.members.map((m) => m.username)).toEqual(['karpathy', 'swyx']);
    expect(digest.summary?.title).toBe('Latest digest'); // most-recent report_date wins
    expect(digest.topTweets.map((t) => t.id)).toEqual(['t1', 't2']); // member tweets only, ranked; 'outsider' excluded
  });

  it('resolves a list by name (case-insensitive)', async () => {
    const { exec } = makeFixtureExecutor(ds);
    const digest = await new FeedReader(exec).getListDigest('ai engineers');
    expect(digest.found).toBe(true);
    expect(digest.list?.fileId).toBe('ai-engineers');
  });

  it('degrades gracefully for an unknown list — no member/summary/tweet queries issued', async () => {
    const { exec, calls } = makeFixtureExecutor(ds);
    const digest = await new FeedReader(exec).getListDigest('does-not-exist');

    expect(digest).toEqual({ found: false, members: [], topTweets: [] });
    // Only the list-resolution query ran; we never touched members/summaries/tweets.
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toMatch(/FROM twitter_lists/);
  });
});
