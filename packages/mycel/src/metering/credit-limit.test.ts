/**
 * Postpaid Clients (ADR 0028).
 *
 * The load-bearing part is *where* the limit applies. A Client may go negative
 * because you have a contract with it; an End User granted an allowance may
 * not, because granting one is how you cap it and a cap that can be exceeded is
 * not a cap.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore } from "../store/memory-store.js";
import {
  Balances,
  applicationOwner,
  clientOwner,
  creditFloorFor,
  endUserOwner,
  resolveChargeOwner,
} from "./balances.js";
import { Operator } from "../operator.js";
import type { Caller } from "../auth/identity.js";

describe("credit limits", () => {
  let store: MemoryStore;
  let balances: Balances;
  let operator: Operator;
  let caller: Caller;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.setup();
    balances = new Balances(store);
    operator = new Operator(store);

    await operator.createClient("acme", "Acme");
    const { application } = await operator.createApplication({
      id: "hairstyle-app",
      clientId: "acme",
    });
    caller = { application, subject: "user-1" };
  });

  it("defaults to prepaid, so existing Clients are unchanged", async () => {
    const floor = await creditFloorFor(clientOwner("acme"), "acme", store);
    expect(floor).toBe(0);
    expect(await balances.canCover(clientOwner("acme"), 1, floor)).toBe(false);
  });

  it("lets a Client with a limit go negative", async () => {
    await store.createClient({ id: "acme", name: "Acme", creditLimitMicroDollars: 10_000_000 });

    const floor = await creditFloorFor(clientOwner("acme"), "acme", store);
    expect(await balances.canCover(clientOwner("acme"), 5_000_000, floor)).toBe(true);
  });

  it("still refuses past the limit", async () => {
    // The limit moves where the wall is; it does not remove the wall.
    await store.createClient({ id: "acme", name: "Acme", creditLimitMicroDollars: 10_000_000 });
    const floor = await creditFloorFor(clientOwner("acme"), "acme", store);

    expect(await balances.canCover(clientOwner("acme"), 10_000_000, floor)).toBe(true);
    expect(await balances.canCover(clientOwner("acme"), 10_000_001, floor)).toBe(false);
  });

  it("does not extend the limit to a capped End User", async () => {
    // The whole reason the floor comes from the resolved owner. Granting a user
    // $5 caps them at $5; the Client's credit line must not quietly lift it.
    await store.createClient({ id: "acme", name: "Acme", creditLimitMicroDollars: 10_000_000 });
    await balances.grant(endUserOwner(caller), 5_000);

    const owner = await resolveChargeOwner(caller, balances);
    expect(owner).toEqual(endUserOwner(caller));

    const floor = await creditFloorFor(owner, "acme", store);
    expect(floor).toBe(0);
    expect(await balances.canCover(owner, 5_001, floor)).toBe(false);
  });

  it("does not extend the limit to an Application balance either", async () => {
    await store.createClient({ id: "acme", name: "Acme", creditLimitMicroDollars: 10_000_000 });
    await balances.grant(applicationOwner("hairstyle-app"), 1_000);

    const owner = await resolveChargeOwner(caller, balances);
    expect(owner).toEqual(applicationOwner("hairstyle-app"));
    expect(await creditFloorFor(owner, "acme", store)).toBe(0);
  });

  it("applies the limit when the charge falls through to the Client", async () => {
    // An unfunded End User draws from the pool behind it, and the pool is the
    // thing that may float.
    await store.createClient({ id: "acme", name: "Acme", creditLimitMicroDollars: 10_000_000 });

    const owner = await resolveChargeOwner(caller, balances);
    expect(owner).toEqual(clientOwner("acme"));

    const floor = await creditFloorFor(owner, "acme", store);
    expect(await balances.canCover(owner, 1_000_000, floor)).toBe(true);
  });

  it("treats a negative Balance as a normal amount owed", async () => {
    await store.createClient({ id: "acme", name: "Acme", creditLimitMicroDollars: 10_000_000 });
    await balances.debit(clientOwner("acme"), 2_000_000, "a month of requests");

    const balance = await balances.get(clientOwner("acme"));
    expect(balance.microDollars).toBe(-2_000_000);
    // Still a sum of entries, never a stored total — which is what makes an
    // invoice reconstructable.
    const entries = await balances.entries(clientOwner("acme"));
    expect(entries.reduce((sum, e) => sum + e.microDollars, 0)).toBe(-2_000_000);
  });
});
