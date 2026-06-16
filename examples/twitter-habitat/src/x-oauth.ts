/**
 * X (Twitter) API v2 OAuth 2.0 wire helpers.
 *
 * Pure functions over the X OAuth endpoints — no secret store, no caching.
 * Used by the one-shot bootstrap script (authorize URL + code exchange) and by
 * the {@link XTokenStore} deep module (refresh grant).
 *
 * Ported from the working `examples/twitter-mcp` upstream provider, with the
 * refresh path hardened per the token-refresh research
 * (reports/2026-06-16-x-oauth2-token-refresh.md):
 *
 *  - confidential client: Basic auth on BOTH code-exchange and refresh; client_id
 *    is omitted from the body when Basic auth is sent.
 *  - X refresh tokens are rotated single-use — every refresh returns a NEW
 *    refresh_token that must replace the old one.
 *  - error classification: `invalid_grant` (refresh token expired/revoked/consumed)
 *    is terminal → the operator must re-run the bootstrap; 5xx / non-JSON bodies
 *    are transient and must NOT be treated as a dead refresh token.
 *
 * Host note: X migrated the canonical host to api.x.com / x.com; the legacy
 * api.twitter.com / twitter.com hosts still work. We use the current hosts.
 */

import { createHash, randomBytes } from 'node:crypto';

/** Canonical X OAuth 2.0 token endpoint (api.twitter.com still works as a legacy alias). */
export const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
/** Canonical X OAuth 2.0 authorize endpoint. */
export const X_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';

/**
 * Scopes for the read-only Twitter habitat. `offline.access` is REQUIRED — without
 * it X issues no refresh token at all and the daemon cannot stay authenticated.
 */
export const X_DEFAULT_SCOPES = [
  'tweet.read',
  'users.read',
  'bookmark.read',
  'like.read',
  'list.read',
  'offline.access',
].join(' ');

/** Minimal `fetch` shape so callers can inject a fake in tests. */
export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Confidential-client credentials issued by the X developer portal. */
export interface XOAuthClient {
  clientId: string;
  clientSecret: string;
}

/** Raw token payload returned by the X token endpoint. */
export interface XTokenResponse {
  access_token: string;
  /** X rotates this on every refresh — always persist the latest. */
  refresh_token: string;
  /** Seconds until the access token expires (typically 7200). */
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

export type XAuthErrorKind =
  /** Refresh token expired/revoked/consumed, or never bootstrapped — operator must re-auth. Terminal. */
  | 'needs_reauth'
  /** 5xx / network / non-JSON body — safe to retry later; the refresh token is NOT dead. */
  | 'transient'
  /** Missing client id/secret configuration. */
  | 'config'
  /** Unclassified non-2xx response. */
  | 'unknown';

/** Error raised by the OAuth helpers and token store, tagged with a recovery {@link XAuthErrorKind}. */
export class XAuthError extends Error {
  constructor(
    message: string,
    readonly kind: XAuthErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'XAuthError';
  }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function basicAuth(client: XOAuthClient): string {
  return Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64');
}

/**
 * Generate a PKCE verifier/challenge pair (S256). The verifier is 43 chars of
 * base64url (32 random bytes); the challenge is base64url(sha256(verifier)).
 */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/**
 * Build the X authorize URL the operator opens in a browser during bootstrap.
 */
export function buildAuthorizeUrl(
  client: XOAuthClient,
  opts: { redirectUri: string; state: string; challenge: string; scopes?: string },
): string {
  const url = new URL(X_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('scope', opts.scopes ?? X_DEFAULT_SCOPES);
  url.searchParams.set('state', opts.state);
  url.searchParams.set('code_challenge', opts.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/**
 * Classify a non-OK token-endpoint response into an {@link XAuthError}. Reads the
 * body to look for `invalid_grant` (terminal) vs. a transient server error.
 */
async function tokenError(res: Response, op: string): Promise<XAuthError> {
  const status = res.status;
  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    /* ignore */
  }

  // 5xx, or an HTML/empty (non-JSON) error page → transient. X's token endpoint
  // occasionally returns an HTML error page; that must NOT be read as a dead token.
  let parsed: { error?: string; error_description?: string } | undefined;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : undefined;
  } catch {
    parsed = undefined;
  }
  if (status >= 500 || !parsed) {
    return new XAuthError(
      `X token ${op} failed (transient): ${status} ${bodyText.slice(0, 200)}`,
      'transient',
      status,
    );
  }

  const code = parsed.error ?? '';
  const desc = parsed.error_description ?? '';
  // invalid_grant = refresh token expired/revoked/consumed. invalid_request with a
  // "token was invalid" description is the consumed-token case — also terminal here.
  if (code === 'invalid_grant' || /token.*invalid|invalid.*token/i.test(desc)) {
    return new XAuthError(
      `X refresh token rejected (${code || 'invalid'}): ${desc || bodyText.slice(0, 200)}. ` +
        `Re-run the OAuth bootstrap and update the ${'`TWITTER_REFRESH_TOKEN`'} secret.`,
      'needs_reauth',
      status,
    );
  }

  return new XAuthError(
    `X token ${op} failed: ${status} ${code} ${desc || bodyText.slice(0, 200)}`,
    'unknown',
    status,
  );
}

/**
 * Exchange an authorization code for the initial token pair (bootstrap only).
 */
export async function exchangeCode(
  client: XOAuthClient,
  opts: { code: string; redirectUri: string; verifier: string },
  fetchFn: FetchLike = fetch,
): Promise<XTokenResponse> {
  const res = await fetchFn(X_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth(client)}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.verifier,
    }).toString(),
  });

  if (!res.ok) throw await tokenError(res, 'exchange');
  return (await res.json()) as XTokenResponse;
}

/**
 * Perform the refresh_token grant. Returns a fresh access token AND a rotated
 * refresh token; the caller MUST persist the new refresh token before reusing it.
 */
export async function refreshAccessToken(
  client: XOAuthClient,
  refreshToken: string,
  fetchFn: FetchLike = fetch,
): Promise<XTokenResponse> {
  const res = await fetchFn(X_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth(client)}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) throw await tokenError(res, 'refresh');
  return (await res.json()) as XTokenResponse;
}
