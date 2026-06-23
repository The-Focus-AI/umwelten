// Sign/verify the OAuth `state` round-trip for the connect flow.
//
// The state is stateless: it carries the claims (sub, provider, PKCE verifier)
// HMAC-signed so the callback can recover them without server-side storage and
// reject tampering/forgery/expiry. Used as the OAuth `state` parameter.

import { createHmac, timingSafeEqual } from "node:crypto";
import { base64url } from "./pkce.js";
import type { ConnectStateClaims } from "./types.js";

const DEFAULT_TTL_SECONDS = 600; // 10 min to complete consent

function sign(body: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(body).digest());
}

/** Encode + sign connect claims into an opaque state token. */
export function signState(
  claims: Omit<ConnectStateClaims, "exp">,
  secret: string,
  nowSeconds: number,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  const full: ConnectStateClaims = {
    ...claims,
    exp: nowSeconds + ttlSeconds,
  };
  const body = base64url(Buffer.from(JSON.stringify(full), "utf8"));
  return `${body}.${sign(body, secret)}`;
}

/** Verify a state token; returns the claims or null (tampered/forged/expired). */
export function verifyState(
  token: string,
  secret: string,
  nowSeconds: number,
): ConnectStateClaims | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(body, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let claims: ConnectStateClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (
    !claims ||
    typeof claims.sub !== "string" ||
    typeof claims.provider !== "string" ||
    typeof claims.verifier !== "string" ||
    typeof claims.exp !== "number"
  ) {
    return null;
  }
  if (claims.exp < nowSeconds) return null;
  return claims;
}
