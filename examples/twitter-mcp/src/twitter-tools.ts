/**
 * Twitter MCP tool registrar.
 *
 * Registers Twitter API v2 tools on an McpServer for a given user.
 * Each tool uses getUpstreamToken() to get a valid Bearer token.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const TWITTER_API = 'https://api.twitter.com/2';

const USER_FIELDS = 'id,name,username,created_at,description,location,profile_image_url,public_metrics,verified';
const TWEET_FIELDS = 'id,text,author_id,created_at,conversation_id,public_metrics,source,lang,entities,note_tweet';

type RateLimit = {
  limit: number | null;
  remaining: number | null;
  reset: number | null;
  resetAt: string | null;
  userLimit24h: number | null;
  userRemaining24h: number | null;
  userReset24h: number | null;
  userResetAt24h: string | null;
  appLimit24h: number | null;
  appRemaining24h: number | null;
  appReset24h: number | null;
  appResetAt24h: string | null;
};

function parseIntOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function epochToIso(v: number | null): string | null {
  return v == null ? null : new Date(v * 1000).toISOString();
}

function extractRateLimit(res: Response): RateLimit {
  const h = res.headers;
  const reset = parseIntOrNull(h.get('x-rate-limit-reset'));
  const userReset24h = parseIntOrNull(h.get('x-user-limit-24hour-reset'));
  const appReset24h = parseIntOrNull(h.get('x-app-limit-24hour-reset'));
  return {
    limit: parseIntOrNull(h.get('x-rate-limit-limit')),
    remaining: parseIntOrNull(h.get('x-rate-limit-remaining')),
    reset,
    resetAt: epochToIso(reset),
    userLimit24h: parseIntOrNull(h.get('x-user-limit-24hour-limit')),
    userRemaining24h: parseIntOrNull(h.get('x-user-limit-24hour-remaining')),
    userReset24h,
    userResetAt24h: epochToIso(userReset24h),
    appLimit24h: parseIntOrNull(h.get('x-app-limit-24hour-limit')),
    appRemaining24h: parseIntOrNull(h.get('x-app-limit-24hour-remaining')),
    appReset24h,
    appResetAt24h: epochToIso(appReset24h),
  };
}

type TwitterResult = { data: unknown; rateLimit: RateLimit };

async function twitterGet(endpoint: string, token: string): Promise<TwitterResult> {
  const res = await fetch(`${TWITTER_API}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const rateLimit = extractRateLimit(res);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twitter API error ${res.status}: ${text} | rateLimit=${JSON.stringify(rateLimit)}`);
  }
  return { data: await res.json(), rateLimit };
}

async function twitterPost(endpoint: string, body: unknown, token: string): Promise<TwitterResult> {
  const res = await fetch(`${TWITTER_API}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const rateLimit = extractRateLimit(res);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twitter API error ${res.status}: ${text} | rateLimit=${JSON.stringify(rateLimit)}`);
  }
  return { data: await res.json(), rateLimit };
}

async function twitterPut(endpoint: string, body: unknown, token: string): Promise<TwitterResult> {
  const res = await fetch(`${TWITTER_API}${endpoint}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const rateLimit = extractRateLimit(res);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twitter API error ${res.status}: ${text} | rateLimit=${JSON.stringify(rateLimit)}`);
  }
  return { data: await res.json(), rateLimit };
}

async function twitterDelete(endpoint: string, token: string): Promise<TwitterResult> {
  const res = await fetch(`${TWITTER_API}${endpoint}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  const rateLimit = extractRateLimit(res);
  if (res.status === 204) return { data: { deleted: true }, rateLimit };
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twitter API error ${res.status}: ${text} | rateLimit=${JSON.stringify(rateLimit)}`);
  }
  return { data: await res.json(), rateLimit };
}

/** Get the authenticated user's Twitter ID. */
async function getMyUserId(token: string): Promise<string> {
  const { data } = await twitterGet(`/users/me`, token) as { data: { data?: { id: string } } };
  if (!data.data?.id) throw new Error('Could not get user ID');
  return data.data.id;
}

function toolResult(result: TwitterResult | { data: unknown; rateLimit?: RateLimit }) {
  const payload = { ...(result.data as object), rateLimit: result.rateLimit };
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}

