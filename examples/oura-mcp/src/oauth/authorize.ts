import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Store, AuthSession } from '../store.js';
import { json } from './helpers.js';

export interface AuthorizeConfig {
  ouraClientId: string;
  ouraClientSecret: string;
  baseUrl: string;
}

export async function handleAuthorize(
  config: AuthorizeConfig, store: Store, req: IncomingMessage, res: ServerResponse
): Promise<void> {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const params = url.searchParams;

  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const responseType = params.get('response_type');
  const codeChallenge = params.get('code_challenge');
  const codeChallengeMethod = params.get('code_challenge_method');
  const state = params.get('state');
  const scope = params.get('scope') ?? 'mcp';
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

  const ouraState = randomUUID();
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
    oura_state: ouraState,
    mcp_auth_code: null,
    user_id: null,
    created_at: now,
    expires_at: expiresAt,
  };

  await store.createSession(session);

  const ouraAuthUrl = new URL('https://cloud.ouraring.com/oauth/authorize');
  ouraAuthUrl.searchParams.set('client_id', config.ouraClientId);
  ouraAuthUrl.searchParams.set('redirect_uri', `${config.baseUrl}/oauth/oura-callback`);
  ouraAuthUrl.searchParams.set('response_type', 'code');
  ouraAuthUrl.searchParams.set('scope', 'daily heartrate personal');
  ouraAuthUrl.searchParams.set('state', ouraState);

  res.writeHead(302, { Location: ouraAuthUrl.toString() });
  res.end();
}

export async function handleOuraCallback(
  config: AuthorizeConfig, store: Store, req: IncomingMessage, res: ServerResponse
): Promise<void> {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const params = url.searchParams;

  const code = params.get('code');
  const ouraState = params.get('state');
  const ouraError = params.get('error');

  if (!ouraState) {
    json(res, { error: 'invalid_request', error_description: 'Missing state parameter' }, 400);
    return;
  }

  const session = await store.getSessionByOuraState(ouraState);
  if (!session) {
    json(res, { error: 'invalid_request', error_description: 'Session not found or expired' }, 400);
    return;
  }

  if (new Date(session.expires_at) < new Date()) {
    json(res, { error: 'invalid_request', error_description: 'Session expired' }, 400);
    return;
  }

  if (ouraError || !code) {
    const redirectUrl = new URL(session.redirect_uri);
    redirectUrl.searchParams.set('error', 'server_error');
    if (session.state) redirectUrl.searchParams.set('state', session.state);
    res.writeHead(302, { Location: redirectUrl.toString() });
    res.end();
    return;
  }

  // Exchange Oura code for tokens
  let tokenData: { access_token: string; refresh_token: string; expires_in?: number; scope?: string };
  try {
    const tokenRes = await fetch('https://api.ouraring.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.ouraClientId,
        client_secret: config.ouraClientSecret,
        redirect_uri: `${config.baseUrl}/oauth/oura-callback`,
      }),
    });

    if (!tokenRes.ok) {
      const redirectUrl = new URL(session.redirect_uri);
      redirectUrl.searchParams.set('error', 'server_error');
      if (session.state) redirectUrl.searchParams.set('state', session.state);
      res.writeHead(302, { Location: redirectUrl.toString() });
      res.end();
      return;
    }

    tokenData = await tokenRes.json() as typeof tokenData;
  } catch {
    const redirectUrl = new URL(session.redirect_uri);
    redirectUrl.searchParams.set('error', 'server_error');
    if (session.state) redirectUrl.searchParams.set('state', session.state);
    res.writeHead(302, { Location: redirectUrl.toString() });
    res.end();
    return;
  }

  // Get user identity from Oura
  let userId: string;
  try {
    const userRes = await fetch('https://api.ouraring.com/v2/usercollection/personal_info', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
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

  // Store Oura tokens
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;
  const scopes = tokenData.scope ?? params.get('scope') ?? undefined;

  await store.upsertOuraTokens(userId, tokenData.access_token, tokenData.refresh_token, expiresAt, scopes);

  // Generate MCP auth code and update session
  const mcpAuthCode = randomUUID();
  await store.updateSession(session.id, { user_id: userId, mcp_auth_code: mcpAuthCode });

  // Redirect back to MCP client
  const redirectUrl = new URL(session.redirect_uri);
  redirectUrl.searchParams.set('code', mcpAuthCode);
  if (session.state) redirectUrl.searchParams.set('state', session.state);
  res.writeHead(302, { Location: redirectUrl.toString() });
  res.end();
}
