import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore } from "../store/memory-store.js";
import { Balances, applicationOwner, endUserOwner } from "./balances.js";
import type { Caller } from "../auth/identity.js";
import type { Application } from "../types.js";

const application = (id: string): Application => ({
  id,
  clientId: "acme",
  jwksUrl: "https://x/jwks",
  requiredGuarantees: [],
  enabled: true,
  createdAt: new Date(),
});

const caller = (appId: string, subject: string): Caller => ({
  application: application(appId),
  subject,
});

describe("Balances", () => {
  let store: MemoryStore;
  let balances: Balances;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.setup();
    balances = new Balances(store);
  });

  it("starts an unknown owner at zero rather than absent", async () => {
    // There is nothing to create before someone can be granted credit.
    const balance = await balances.get(applicationOwner("never-seen"));
    expect(balance.microDollars).toBe(0);
  });

  it("is the sum of its entries", async () => {
    const owner = applicationOwner("app");
    await balances.grant(owner, 1_000);
    await balances.grant(owner, 500);
    await balances.debit(owner, 200, "req-1");

    expect((await balances.get(owner)).microDollars).toBe(1_300);
  });

  it("never overwrites a total — every movement is its own entry", async () => {
    // History has to be reconstructable, and a disputed charge has to trace
    // back to the request that caused it.
    const owner = applicationOwner("app");
    await balances.grant(owner, 1_000, "signup");
    await balances.debit(owner, 250, "req-1");

    const entries = await balances.entries(owner);
    expect(entries).toHaveLength(2);
    expect(entries[0].microDollars).toBe(1_000);
    expect(entries[1].microDollars).toBe(-250);
    expect(entries[1].requestId).toBe("req-1");
  });

  it("records a grant as an ordinary entry", async () => {
    // No privileged path writes a total directly, so an operator's grant is as
    // auditable as a debit.
    const owner = applicationOwner("app");
    await balances.grant(owner, 10_000, "promo");

    const [entry] = await balances.entries(owner);
    expect(entry.reason).toBe("promo");
    expect(entry.microDollars).toBe(10_000);
  });

  describe("owners are distinct", () => {
    it("keeps an Application's Balance separate from its End Users'", async () => {
      // So internal jobs never spend a user's credit.
      const app = applicationOwner("hairstyle");
      const user = endUserOwner(caller("hairstyle", "user-1"));

      await balances.grant(app, 5_000);
      expect((await balances.get(user)).microDollars).toBe(0);
    });

    it("does not collide the same subject across Applications", async () => {
      // "user-1" at two Applications is two different people.
      const a = endUserOwner(caller("app-a", "user-1"));
      const b = endUserOwner(caller("app-b", "user-1"));

      await balances.grant(a, 5_000);
      expect((await balances.get(b)).microDollars).toBe(0);
    });
  });

  describe("canCover", () => {
    it("is true when the balance exactly matches", async () => {
      const owner = applicationOwner("app");
      await balances.grant(owner, 100);
      expect(await balances.canCover(owner, 100)).toBe(true);
    });

    it("is false one micro-dollar short", async () => {
      const owner = applicationOwner("app");
      await balances.grant(owner, 99);
      expect(await balances.canCover(owner, 100)).toBe(false);
    });

    it("is false at zero", async () => {
      expect(await balances.canCover(applicationOwner("app"), 1)).toBe(false);
    });
  });
});