export async function registerTwitterTools(
  server: McpServer,
  _userId: string,
  getUpstreamToken: () => Promise<string>,
): Promise<void> {

  // ── User Info ──────────────────────────────────────────────────

  (server as any).tool(
    'twitter_me',
    'Get the authenticated Twitter user profile',
    {},
    async () => {
      try {
        const token = await getUpstreamToken();
        const data = await twitterGet(`/users/me?user.fields=${USER_FIELDS}`, token);
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  (server as any).tool(
    'twitter_user',
    'Get a Twitter user by username',
    { username: z.string().describe('Twitter username (without @)') },
    async (params: { username: string }) => {
      try {
        const token = await getUpstreamToken();
        const handle = params.username.replace(/^@/, '');
        const data = await twitterGet(`/users/by/username/${handle}?user.fields=${USER_FIELDS}`, token);
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  // ── Tweets ─────────────────────────────────────────────────────

  (server as any).tool(
    'twitter_post',
    'Post a new tweet',
    { text: z.string().describe('Tweet text (max 280 chars)') },
    async (params: { text: string }) => {
      try {
        const token = await getUpstreamToken();
        const result = await twitterPost('/tweets', { text: params.text }, token);
        const tweetId = (result.data as { data?: { id: string } }).data?.id;
        return toolResult({
          data: { ...(result.data as object), url: tweetId ? `https://twitter.com/i/status/${tweetId}` : undefined },
          rateLimit: result.rateLimit,
        });
      } catch (error) { return toolError(error); }
    },
  );

  (server as any).tool(
    'twitter_delete_tweet',
    'Delete a tweet by ID',
    { tweet_id: z.string().describe('Tweet ID to delete') },
    async (params: { tweet_id: string }) => {
      try {
        const token = await getUpstreamToken();
        const data = await twitterDelete(`/tweets/${params.tweet_id}`, token);
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  (server as any).tool(
    'twitter_tweet',
    'Get a specific tweet by ID',
    { tweet_id: z.string().describe('Tweet ID') },
    async (params: { tweet_id: string }) => {
      try {
        const token = await getUpstreamToken();
        const data = await twitterGet(`/tweets/${params.tweet_id}?tweet.fields=${TWEET_FIELDS}`, token);
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  (server as any).tool(
    'twitter_my_tweets',
    'Get my recent tweets',
    {},
    async () => {
      try {
        const token = await getUpstreamToken();
        const myId = await getMyUserId(token);
        const data = await twitterGet(`/users/${myId}/tweets?max_results=10&tweet.fields=${TWEET_FIELDS}`, token);
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  // ── Timeline ───────────────────────────────────────────────────

  (server as any).tool(
    'twitter_timeline',
    'Get home timeline (recent tweets from followed accounts)',
    {},
    async () => {
      try {
        const token = await getUpstreamToken();
        const myId = await getMyUserId(token);
        const data = await twitterGet(
          `/users/${myId}/timelines/reverse_chronological?max_results=20&tweet.fields=${TWEET_FIELDS}&user.fields=${USER_FIELDS}&expansions=author_id`,
          token,
        );
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  // ── Search ─────────────────────────────────────────────────────

  (server as any).tool(
    'twitter_search',
    'Search recent tweets (last 7 days)',
    { query: z.string().describe('Search query (supports Twitter search operators like from:, #, etc.)') },
    async (params: { query: string }) => {
      try {
        const token = await getUpstreamToken();
        const data = await twitterGet(
          `/tweets/search/recent?query=${encodeURIComponent(params.query)}&max_results=10&tweet.fields=${TWEET_FIELDS}`,
          token,
        );
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  // ── Engagement ─────────────────────────────────────────────────

  (server as any).tool(
    'twitter_like',
    'Like a tweet',
    { tweet_id: z.string().describe('Tweet ID to like') },
    async (params: { tweet_id: string }) => {
      try {
        const token = await getUpstreamToken();
        const myId = await getMyUserId(token);
        const data = await twitterPost(`/users/${myId}/likes`, { tweet_id: params.tweet_id }, token);
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  (server as any).tool(
    'twitter_retweet',
    'Retweet a tweet',
    { tweet_id: z.string().describe('Tweet ID to retweet') },
    async (params: { tweet_id: string }) => {
      try {
        const token = await getUpstreamToken();
        const myId = await getMyUserId(token);
        const data = await twitterPost(`/users/${myId}/retweets`, { tweet_id: params.tweet_id }, token);
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  // ── Lists ──────────────────────────────────────────────────────

  (server as any).tool(
    'twitter_lists',
    'Get my Twitter lists',
    {},
    async () => {
      try {
        const token = await getUpstreamToken();
        const myId = await getMyUserId(token);
        const data = await twitterGet(`/users/${myId}/owned_lists?list.fields=id,name,description,private,member_count,follower_count,created_at`, token);
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  (server as any).tool(
    'twitter_list_tweets',
    'Get tweets from a list',
    { list_id: z.string().describe('List ID') },
    async (params: { list_id: string }) => {
      try {
        const token = await getUpstreamToken();
        const data = await twitterGet(`/lists/${params.list_id}/tweets?max_results=20&tweet.fields=${TWEET_FIELDS}`, token);
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  (server as any).tool(
    'twitter_list_create',
    'Create a new Twitter list',
    {
      name: z.string().describe('List name (max 25 chars)'),
      description: z.string().optional().describe('Optional list description (max 100 chars)'),
      private: z.boolean().optional().describe('Whether the list is private (default false)'),
    },
    async (params: { name: string; description?: string; private?: boolean }) => {
      try {
        const token = await getUpstreamToken();
        const body: Record<string, unknown> = { name: params.name };
        if (params.description !== undefined) body.description = params.description;
        if (params.private !== undefined) body.private = params.private;
        const data = await twitterPost('/lists', body, token);
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  (server as any).tool(
    'twitter_list_delete',
    'Delete a Twitter list',
    { list_id: z.string().describe('List ID to delete') },
    async (params: { list_id: string }) => {
      try {
        const token = await getUpstreamToken();
        const data = await twitterDelete(`/lists/${params.list_id}`, token);
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  (server as any).tool(
    'twitter_list_update',
    'Update a Twitter list (rename, change description, toggle private). Only provided fields are changed.',
    {
      list_id: z.string().describe('List ID to update'),
      name: z.string().optional().describe('New list name (max 25 chars)'),
      description: z.string().optional().describe('New list description (max 100 chars)'),
      private: z.boolean().optional().describe('Whether the list is private'),
    },
    async (params: { list_id: string; name?: string; description?: string; private?: boolean }) => {
      try {
        const token = await getUpstreamToken();
        const body: Record<string, unknown> = {};
        if (params.name !== undefined) body.name = params.name;
        if (params.description !== undefined) body.description = params.description;
        if (params.private !== undefined) body.private = params.private;
        if (Object.keys(body).length === 0) {
          throw new Error('Provide at least one of: name, description, private');
        }
        const data = await twitterPut(`/lists/${params.list_id}`, body, token);
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  (server as any).tool(
    'twitter_list_members',
    'Get members of a Twitter list',
    { list_id: z.string().describe('List ID') },
    async (params: { list_id: string }) => {
      try {
        const token = await getUpstreamToken();
        const data = await twitterGet(
          `/lists/${params.list_id}/members?max_results=100&user.fields=${USER_FIELDS}`,
          token,
        );
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  (server as any).tool(
    'twitter_list_add_member',
    'Add a user to a Twitter list',
    {
      list_id: z.string().describe('List ID'),
      user_id: z.string().describe('User ID to add (numeric Twitter user ID, not username)'),
    },
    async (params: { list_id: string; user_id: string }) => {
      try {
        const token = await getUpstreamToken();
        const data = await twitterPost(`/lists/${params.list_id}/members`, { user_id: params.user_id }, token);
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  (server as any).tool(
    'twitter_list_remove_member',
    'Remove a user from a Twitter list',
    {
      list_id: z.string().describe('List ID'),
      user_id: z.string().describe('User ID to remove (numeric Twitter user ID, not username)'),
    },
    async (params: { list_id: string; user_id: string }) => {
      try {
        const token = await getUpstreamToken();
        const data = await twitterDelete(`/lists/${params.list_id}/members/${params.user_id}`, token);
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  // ── Bookmarks ──────────────────────────────────────────────────

  (server as any).tool(
    'twitter_bookmarks',
    'Get my bookmarked tweets',
    {},
    async () => {
      try {
        const token = await getUpstreamToken();
        const myId = await getMyUserId(token);
        const data = await twitterGet(
          `/users/${myId}/bookmarks?max_results=100&tweet.fields=${TWEET_FIELDS}&expansions=attachments.media_keys&media.fields=url,preview_image_url,type,width,height,media_key`,
          token,
        );
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  (server as any).tool(
    'twitter_bookmark',
    'Bookmark a tweet',
    { tweet_id: z.string().describe('Tweet ID to bookmark') },
    async (params: { tweet_id: string }) => {
      try {
        const token = await getUpstreamToken();
        const myId = await getMyUserId(token);
        const data = await twitterPost(`/users/${myId}/bookmarks`, { tweet_id: params.tweet_id }, token);
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  (server as any).tool(
    'twitter_unbookmark',
    'Remove a bookmark',
    { tweet_id: z.string().describe('Tweet ID to unbookmark') },
    async (params: { tweet_id: string }) => {
      try {
        const token = await getUpstreamToken();
        const myId = await getMyUserId(token);
        const data = await twitterDelete(`/users/${myId}/bookmarks/${params.tweet_id}`, token);
        return toolResult(data);
      } catch (error) { return toolError(error); }
    },
  );

  // ── Meta ───────────────────────────────────────────────────────

  (server as any).tool(
    'twitter_info',
    'Probe current rate-limit state and return a per-tool budget map. Costs 1 call against the /2/users/me bucket (75 / 15min per user).',
    {},
    async () => {
      try {
        const token = await getUpstreamToken();
        const probe = await twitterGet(`/users/me`, token);
        const me = (probe.data as { data?: { id: string; username: string; name: string } }).data;
        const budgets = [
          { tool: 'twitter_me', endpoint: 'GET /2/users/me', perUser: 75, perApp: 75, window: '15min' },
          { tool: 'twitter_user', endpoint: 'GET /2/users/by/username/:handle', perUser: 100, perApp: 500, window: '15min' },
          { tool: 'twitter_post', endpoint: 'POST /2/tweets', perUser: '100/15min + 17/24h', perApp: '10000/24h', window: '15min+24h' },
          { tool: 'twitter_delete_tweet', endpoint: 'DELETE /2/tweets/:id', perUser: 50, perApp: null, window: '15min' },
          { tool: 'twitter_tweet', endpoint: 'GET /2/tweets/:id', perUser: 900, perApp: 450, window: '15min' },
          { tool: 'twitter_my_tweets', endpoint: 'GET /2/users/:id/tweets', perUser: 900, perApp: 1500, window: '15min' },
          { tool: 'twitter_timeline', endpoint: 'GET /2/users/:id/timelines/reverse_chronological', perUser: 180, perApp: null, window: '15min' },
          { tool: 'twitter_search', endpoint: 'GET /2/tweets/search/recent', perUser: 300, perApp: 450, window: '15min' },
          { tool: 'twitter_like', endpoint: 'POST /2/users/:id/likes', perUser: '50/15min + 1000/24h', perApp: null, window: '15min+24h' },
          { tool: 'twitter_retweet', endpoint: 'POST /2/users/:id/retweets', perUser: 50, perApp: null, window: '15min' },
          { tool: 'twitter_lists', endpoint: 'GET /2/users/:id/owned_lists', perUser: 15, perApp: 15, window: '15min' },
          { tool: 'twitter_list_tweets', endpoint: 'GET /2/lists/:id/tweets', perUser: 900, perApp: 900, window: '15min' },
          { tool: 'twitter_list_members', endpoint: 'GET /2/lists/:id/members', perUser: 900, perApp: 900, window: '15min' },
          { tool: 'twitter_list_create', endpoint: 'POST /2/lists', perUser: '300/24h', perApp: null, window: '24h' },
          { tool: 'twitter_list_delete', endpoint: 'DELETE /2/lists/:id', perUser: '300/24h', perApp: null, window: '24h' },
          { tool: 'twitter_list_update', endpoint: 'PUT /2/lists/:id', perUser: '300/24h', perApp: null, window: '24h' },
          { tool: 'twitter_list_add_member', endpoint: 'POST /2/lists/:id/members', perUser: '300/24h', perApp: null, window: '24h' },
          { tool: 'twitter_list_remove_member', endpoint: 'DELETE /2/lists/:id/members/:user_id', perUser: '300/24h', perApp: null, window: '24h' },
          { tool: 'twitter_bookmarks', endpoint: 'GET /2/users/:id/bookmarks', perUser: 180, perApp: null, window: '15min' },
          { tool: 'twitter_bookmark', endpoint: 'POST /2/users/:id/bookmarks', perUser: 50, perApp: null, window: '15min' },
          { tool: 'twitter_unbookmark', endpoint: 'DELETE /2/users/:id/bookmarks/:tweet_id', perUser: 50, perApp: null, window: '15min' },
        ];
        return toolResult({
          data: {
            authenticatedAs: me ? { id: me.id, username: me.username, name: me.name } : null,
            observedBucket: { endpoint: 'GET /2/users/me', rateLimit: probe.rateLimit },
            budgets,
            notes: [
              'rateLimit numbers are published defaults for the standard pay-per-use tier and may differ for your app tier.',
              'Twitter only reports live counters for the bucket you just hit. Call the matching tool once to see its current remaining.',
              'If twitter_list_members returns "No approval received", re-authorize: the list.read/list.write scopes must be on the active token.',
            ],
          },
          rateLimit: probe.rateLimit,
        });
      } catch (error) { return toolError(error); }
    },
  );
}
