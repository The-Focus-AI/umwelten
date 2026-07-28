/**
 * A test Application with a real signing key.
 *
 * Real crypto rather than a stubbed verifier: what #295 is actually asserting
 * is that a forged or expired token is refused, and a fake verifier that
 * returns whatever it is told proves nothing about either.
 */

import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWK } from "jose";
import type { Application } from "../types.js";

const ALG = "ES256";

export interface TestApplicationKeys {
  application: Application;
  /** A key set built from the public key, for injecting into the verifier. */
  keySet: ReturnType<typeof createLocalJWKSet>;
  /** Mint a token for an End User of this Application. */
  sign: (subject: string, opts?: { expiresIn?: string; issuer?: string }) => Promise<string>;
  publicJwk: JWK;
}

export async function makeTestApplication(
  overrides: Partial<Application> = {},
): Promise<TestApplicationKeys> {
  const { publicKey, privateKey } = await generateKeyPair(ALG);
  const publicJwk = await exportJWK(publicKey);

  const application: Application = {
    id: "hairstyle-app",
    clientId: "acme",
    jwksUrl: "https://app.example/.well-known/jwks.json",
    requiredGuarantees: [],
    enabled: true,
    createdAt: new Date("2026-07-28T00:00:00Z"),
    ...overrides,
  };

  return {
    application,
    publicJwk,
    keySet: createLocalJWKSet({ keys: [publicJwk] }),
    sign: (subject, opts = {}) =>
      new SignJWT({})
        .setProtectedHeader({ alg: ALG })
        .setIssuer(opts.issuer ?? application.id)
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime(opts.expiresIn ?? "5m")
        .sign(privateKey),
  };
}
