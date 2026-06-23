// X (Twitter) upstream connector (ADR 0004 §7).
//
// Per-user OAuth 2.0 with PKCE + confidential client. Mirrors the proven flow in
// examples/twitter-habitat/src/x-oauth.ts and the SaaS core (habitats #65), but
// lives in the base server so any habitat with X creds gets the connect flow.
// The refresh token is stored as `TWITTER_REFRESH_TOKEN:<sub>` — the exact key
// the per-user token store reads (umwelten #176).

import type { ExchangeResult, UpstreamConnector } from "./types.js";

export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";

// Read scopes + offline.access so X issues a (rotating) refresh token.
export const X_DEFAULT_SCOPES = [
  "tweet.read",
  "users.read",
  "bookmark.read",
  "list.read",
  "offline.access",
];

export interface XConnectorConfig {
  clientId: string;
  clientSecret: string;
  scopes?: string[];
}

export function createXConnector(cfg: XConnectorConfig): UpstreamConnector {
  const scopes = cfg.scopes ?? X_DEFAULT_SCOPES;
  return {
    name: "x",
    label: "X (Twitter)",
    scopes,
    buildAuthorizeUrl({ redirectUri, state, codeChallenge }) {
      const u = new URL(X_AUTHORIZE_URL);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("client_id", cfg.clientId);
      u.searchParams.set("redirect_uri", redirectUri);
      u.searchParams.set("scope", scopes.join(" "));
      u.searchParams.set("state", state);
      u.searchParams.set("code_challenge", codeChallenge);
      u.searchParams.set("code_challenge_method", "S256");
      return u.toString();
    },
    async exchangeCode({
      code,
      redirectUri,
      codeVerifier,
      fetchImpl,
    }): Promise<ExchangeResult> {
      const f = fetchImpl ?? fetch;
      // Confidential client: Basic auth header; client_id NOT in the body.
      const basic = Buffer.from(
        `${cfg.clientId}:${cfg.clientSecret}`,
      ).toString("base64");
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      });
      const res = await f(X_TOKEN_URL, {
        method: "POST",
        headers: {
          authorization: `Basic ${basic}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `X token exchange failed: ${res.status} ${res.statusText}${
            detail ? ` — ${detail.slice(0, 300)}` : ""
          }`,
        );
      }
      const json = (await res.json()) as { refresh_token?: string };
      if (!json.refresh_token) {
        throw new Error(
          "X token exchange returned no refresh_token (is offline.access in scope?)",
        );
      }
      return { refreshToken: json.refresh_token };
    },
    secretKey(sub: string) {
      return `TWITTER_REFRESH_TOKEN:${sub}`;
    },
  };
}
