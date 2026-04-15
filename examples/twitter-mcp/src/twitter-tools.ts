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

async function twitterGet(endpoint: string, token: string): Promise<unknown> {
  const res = await fetch(`${TWITTER_API}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twitter API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function twitterPost(endpoint: string, body: unknown, token: string): Promise<unknown> {
  const res = await fetch(`${TWITTER_API}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twitter API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function twitterDelete(endpoint: string, token: string): Promise<unknown> {
  const res = await fetch(`${TWITTER_API}${endpoint}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 204) return { deleted: true };
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twitter API error ${res.status}: ${text}`);
  }
  return res.json();
}

/** Get the authenticated user's Twitter ID. */
async function getMyUserId(token: string): Promise<string> {
  const data = await twitterGet(`/users/me`, token) as { data?: { id: string } };
  if (!data.data?.id) throw new Error('Could not get user ID');
  return data.data.id;
}

function toolResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
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
        const data = await twitterPost('/tweets', { text: params.text }, token) as { data?: { id: string; text: string } };
        const tweetId = data.data?.id;
        return toolResult({ ...data, url: tweetId ? `https://twitter.com/i/status/${tweetId}` : undefined });
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
}
