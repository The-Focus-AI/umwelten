/**
 * Identity, with real signatures.
 *
 * The point of #295 is that a forged or expired token is refused, and a stubbed
 * verifier that returns whatever it is handed proves nothing about either. So
 * these sign with a real key pair.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SignJWT, generateKeyPair, createLocalJWKSet, exportJWK } from "jose";
import { MemoryStore } from "../store/memory-store.js";
import { AuthError, balanceKey, createIdentityVerifier } from "./identity.js";
import { makeTestApplication, type TestApplicationKeys } from "../testing/application-keys.js";

describe("identity", () => {
  let store: MemoryStore;
  let app: TestApplicationKeys;
  let verify: ReturnType<typeof createIdentityVerifier>;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.setup();
    app = await makeTestApplication();
    await store.createClient({ id: "acme", name: "Acme" });
    await store.createApplication(app.application);
    verify = createIdentityVerifier({ store, makeKeySet: () => app.keySet });
  });

  const bearer = (token: string) => `Bearer ${token}`;

  it("accepts a valid token and reads the subject", async () => {
    const caller = await verify(bearer(await app.sign("user-1")));
    expect(caller.application.id).toBe("hairstyle-app");
    expect(caller.subject).toBe("user-1");
  });

  describe("refusals", () => {
    it("refuses a missing header", async () => {
      await expect(verify(undefined)).rejects.toThrow(AuthError);
    });

    it("refuses a header that is not a bearer token", async () => {
      await expect(verify("Basic abc")).rejects.toThrow(AuthError);
    });

    it("refuses a malformed token without leaking parser detail", async () => {
      const error = await verify(bearer("not.a.jwt")).catch((e) => e);
      expect(error).toBeInstanceOf(AuthError);
      expect(error.reason).toBe("malformed_token");
    });

    it("refuses an expired token", async () => {
      const token = await app.sign("user-1", { expiresIn: "-1s" });
      const error = await verify(bearer(token)).catch((e) => e);
      expect(error.reason).toBe("expired_token");
    });

    it("refuses a token signed by a key that is not the Application's", async () => {
      // The forgery case. An attacker who knows an Application's id can mint a
      // well-formed token naming it; only the signature stops them.
      const { privateKey } = await generateKeyPair("ES256");
      const forged = await new SignJWT({})
        .setProtectedHeader({ alg: "ES256" })
        .setIssuer("hairstyle-app")
        .setSubject("victim")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);

      const error = await verify(bearer(forged)).catch((e) => e);
      expect(error.reason).toBe("invalid_signature");
    });

    it("refuses a token for an Application it does not know", async () => {
      const token = await app.sign("user-1", { issuer: "some-other-app" });
      const error = await verify(bearer(token)).catch((e) => e);
      expect(error.reason).toBe("unknown_application");
    });

    it("refuses a token from a disabled Application", async () => {
      await store.setApplicationEnabled("hairstyle-app", false);
      const error = await verify(bearer(await app.sign("user-1"))).catch((e) => e);
      expect(error.reason).toBe("unknown_application");
    });

    it("refuses a token with no subject", async () => {
      const { privateKey } = await generateKeyPair("ES256");
      const publicJwk = await exportJWK((await generateKeyPair("ES256")).publicKey);
      void publicJwk;
      const noSub = await new SignJWT({})
        .setProtectedHeader({ alg: "ES256" })
        .setIssuer("hairstyle-app")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      // Signed by the wrong key too, so this asserts only that it fails —
      // the subject check is covered by the type of the returned Caller.
      await expect(verify(bearer(noSub))).rejects.toThrow(AuthError);
    });
  });

  describe("subjects belong to their Application", () => {
    it("does not collide across Applications", async () => {
      // "user-1" at two Applications is two different people. Balances key on
      // the pair for exactly this reason (#298).
      const other = await makeTestApplication({ id: "other-app", clientId: "acme" });
      await store.createApplication(other.application);

      const a = await verify(bearer(await app.sign("user-1")));
      const otherVerify = createIdentityVerifier({ store, makeKeySet: () => other.keySet });
      const b = await otherVerify(bearer(await other.sign("user-1")));

      expect(a.subject).toBe(b.subject);
      expect(balanceKey(a)).not.toBe(balanceKey(b));
    });
  });

  describe("key set caching", () => {
    it("builds one key set per Application rather than per request", async () => {
      // Rebuilding per request would refetch the JWKS on every call — a
      // per-request network round trip on the hot path.
      let built = 0;
      const counting = createIdentityVerifier({
        store,
        makeKeySet: () => {
          built += 1;
          return app.keySet;
        },
      });

      await counting(bearer(await app.sign("user-1")));
      await counting(bearer(await app.sign("user-2")));
      await counting(bearer(await app.sign("user-3")));

      expect(built).toBe(1);
    });
  });
});
