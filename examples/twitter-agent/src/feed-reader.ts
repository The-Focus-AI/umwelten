/**
 * Feed reader — the deep module behind the Twitter habitat's **public-data path**
 * (issue #153). Read-only consumer of the Neon tables the external `twitter-feed`
 * sync pipeline populates; the habitat holds no twitterapi.io key, only a
 * `DATABASE_URL`.
 *
 * It answers the three public-data questions, ranked by engagement where it makes
 * sense, and embeds the SQL here so the Agent tools that consume it stay thin:
 *
 *  - person recent   — "what's <person> been posting?"  (getPersonRecent)
 *  - high engagement — most notable tweets, optionally windowed / list-scoped (getHighEngagement)
 *  - list digest     — a tracked list's members + their top tweets + latest summary (getListDigest)
 *
 * The Postgres boundary is injected as a thin {@link QueryExecutor}
 * (`(text, params) => rows`) so the module is fully unit-testable with an
 * in-memory fake — no real database in tests. In production it is bound to
 * `@neondatabase/serverless`'s `neon()` HTTP query path (see {@link neonExecutor}),
 * matching the repo's existing NeonStore.
 *
 * Schema ground-truth + design notes:
 *   reports/2026-06-16-twitter-feed-neon-schema.md
 *   reports/2026-06-16-neon-serverless-readonly-driver.md
 *
 * Engagement formula matches the upstream pipeline
 * (twitter-feed/src/tweets.ts#calculateEngagement) exactly:
 *   engagement = like_count + retweet_count + reply_count
 * so the habitat's ranking agrees with the pipeline's own reports. Quotes,
 * bookmarks and impressions are surfaced but NOT counted toward the rank.
 */

/**
 * Minimal parameterized-query boundary. Implemented over `neon()` in production
 * (see {@link neonExecutor}) and by an in-memory fake in tests. Always called
 * with `$1`-style placeholders + a params array — never string-concatenated SQL.
 */
export type QueryExecutor = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

/** Engagement breakdown for a tweet. `total` is the ranked metric (likes+RTs+replies). */
export interface Engagement {
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  impressions: number;
  /** likes + retweets + replies — the value the feed ranks by. */
  total: number;
}

/** A tweet from the public feed (cached_tweets ⨝ twitter_profiles), shaped for the agent. */
export interface FeedTweet {
  id: string;
  username: string;
  /** Display name from twitter_profiles, when known. */
  displayName?: string;
  text: string;
  /** ISO-8601 timestamp. */
  createdAt?: string;
  engagement: Engagement;
  url: string;
}

/** A tracked list (twitter_lists), addressed by its file_id slug or name. */
export interface FeedList {
  /** The file_id slug, e.g. "ai-engineers". */
  fileId: string;
  name: string;
  description?: string;
  memberCount?: number;
}

/** A list member (twitter_list_members). */
export interface FeedListMember {
  username: string;
  displayName?: string;
}

/** A pre-generated list summary (summaries), markdown content. */
export interface FeedSummary {
  reportDate: string;
  reportType: string;
  title?: string;
  content: string;
  generatedAt?: string;
}

/** Result of a list digest. Degrades gracefully: unknown list → found=false, empty arrays. */
export interface ListDigest {
  found: boolean;
  list?: FeedList;
  members: FeedListMember[];
  topTweets: FeedTweet[];
  /** Latest summary for the list, if the pipeline has generated one. */
  summary?: FeedSummary;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
}

/** Normalize a handle to how it is stored in the DB: no leading '@', lowercased, trimmed. */
export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  return String(v);
}

