import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildAuthorizeUrl,
  createPkcePair,
  exchangeCode,
  refreshAccessToken,
  XAuthError,
  X_AUTHORIZE_URL,
  X_DEFAULT_SCOPES,
} from './x-oauth.js';

const client = { clientId: 'cid', clientSecret: 'csecret' };

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('createPkcePair', () => {
  it('produces a base64url verifier whose S256 challenge matches', () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    const expected = base64url(createHash('sha256').update(verifier).digest());
    expect(challenge).toBe(expected);
  });

  it('generates a fresh verifier each call', () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier);
  });
});

describe('buildAuthorizeUrl', () => {
  it('includes the required PKCE + OAuth params', () => {
    const url = new URL(
      buildAuthorizeUrl(client, {
        redirectUri: 'http://localhost:9876/callback',
        state: 'st-1',
        challenge: 'chal-1',
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(X_AUTHORIZE_URL);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:9876/callback');
    expect(url.searchParams.get('scope')).toBe(X_DEFAULT_SCOPES);
    expect(url.searchParams.get('state')).toBe('st-1');
    expect(url.searchParams.get('code_challenge')).toBe('chal-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('requests offline.access so a refresh token is issued', () => {
    expect(X_DEFAULT_SCOPES).toContain('offline.access');
  });
});

describe('exchangeCode', () => {
  it('sends Basic auth + the authorization_code grant and returns the tokens', async () => {
    let captured: { headers: Record<string, string>; body: string } | undefined;
    const fetchFn = async (_url: string | URL, init?: RequestInit) => {
      captured = { headers: init?.headers as Record<string, string>, body: String(init?.body) };
      return new Response(
        JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 7200 }),
        { status: 200 },
      );
    };
    const tokens = await exchangeCode(
      client,
      { code: 'the-code', redirectUri: 'http://localhost/cb', verifier: 'ver' },
      fetchFn,
    );
    expect(tokens.access_token).toBe('at');
    expect(tokens.refresh_token).toBe('rt');
    expect(captured!.headers.Authorization).toBe(`Basic ${Buffer.from('cid:csecret').toString('base64')}`);
    expect(captured!.body).toContain('grant_type=authorization_code');
    expect(captured!.body).toContain('code=the-code');
    expect(captured!.body).toContain('code_verifier=ver');
  });
});

describe('refreshAccessToken', () => {
  it('sends the refresh_token grant with Basic auth and returns rotated tokens', async () => {
    let body = '';
    const fetchFn = async (_url: string | URL, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(
        JSON.stringify({ access_token: 'at2', refresh_token: 'rt2', expires_in: 7200 }),
        { status: 200 },
      );
    };
    const tokens = await refreshAccessToken(client, 'rt1', fetchFn);
    expect(tokens.access_token).toBe('at2');
    expect(tokens.refresh_token).toBe('rt2');
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=rt1');
  });

  it('throws a needs_reauth XAuthError on invalid_grant', async () => {
    const fetchFn = async () =>
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'expired' }), {
        status: 400,
      });
    const err = await refreshAccessToken(client, 'dead', fetchFn).catch((e) => e);
    expect(err).toBeInstanceOf(XAuthError);
    expect(err.kind).toBe('needs_reauth');
  });

  it('throws a transient XAuthError on a 5xx / non-JSON body', async () => {
    const fetchFn = async () => new Response('<html>503</html>', { status: 503 });
    const err = await refreshAccessToken(client, 'rt1', fetchFn).catch((e) => e);
    expect(err).toBeInstanceOf(XAuthError);
    expect(err.kind).toBe('transient');
  });
});
