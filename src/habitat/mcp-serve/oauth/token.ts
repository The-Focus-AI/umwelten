/**
 * Token endpoint — exchange MCP auth codes for access/refresh tokens.
 * Handles both authorization_code and refresh_token grants.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import type { McpServeStore } from '../types.js';
import { json } from './helpers.js';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function verifyPKCE(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash('sha256').update(codeVerifier).digest('base64url');
  return computed === codeChallenge;
}

const ACCESS_TOKEN_TTL = 3600;
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60;

async function issueTokens(store: McpServeStore, userId: string, clientId: string) {
  const accessToken = randomUUID();
  const refreshToken = randomUUID();

  const now = Date.now();
  await store.createToken(hashToken(accessToken), userId, clientId, 'access', new Date(now + ACCESS_TOKEN_TTL * 1000));
  await store.createToken(hashToken(refreshToken), userId, clientId, 'refresh', new Date(now + REFRESH_TOKEN_TTL * 1000));

  return { accessToken, refreshToken };
}

async function handleAuthorizationCode(store: McpServeStore, params: URLSearchParams, res: ServerResponse): Promise<void> {
  const code = params.get('code');
  const codeVerifier = params.get('code_verifier');
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');

  if (!code || !codeVerifier || !clientId || !redirectUri) {
    json(res, { error: 'invalid_request', error_description: 'Missing required parameters' }, 400);
    return;
  }

  const session = await store.getSessionByMcpCode(code);
  if (!session) {
    json(res, { error: 'invalid_grant', error_description: 'Authorization code expired or invalid' }, 400);
    return;
  }

  if (new Date(session.expires_at) <= new Date()) {
    await store.deleteSession(session.id);
    json(res, { error: 'invalid_grant', error_description: 'Authorization code expired or invalid' }, 400);
    return;
  }

  if (session.client_id !== clientId) {
    json(res, { error: 'invalid_grant', error_description: 'client_id mismatch' }, 400);
    return;
  }

  if (session.redirect_uri !== redirectUri) {
    json(res, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
    return;
  }

  if (!verifyPKCE(codeVerifier, session.code_challenge)) {
    json(res, { error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
    return;
  }

  const { accessToken, refreshToken } = await issueTokens(store, session.user_id!, clientId);
  await store.deleteSession(session.id);

  json(res, {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: ACCESS_TOKEN_TTL,
    refresh_token: refreshToken,
  });
}

async function handleRefreshToken(store: McpServeStore, params: URLSearchParams, res: ServerResponse): Promise<void> {
  const refreshTokenRaw = params.get('refresh_token');
  const clientId = params.get('client_id');

  if (!refreshTokenRaw || !clientId) {
    json(res, { error: 'invalid_request', error_description: 'Missing required parameters' }, 400);
    return;
  }

  const tokenHash = hashToken(refreshTokenRaw);
  const tokenRow = await store.getTokenByHash(tokenHash);

  if (!tokenRow || tokenRow.token_type !== 'refresh' || new Date(tokenRow.expires_at) <= new Date()) {
    json(res, { error: 'invalid_grant', error_description: 'Refresh token expired or invalid' }, 400);
    return;
  }

  if (tokenRow.client_id !== clientId) {
    json(res, { error: 'invalid_grant', error_description: 'client_id mismatch' }, 400);
    return;
  }

  await store.deleteToken(tokenHash);

  const { accessToken, refreshToken } = await issueTokens(store, tokenRow.user_id, clientId);

  json(res, {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: ACCESS_TOKEN_TTL,
    refresh_token: refreshToken,
  });
}

export async function handleToken(store: McpServeStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await new Promise<string>((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

  const params = new URLSearchParams(body);
  const grantType = params.get('grant_type');

  if (grantType === 'authorization_code') {
    return handleAuthorizationCode(store, params, res);
  }

  if (grantType === 'refresh_token') {
    return handleRefreshToken(store, params, res);
  }

  json(res, { error: 'unsupported_grant_type', error_description: `Unsupported grant_type: ${grantType}` }, 400);
}
