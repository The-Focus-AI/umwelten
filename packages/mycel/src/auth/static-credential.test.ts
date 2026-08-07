/**
 * The static-credential path: an Application that cannot serve a JWKS.
 *
 * The security claim being tested is narrow and worth stating, because it is
 * easy to read this as a downgrade. **The JWT never authenticated the End
 * User** — ADR 0014 has the Exchange trust the Application's assertion of the
 * subject either way. A signature only ever proved *which Application* was
 * calling, and a hashed bearer proves that too.
 *
 * So what must hold here is exactly what held for JWTs: the Application is
 * authenticated, the subject is scoped to it, and a wrong or disabled
 * credential gets nothing.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore } from "../store/memory-store.js";
import { AuthError, createIdentityVerifier } from "./identity.js";
import { CREDENTIAL_PREFIX } from "./credentials.js";
import { Operator } from "../operator.js";

describe("static credentials", () => {
  let store: MemoryStore;
  let operator: Operator;
  let verify: ReturnType<typeof createIdentityVerifier>;
  let credential: string;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.setup();
    operator = new Operator(store);
    await operator.createClient("the-focus-ai", "The Focus AI");
    const created = await operator.createApplication({
      id: "help-habitat",
      clientId: "the-focus-ai",
    });
    credential = created.credential!;
    verify = createIdentityVerifier({ store });
  });

  const bearer = (token: string) => `Bearer ${token}`;

  it("issues a credential exactly once, and stores only its hash", async () => {
    expect(credential.startsWith(CREDENTIAL_PREFIX)).toBe(true);

    const stored = await store.getApplication("help-habitat");
    expect(stored?.credentialHash).toBeTruthy();
    // The credential itself is never recoverable — an Application that loses
    // one rotates rather than looks it up.
    expect(JSON.stringify(stored)).not.toContain(credential);
  });

  it("authenticates the Application and reads the asserted End User", async () => {
    const caller = await verify(bearer(credential), "user-1234");
    expect(caller.application.id).toBe("help-habitat");
    expect(caller.subject).toBe("user-1234");
  });

  it("refuses a request with no End User header", async () => {
    // No implicit fallback to the Application's own id: an Application that
    // forgot the header would otherwise have its whole estate attributed to a
    // single subject, and per-user caps would silently stop being per-user.
    await expect(verify(bearer(credential))).rejects.toThrow(AuthError);
    await expect(verify(bearer(credential), "   ")).rejects.toThrow(AuthError);
  });

  it("refuses a credential that was never issued", async () => {
    await expect(verify(bearer(`${CREDENTIAL_PREFIX}nonsense`), "user-1")).rejects.toThrow(
      AuthError,
    );
  });

  it("refuses a disabled Application's credential", async () => {
    await operator.setApplicationEnabled("help-habitat", false);
    await expect(verify(bearer(credential), "user-1")).rejects.toThrow(AuthError);
  });

  it("stops accepting the old credential after a rotation", async () => {
    const rotated = await operator.rotateApplicationCredential("help-habitat");

    expect(await verify(bearer(rotated), "user-1")).toBeTruthy();
    await expect(verify(bearer(credential), "user-1")).rejects.toThrow(AuthError);
  });

  it("keeps subjects scoped to the Application that asserted them", async () => {
    // "user-1" at two Applications is two different people. This is the whole
    // reason Balances key on the pair.
    const other = await operator.createApplication({
      id: "other-app",
      clientId: "the-focus-ai",
    });

    const a = await verify(bearer(credential), "user-1");
    const b = await verify(bearer(other.credential!), "user-1");

    expect(a.subject).toBe(b.subject);
    expect(a.application.id).not.toBe(b.application.id);
  });

  it("does not let one Application present another's credential", async () => {
    const other = await operator.createApplication({ id: "other-app", clientId: "the-focus-ai" });
    // The credential decides which Application is calling — there is nothing
    // caller-supplied that selects it, which is why there is no confused
    // deputy here.
    const caller = await verify(bearer(other.credential!), "user-1");
    expect(caller.application.id).toBe("other-app");
  });

  it("does not treat a malformed JWT as a credential lookup", async () => {
    // Dispatch is on the prefix, not on "does this look like a JWT", so a
    // broken token fails as a broken token instead of falling through to a
    // lookup that could never match.
    await expect(verify(bearer("not.a.jwt"), "user-1")).rejects.toMatchObject({
      reason: "malformed_token",
    });
  });

  it("refuses an application whose client does not exist", async () => {
    // An Application with no Client has nobody to invoice and nowhere to draw
    // a grant from, so it is refused at creation rather than left orphaned.
    await expect(
      operator.createApplication({ id: "orphan", clientId: "nobody" }),
    ).rejects.toThrow(/Unknown client/);
  });

  it("gives a JWKS Application no credential", async () => {
    const jwks = await operator.createApplication({
      id: "saas",
      clientId: "the-focus-ai",
      jwksUrl: "https://saas.example/.well-known/jwks.json",
    });
    expect(jwks.credential).toBeUndefined();
    expect(jwks.application.credentialHash).toBeUndefined();
  });
});
