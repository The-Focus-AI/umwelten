// Upstream-connect request logic (ADR 0004 §7), kept separate from the HTTP
// plumbing in container-server so it's unit-testable. The base server owns the
// routes:
//   GET /connect/:provider          → start: verify the speaker, redirect to the
//                                      provider's authorize URL (PKCE + signed state)
//   GET /connect/:provider/callback → finish: verify state, exchange the code,
//                                      store the refresh token as secretKey(sub)

import { createPkcePair } from "../connectors/pkce.js";
import { signState, verifyState } from "../connectors/state.js";
import type { UpstreamConnector } from "../connectors/types.js";

/** Build the exact redirect URI the provider must call back (and we registered). */
export function callbackUri(publicBaseUrl: string, provider: string): string {
  return `${publicBaseUrl.replace(/\/$/, "")}/connect/${provider}/callback`;
}

/** Start: produce the provider authorize URL for this speaker. */
export function startConnect(args: {
  connector: UpstreamConnector;
  sub: string;
  publicBaseUrl: string;
  secret: string;
  nowSeconds: number;
}): { authorizeUrl: string } {
  const { connector, sub, publicBaseUrl, secret, nowSeconds } = args;
  const redirectUri = callbackUri(publicBaseUrl, connector.name);
  const { verifier, challenge } = createPkcePair();
  const state = signState(
    { sub, provider: connector.name, verifier },
    secret,
    nowSeconds,
  );
  const authorizeUrl = connector.buildAuthorizeUrl({
    redirectUri,
    state,
    codeChallenge: challenge,
  });
  return { authorizeUrl };
}

export type CompleteResult =
  | { ok: true; provider: string; sub: string }
  | { ok: false; status: number; message: string };

/** Finish: verify state, exchange the code, persist the refresh token per-sub. */
export async function completeConnect(args: {
  connector: UpstreamConnector;
  provider: string;
  query: Record<string, string>;
  publicBaseUrl: string;
  secret: string;
  nowSeconds: number;
  setSecret: (name: string, value: string) => Promise<void> | void;
  fetchImpl?: typeof fetch;
}): Promise<CompleteResult> {
  const {
    connector,
    provider,
    query,
    publicBaseUrl,
    secret,
    nowSeconds,
    setSecret,
    fetchImpl,
  } = args;

  if (query.error) {
    return { ok: false, status: 400, message: `provider error: ${query.error}` };
  }
  const code = query.code;
  const state = query.state;
  if (!code || !state) {
    return { ok: false, status: 400, message: "missing code or state" };
  }
  const claims = verifyState(state, secret, nowSeconds);
  if (!claims) {
    return { ok: false, status: 400, message: "invalid or expired state" };
  }
  // The state's provider must match the callback path — no cross-provider replay.
  if (claims.provider !== provider) {
    return { ok: false, status: 400, message: "state/provider mismatch" };
  }

  const redirectUri = callbackUri(publicBaseUrl, provider);
  let refreshToken: string;
  try {
    const out = await connector.exchangeCode({
      code,
      redirectUri,
      codeVerifier: claims.verifier,
      fetchImpl,
    });
    refreshToken = out.refreshToken;
  } catch (err) {
    return {
      ok: false,
      status: 502,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  await setSecret(connector.secretKey(claims.sub), refreshToken);
  return { ok: true, provider, sub: claims.sub };
}
