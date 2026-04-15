/**
 * Twitter/X upstream OAuth provider.
 *
 * Handles the Twitter OAuth 2.0 flow:
 * - Authorization via twitter.com
 * - Token exchange with Basic auth (confidential client)
 * - User identity from /2/users/me
 * - Token refresh (Twitter refresh tokens are single-use)
 */

import { randomUUID } from 'node:crypto';
import type { UpstreamOAuthProvider, UpstreamTokens } from '../../../src/habitat/mcp-serve/index.js';

const TWITTER_AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
const TWITTER_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const TWITTER_SCOPES = 'tweet.read tweet.write users.read list.read list.write like.read like.write offline.access';

export class TwitterProvider implements UpstreamOAuthProvider {
  readonly name = 'twitter';
  readonly scopes = TWITTER_SCOPES;

  constructor(
    private clientId: string,
    private clientSecret: string,
  ) {}

  private get basicAuth(): string {
    return Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
  }

  buildAuthorizeUrl(callbackUrl: string, state: string): string {
    const url = new URL(TWITTER_AUTH_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('scope', TWITTER_SCOPES);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string, callbackUrl: string): Promise<{ tokens: UpstreamTokens; userId: string }> {
    const res = await fetch(TWITTER_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${this.basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Twitter token exchange failed: ${res.status} ${text}`);
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token: string;
      expires_in?: number;
      scope?: string;
    };

    // Get user identity from Twitter
    let userId: string;
    let username: string | undefined;
    try {
      const userRes = await fetch('https://api.twitter.com/2/users/me', {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      if (userRes.ok) {
        const userInfo = await userRes.json() as { data?: { id: string; username: string } };
        userId = userInfo.data?.id ?? randomUUID();
        username = userInfo.data?.username;
      } else {
        userId = randomUUID();
      }
    } catch {
      userId = randomUUID();
    }

    return {
      tokens: {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
        scopes: data.scope,
        extra: username ? { username } : undefined,
      },
      userId,
    };
  }

  async refreshToken(refreshToken: string): Promise<UpstreamTokens> {
    const res = await fetch(TWITTER_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${this.basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) throw new Error(`Twitter token refresh failed: ${res.status}`);

    const data = await res.json() as {
      access_token: string;
      refresh_token: string;
      expires_in?: number;
      scope?: string;
    };

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
      scopes: data.scope,
    };
  }
}
