/**
 * Verifying who is asking.
 *
 * Per ADR 0014 the Exchange **never authenticates End Users**. It has no login,
 * no password, no session, and no account recovery, and it never sees an end
 * user's credentials. An Application holds a signing key and mints a
 * short-lived token per request; the Exchange verifies the signature against
 * that Application's published keys and reads the subject.
 *
 * The consequence is deliberate rather than guarded against: an Application can
 * mint End Users at will, and the Exchange cannot tell a real person from a
 * fabricated subject — only the Application can. That is why a signup grant
 * must be funded from the owning Client's Balance, so abuse of an Application's
 * signup flow is that Client's cost and that Client's problem to fix.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { Application } from "../types.js";
import type { ExchangeStore } from "../store/types.js";

/** Who the Exchange believes is asking. Everything downstream attributes here. */
export interface Caller {
  application: Application;
  /**
   * The End User, as asserted by the Application. Meaningful only in
   * combination with the Application — two Applications using "user-1" are two
   * different people, which is why Balances are keyed on the pair.
   */
  subject: string;
}

export type AuthFailure =
  | "missing_token"
  | "malformed_token"
  | "unknown_application"
  | "invalid_signature"
  | "expired_token"
  | "missing_subject";

export class AuthError extends Error {
  constructor(readonly reason: AuthFailure) {
    super(reason);
    this.name = "AuthError";
  }
}

/**
 * The key-getter shape jwtVerify accepts, rather than the concrete return of
 * createRemoteJWKSet — a local key set is a valid resolver too, and tying the
 * type to the remote one makes it impossible to inject anything else.
 */
type KeySetResolver = JWTVerifyGetKey;

export interface IdentityVerifierOptions {
  store: ExchangeStore;
  /** Injectable so tests do not have to stand up a real JWKS endpoint. */
  makeKeySet?: (application: Application) => KeySetResolver;
}

export function createIdentityVerifier(opts: IdentityVerifierOptions) {
  const { store } = opts;

  // jose caches and refreshes a remote key set on its own, so one resolver per
  // Application is both the fast path and the correct one — building a new
  // resolver per request would refetch the JWKS on every call.
  const keySets = new Map<string, KeySetResolver>();
  const makeKeySet =
    opts.makeKeySet ?? ((application: Application) => createRemoteJWKSet(new URL(application.jwksUrl)));

  function keySetFor(application: Application): KeySetResolver {
    let resolver = keySets.get(application.id);
    if (!resolver) {
      resolver = makeKeySet(application);
      keySets.set(application.id, resolver);
    }
    return resolver;
  }

  /**
   * @param authorization  The raw Authorization header.
   * @throws AuthError with a reason that is specific in logs and vague to the
   *         caller — a precise 401 body is an oracle for which Applications
   *         exist and which keys are current.
   */
  return async function verifyCaller(authorization: string | undefined): Promise<Caller> {
    if (!authorization?.startsWith("Bearer ")) throw new AuthError("missing_token");
    const token = authorization.slice("Bearer ".length).trim();
    if (!token) throw new AuthError("missing_token");

    // Read the issuer before verifying so we know whose keys to check against.
    // Nothing is trusted from this — it only selects the key set, and a token
    // naming an Application it was not signed by fails the signature check.
    let claimedIssuer: string;
    try {
      const [, payloadPart] = token.split(".");
      const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString()) as JWTPayload;
      if (typeof payload.iss !== "string" || !payload.iss) throw new Error("no iss");
      claimedIssuer = payload.iss;
    } catch {
      throw new AuthError("malformed_token");
    }

    const application = await store.getApplication(claimedIssuer);
    if (!application || !application.enabled) throw new AuthError("unknown_application");

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, keySetFor(application), {
        issuer: application.id,
      }));
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "ERR_JWT_EXPIRED") throw new AuthError("expired_token");
      throw new AuthError("invalid_signature");
    }

    if (typeof payload.sub !== "string" || !payload.sub) throw new AuthError("missing_subject");

    return { application, subject: payload.sub };
  };
}

/** Stable key for anything attributed to an End User of an Application. */
export function balanceKey(caller: Caller): string {
  return `${caller.application.id}:${caller.subject}`;
}
