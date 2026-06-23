// Upstream connectors (ADR 0004 §7 — "the agent owns its upstream connections").
//
// A habitat exposes a generic per-user OAuth connect flow on its own surface so
// a speaking user can link a third-party account (X, Google, …) to THEIR id.
// The resulting refresh token is stored per-`sub` (`secretKey(sub)`) and read by
// tools via the per-user token store (umwelten #176). The base server owns the
// /connect routes; connectors are pluggable providers registered on the habitat.

export interface ExchangeResult {
  /** The long-lived refresh token to persist (per-sub). */
  refreshToken: string;
}

export interface UpstreamConnector {
  /** URL-safe provider id, e.g. "x". */
  name: string;
  /** Human label for the consent/success UI. */
  label: string;
  /** OAuth scopes requested. */
  scopes: string[];
  /** Build the provider's authorize URL (PKCE S256). */
  buildAuthorizeUrl(args: {
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }): string;
  /** Exchange an authorization code for tokens (confidential client + PKCE). */
  exchangeCode(args: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
    fetchImpl?: typeof fetch;
  }): Promise<ExchangeResult>;
  /** Habitat secret name the refresh token is stored under, keyed by speaker. */
  secretKey(sub: string): string;
}

/** Claims carried (HMAC-signed) through the OAuth `state` round-trip. */
export interface ConnectStateClaims {
  /** The speaking user this connection belongs to. */
  sub: string;
  /** Provider name (must match the callback path). */
  provider: string;
  /** PKCE verifier (recovered on callback to complete the exchange). */
  verifier: string;
  /** Expiry (epoch seconds) — short-lived. */
  exp: number;
}
