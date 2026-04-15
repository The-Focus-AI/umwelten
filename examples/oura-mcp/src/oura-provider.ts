import { randomUUID } from 'node:crypto';
import type { UpstreamOAuthProvider, UpstreamTokens } from '../../../src/habitat/mcp-serve/index.js';

export class OuraProvider implements UpstreamOAuthProvider {
  readonly name = 'oura';
  readonly scopes = 'daily heartrate personal';

  constructor(
    private ouraClientId: string,
    private ouraClientSecret: string,
  ) {}

  buildAuthorizeUrl(callbackUrl: string, state: string): string {
    const url = new URL('https://cloud.ouraring.com/oauth/authorize');
    url.searchParams.set('client_id', this.ouraClientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.scopes);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string, callbackUrl: string): Promise<{ tokens: UpstreamTokens; userId: string }> {
    const tokenRes = await fetch('https://api.ouraring.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: this.ouraClientId,
        client_secret: this.ouraClientSecret,
        redirect_uri: callbackUrl,
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`Oura token exchange failed: ${tokenRes.status}`);
    }

    const data = await tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      expires_in?: number;
      scope?: string;
    };

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    // Get user identity from Oura
    let userId: string;
    try {
      const userRes = await fetch('https://api.ouraring.com/v2/usercollection/personal_info', {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });

      if (userRes.ok) {
        const userInfo = await userRes.json() as { id?: string; email?: string };
        if (userInfo.id) {
          userId = userInfo.id;
        } else if (userInfo.email) {
          const encoder = new TextEncoder();
          const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(userInfo.email));
          userId = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        } else {
          userId = randomUUID();
        }
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
        expires_at: expiresAt,
        scopes: data.scope,
      },
      userId,
    };
  }

  async refreshToken(refreshToken: string): Promise<UpstreamTokens> {
    const res = await fetch('https://api.ouraring.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.ouraClientId,
        client_secret: this.ouraClientSecret,
      }),
    });

    if (!res.ok) throw new Error(`Oura token refresh failed: ${res.status}`);

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