/** Postgres timestamptz comes back as a Date (pg type parser) or a string; normalize to ISO. */
function toIso(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** Shape of a cached_tweets row joined with twitter_profiles.display_name. */
interface TweetRow {
  tweet_id: unknown;
  username: unknown;
  display_name?: unknown;
  text: unknown;
  created_at?: unknown;
  like_count?: unknown;
  retweet_count?: unknown;
  reply_count?: unknown;
  quote_count?: unknown;
  impression_count?: unknown;
}

function mapTweet(row: TweetRow): FeedTweet {
  const likes = num(row.like_count);
  const retweets = num(row.retweet_count);
  const replies = num(row.reply_count);
  const username = String(row.username);
  const id = String(row.tweet_id);
  return {
    id,
    username,
    displayName: str(row.display_name),
    text: String(row.text ?? ''),
    createdAt: toIso(row.created_at),
    engagement: {
      likes,
      retweets,
      replies,
      quotes: num(row.quote_count),
      impressions: num(row.impression_count),
      total: likes + retweets + replies,
    },
    url: `https://x.com/${username}/status/${id}`,
  };
}

// Selected columns shared by every tweet query (cached_tweets t ⨝ twitter_profiles p).
const TWEET_COLUMNS = `
  t.tweet_id, t.username, t.text, t.created_at,
  t.like_count, t.retweet_count, t.reply_count, t.quote_count, t.impression_count,
  p.display_name`;
const TWEET_FROM = `
  FROM cached_tweets t
  LEFT JOIN twitter_profiles p ON p.username = t.username`;
// Engagement rank expression — must match twitter-feed/src/tweets.ts#calculateEngagement.
const ENGAGEMENT_EXPR = `(t.like_count + t.retweet_count + t.reply_count)`;

export class FeedReader {
  constructor(private readonly exec: QueryExecutor) {}

  /**
   * A person's recent tweets, most-recent first.
   * @param handle  the @handle (with or without '@', any case).
   * @param opts.limit       1–100 (default 20).
   * @param opts.sinceHours  only tweets newer than this many hours, when set.
   */
  async getPersonRecent(
    handle: string,
    opts: { limit?: number; sinceHours?: number } = {},
  ): Promise<FeedTweet[]> {
    const username = normalizeHandle(handle);
    const limit = clampLimit(opts.limit);
    const params: unknown[] = [username];
    let where = `WHERE t.username = $1`;
    if (opts.sinceHours && opts.sinceHours > 0) {
      params.push(opts.sinceHours);
      where += ` AND t.created_at >= now() - make_interval(hours => $${params.length})`;
    }
    params.push(limit);
    const sql = `SELECT ${TWEET_COLUMNS} ${TWEET_FROM}
      ${where}
      ORDER BY t.created_at DESC
      LIMIT $${params.length}`;
    const rows = await this.exec<TweetRow>(sql, params);
    return rows.map(mapTweet);
  }

  /**
   * The most notable tweets ranked by engagement (likes + retweets + replies).
   * @param opts.limit       1–100 (default 20).
   * @param opts.sinceHours  restrict to a recent window, when set.
   * @param opts.usernames   restrict to these handles (e.g. a list's members), when set.
   */
  async getHighEngagement(
    opts: { limit?: number; sinceHours?: number; usernames?: string[] } = {},
  ): Promise<FeedTweet[]> {
    const limit = clampLimit(opts.limit);
    const params: unknown[] = [];
    const clauses: string[] = [];

    if (opts.usernames && opts.usernames.length > 0) {
      const handles = opts.usernames.map(normalizeHandle);
      params.push(handles);
      clauses.push(`t.username = ANY($${params.length})`);
    }
    if (opts.sinceHours && opts.sinceHours > 0) {
      params.push(opts.sinceHours);
      clauses.push(`t.created_at >= now() - make_interval(hours => $${params.length})`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    const sql = `SELECT ${TWEET_COLUMNS} ${TWEET_FROM}
      ${where}
      ORDER BY ${ENGAGEMENT_EXPR} DESC, t.created_at DESC
      LIMIT $${params.length}`;
    const rows = await this.exec<TweetRow>(sql, params);
    return rows.map(mapTweet);
  }

  /** Resolve a list by its file_id slug or (case-insensitive) name. */
  async getList(identifier: string): Promise<{ list: FeedList; surrogateId: string } | null> {
    const key = identifier.trim();
    const rows = await this.exec<{
      id: unknown;
      file_id: unknown;
      name: unknown;
      description?: unknown;
      member_count?: unknown;
    }>(
      `SELECT id, file_id, name, description, member_count
       FROM twitter_lists
       WHERE file_id = $1 OR lower(name) = lower($1)
       LIMIT 1`,
      [key],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      surrogateId: String(r.id),
      list: {
        fileId: String(r.file_id),
        name: String(r.name ?? r.file_id),
        description: str(r.description),
        memberCount: r.member_count == null ? undefined : num(r.member_count),
      },
    };
  }

  /** A list's members. `surrogateId` is twitter_lists.id (NOT the file_id slug). */
  async getListMembers(surrogateId: string): Promise<FeedListMember[]> {
    const rows = await this.exec<{ username: unknown; display_name?: unknown }>(
      `SELECT username, display_name
       FROM twitter_list_members
       WHERE list_id = $1
       ORDER BY username ASC`,
      [surrogateId],
    );
    return rows.map((r) => ({ username: String(r.username), displayName: str(r.display_name) }));
  }

  /** The latest pre-generated summary for a list, by file_id slug. */
  async getLatestSummary(fileId: string): Promise<FeedSummary | undefined> {
    const rows = await this.exec<{
      report_date: unknown;
      report_type: unknown;
      title?: unknown;
      content: unknown;
      generated_at?: unknown;
    }>(
      `SELECT report_date, report_type, title, content, generated_at
       FROM summaries
       WHERE list_id = $1
       ORDER BY report_date DESC, generated_at DESC
       LIMIT 1`,
      [fileId],
    );
    if (rows.length === 0) return undefined;
    const r = rows[0];
    return {
      reportDate: String(r.report_date),
      reportType: String(r.report_type),
      title: str(r.title),
      content: String(r.content ?? ''),
      generatedAt: toIso(r.generated_at),
    };
  }

  /**
   * A tracked list's digest: the list, its members, their top tweets by engagement,
   * and the latest pre-generated summary when one exists.
   *
   * Degrades gracefully — an unknown list returns `{ found: false, members: [],
   * topTweets: [] }` rather than throwing, so the agent can say "I don't track
   * that list" instead of erroring.
   *
   * @param identifier  the list file_id slug (e.g. "ai-engineers") or its name.
   * @param opts.limit       top-N tweets to return (default 20).
   * @param opts.sinceHours  window for the top tweets (default 48h).
   */
  async getListDigest(
    identifier: string,
    opts: { limit?: number; sinceHours?: number } = {},
  ): Promise<ListDigest> {
    const resolved = await this.getList(identifier);
    if (!resolved) {
      return { found: false, members: [], topTweets: [] };
    }
    const { list, surrogateId } = resolved;
    const members = await this.getListMembers(surrogateId);
    const summary = await this.getLatestSummary(list.fileId);

    let topTweets: FeedTweet[] = [];
    if (members.length > 0) {
      topTweets = await this.getHighEngagement({
        limit: opts.limit,
        sinceHours: opts.sinceHours ?? 48,
        usernames: members.map((m) => m.username),
      });
    }
    return { found: true, list, members, topTweets, summary };
  }
}

/**
 * Bind a {@link QueryExecutor} to `@neondatabase/serverless`'s `neon()` HTTP query
 * path. One handle per process is fine (it is a stateless fetch closure). Imported
 * lazily so unit tests — which inject a fake executor — never load the driver.
 */
export async function neonExecutor(databaseUrl: string): Promise<QueryExecutor> {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(databaseUrl);
  // sql.query(text, params) already has the (text, params) => rows shape; cast past
  // the caller-chosen generic T (the rows are validated/shaped by FeedReader).
  const exec = (text: string, params?: unknown[]) => sql.query(text, params ?? []);
  return exec as unknown as QueryExecutor;
}
