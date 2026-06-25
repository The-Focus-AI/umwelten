/**
 * JWT auth — verify a per-user signed bearer grant and resolve the speaking user.
 *
 * This replaces the shared-secret `bearerAuth` (HABITAT_API_KEY) on the A2A /
 * `/api/*` / `/mcp` surface. The caller (the habitats SaaS) mints a short-lived
 * JWT *per request, signed for the user who spoke that message*; this provider
 * verifies the signature (asymmetric — the habitat holds no minting secret) and
 * returns that user as the `UserContext`. The verified `sub` becomes
 * `interaction.userId` and the key for per-user upstream (e.g. X) tokens.
 *
 * See docs/adr/0003-per-user-a2a-identity.md.
 *
 * Security invariants (do not weaken):
 *  - asymmetric only — reject `alg:none` and symmetric (HS*) algs;
 *  - enforce `aud` (this habitat) and `exp` (jose checks exp by default);
 *  - verify the signature against the configured JWKS / pinned public key only.
 */

import type { IncomingMessage } from 'node:http';
import { createPublicKey } from 'node:crypto';
import {
  createRemoteJWKSet,
  importSPKI,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import type { AuthProvider, UserContext } from '../types.js';

/** The JWS `alg` to import a pinned SPKI key under, derived from the key's own type. */
function algForPublicKey(pem: string): string {
  const type = createPublicKey(pem).asymmetricKeyType;
  switch (type) {
    case 'ec':
      return 'ES256';
    case 'ed25519':
      return 'EdDSA';
    case 'rsa':
    case 'rsa-pss':
      return 'RS256';
    default:
      return 'RS256';
  }
}

/** Asymmetric algorithms we accept. Symmetric (HS*) and `none` are rejected. */
const ALLOWED_ALGS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'PS256', 'PS384', 'PS512'];

export interface JwtAuthOptions {
  /** Expected `aud` — this habitat's id/url. Tokens for another audience are rejected. */
  audience: string;
  /** Expected `iss` — the habitats SaaS issuer. Optional but recommended. */
  issuer?: string;
  /**
   * Where to get the verification key. Provide exactly one:
   *  - `jwksUrl`: the SaaS's JWKS endpoint (preferred — supports key rotation), or
   *  - `publicKeyPem`: a pinned SPKI PEM public key.
   */
  jwksUrl?: string;
  publicKeyPem?: string;
  /** Override the allowed algs (defaults to the asymmetric set above). */
  algorithms?: string[];
  /** Clock tolerance in seconds for `exp`/`nbf` skew. Default 5s. */
  clockToleranceSec?: number;
}

/** Claims we read off a verified token (in addition to the registered ones). */
interface HabitatJwtPayload extends JWTPayload {
  /** Optional display name for speaker-labeling in multi-user threads. */
  name?: string;
  /** Optional email. */
  email?: string;
  /** Optional org id (habitats is org-scoped). */
  org?: string;
  /**
   * Operator grant (ADR 0004): the issuer (habitats SaaS) asserts this caller
   * is a habitat operator/admin and may set the credentials the habitat
   * declares in config.requiredSecrets. Minted only for habitat mutators.
   */
  operator?: boolean;
}

/**
 * Build a JWT-verifying {@link AuthProvider}.
 *
 * @throws if neither `jwksUrl` nor `publicKeyPem` is provided (misconfiguration —
 *   fail loud at startup rather than silently accepting nothing).
 */
export function jwtAuth(opts: JwtAuthOptions): AuthProvider {
  if (!opts.jwksUrl && !opts.publicKeyPem) {
    throw new Error(
      'jwtAuth requires either jwksUrl or publicKeyPem to verify tokens against.',
    );
  }
  if (opts.jwksUrl && opts.publicKeyPem) {
    throw new Error('jwtAuth: provide only one of jwksUrl or publicKeyPem, not both.');
  }

  const algorithms = opts.algorithms ?? ALLOWED_ALGS;
  const clockTolerance = opts.clockToleranceSec ?? 5;

  // Resolve the key material lazily so a bad URL/PEM fails on first request with a
  // clear error rather than at module load. JWKS sets cache + rotate internally;
  // the pinned key is imported once. The two paths are kept separate so each
  // jwtVerify() call has a concrete key type (a union confuses its overloads).
  let jwks: JWTVerifyGetKey | undefined;
  let spki: Promise<CryptoKey> | undefined;

  return {
    name: 'jwt',
    async authenticate(req: IncomingMessage): Promise<UserContext | null> {
      const header = req.headers.authorization;
      if (!header) return null;
      const [scheme, token] = header.split(' ', 2);
      if (scheme?.toLowerCase() !== 'bearer' || !token) return null;

      const verifyOpts = {
        audience: opts.audience,
        issuer: opts.issuer,
        algorithms,
        clockTolerance,
      };

      try {
        let payload: JWTPayload;
        if (opts.jwksUrl) {
          jwks ??= createRemoteJWKSet(new URL(opts.jwksUrl));
          ({ payload } = await jwtVerify(token, jwks, verifyOpts));
        } else {
          spki ??= importSPKI(opts.publicKeyPem!, algForPublicKey(opts.publicKeyPem!));
          ({ payload } = await jwtVerify(token, await spki, verifyOpts));
        }

        const claims = payload as HabitatJwtPayload;
        if (!claims.sub) return null; // a grant with no subject is not a user

        return {
          userId: claims.sub,
          displayName: claims.name,
          email: claims.email,
          provider: 'oauth',
          operator: claims.operator === true,
        };
      } catch {
        // Invalid signature / aud / exp / alg → unauthenticated. The caller (the
        // server) decides whether to 401. Never throw — a malformed token is a
        // failed auth, not a server error.
        return null;
      }
    },
  };
}
