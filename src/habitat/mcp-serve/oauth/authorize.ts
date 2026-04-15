/**
 * OAuth authorize endpoint — chains MCP OAuth to upstream service OAuth.
 *
 * Flow:
 * 1. MCP client sends user to GET /oauth/authorize
 * 2. We create an auth session and redirect to upstream OAuth (Twitter, Oura, etc.)
 * 3. Upstream redirects back to /oauth/upstream-callback
 * 4. We exchange the upstream code for tokens, store them, issue MCP auth code
 * 5. Redirect back to MCP client with our auth code
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServeStore, AuthSession, UpstreamOAuthProvider } from '../types.js';
import { json } from './helpers.js';

export async function handleAuthorize(
  upstream: UpstreamOAuthProvider,
  store: McpServeStore,
  baseUrl: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const params = url.searchParams;

  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const responseType = params.get('response_type');
  const codeChallenge = params.get('code_challenge');
  const codeChallengeMethod = params.get('code_challenge_method');
  const state = params.get('state');
  const resource = params.get('resource');

  if (!clientId || !redirectUri || responseType !== 'code' || !codeChallenge || codeChallengeMethod !== 'S256') {
    json(res, { error: 'invalid_request', error_description: 'Missing or invalid required parameters' }, 400);
    return;
  }

  const client = await store.getClient(clientId);
  if (!client) {
    json(res, { error: 'invalid_client', error_description: 'Unknown client_id' }, 400);
    return;
  }

  if (!client.redirect_uris.includes(redirectUri)) {
    json(res, { error: 'invalid_request', error_description: 'redirect_uri not registered for this client' }, 400);
    return;
  }

  const upstreamState = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

  const session: AuthSession = {
    id: randomUUID(),
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    state,
    resource,
    upstream_state: upstreamState,
    mcp_auth_code: null,
    user_id: null,
    created_at: now,
    expires_at: expiresAt,
  };

  await store.createSession(session);

  // Redirect to upstream OAuth
  const callbackUrl = `${baseUrl}/oauth/upstream-callback`;
  const upstreamAuthUrl = upstream.buildAuthorizeUrl(callbackUrl, upstreamState);

  res.writeHead(302, { Location: upstreamAuthUrl });
  res.end();
}

export async function handleUpstreamCallback(
  upstream: UpstreamOAuthProvider,
  store: McpServeStore,
  baseUrl: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const params = url.searchParams;

  const code = params.get('code');
  const upstreamState = params.get('state');
  const upstreamError = params.get('error');

  if (!upstreamState) {
    json(res, { error: 'invalid_request', error_description: 'Missing state parameter' }, 400);
    return;
  }

  const session = await store.getSessionByUpstreamState(upstreamState);
  if (!session) {
    json(res, { error: 'invalid_request', error_description: 'Session not found or expired' }, 400);
    return;
  }

  if (new Date(session.expires_at) < new Date()) {
    json(res, { error: 'invalid_request', error_description: 'Session expired' }, 400);
    return;
  }

  if (upstreamError || !code) {
    const redirectUrl = new URL(session.redirect_uri);
    redirectUrl.searchParams.set('error', 'server_error');
    if (session.state) redirectUrl.searchParams.set('state', session.state);
    res.writeHead(302, { Location: redirectUrl.toString() });
    res.end();
    return;
  }

  // Exchange upstream code for tokens
  const callbackUrl = `${baseUrl}/oauth/upstream-callback`;
  let result: { tokens: import('../types.js').UpstreamTokens; userId: string };
  try {
    result = await upstream.exchangeCode(code, callbackUrl);
  } catch (err) {
    console.error(`Upstream token exchange failed:`, err);
    const redirectUrl = new URL(session.redirect_uri);
    redirectUrl.searchParams.set('error', 'server_error');
    if (session.state) redirectUrl.searchParams.set('state', session.state);
    res.writeHead(302, { Location: redirectUrl.toString() });
    res.end();
    return;
  }

  // Store upstream tokens
  await store.upsertUpstreamTokens(result.userId, result.tokens);

  // Generate MCP auth code and update session
  const mcpAuthCode = randomUUID();
  await store.updateSession(session.id, { user_id: result.userId, mcp_auth_code: mcpAuthCode });

  // Redirect back to MCP client
  const redirectUrl = new URL(session.redirect_uri);
  redirectUrl.searchParams.set('code', mcpAuthCode);
  if (session.state) redirectUrl.searchParams.set('state', session.state);
  res.writeHead(302, { Location: redirectUrl.toString() });
  res.end();
}
