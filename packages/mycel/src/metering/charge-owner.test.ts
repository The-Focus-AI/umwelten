/**
 * Who pays for a request.
 *
 * The chain is End User → Application → Client, and the load-bearing detail is
 * that it stops at the first owner which has ever had a **ledger entry** rather
 * than the first with money. Existence, not solvency — otherwise a user who
 * spent their allowance would be silently promoted back to the pool they were
 * capped away from, which is the exact opposite of what an allowance is for.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore } from "../store/memory-store.js";
import {
  Balances,
  applicationOwner,
  clientOwner,
  endUserOwner,
  resolveChargeOwner,
} from "./balances.js";
import { Operator } from "../operator.js";
import type { Caller } from "../auth/identity.js";

describe("resolveChargeOwner", () => {
  let store: MemoryStore;
  let balances: Balances;
  let caller: Caller;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.setup();
    balances = new Balances(store);

    const operator = new Operator(store);
    await operator.createClient("acme", "Acme");
    const { application } = await operator.createApplication({
      id: "hairstyle-app",
      clientId: "acme",
    });
    caller = { application, subject: "user-1" };
  });

  it("falls through to the Client when nothing below has been funded", async () => {
    // A new signup works without anyone having granted it anything first.
    const owner = await resolveChargeOwner(caller, balances);
    expect(owner).toEqual(clientOwner("acme"));
  });

  it("stops at the Application when that is what was funded", async () => {
    await balances.grant(applicationOwner("hairstyle-app"), 1_000_000);
    expect(await resolveChargeOwner(caller, balances)).toEqual(
      applicationOwner("hairstyle-app"),
    );
  });

  it("stops at the End User once that user has been granted anything", async () => {
    // Granting a user is how you opt them into being capped.
    await balances.grant(applicationOwner("hairstyle-app"), 1_000_000);
    await balances.grant(endUserOwner(caller), 5_000);

    expect(await resolveChargeOwner(caller, balances)).toEqual(endUserOwner(caller));
  });

  it("keeps a spent-out End User capped rather than returning them to the pool", async () => {
    // The whole reason the test is existence and not solvency. A user at zero
    // must be refused, not quietly promoted back to the Client's pool.
    await balances.grant(clientOwner("acme"), 100_000_000);
    await balances.grant(endUserOwner(caller), 5_000);
    await balances.debit(endUserOwner(caller), 5_000, "spent it all");

    expect((await balances.get(endUserOwner(caller))).microDollars).toBe(0);
    expect(await resolveChargeOwner(caller, balances)).toEqual(endUserOwner(caller));
    expect(await balances.canCover(endUserOwner(caller), 1)).toBe(false);
  });

  it("keeps an unfunded user resolving to the Client after it has spent", async () => {
    // The resolved owner is also the one debited, so an unfunded user never
    // acquires an entry of its own — otherwise its first charge would create
    // one and every subsequent request would resolve to a user with a negative
    // balance.
    await balances.grant(clientOwner("acme"), 100_000_000);

    const owner = await resolveChargeOwner(caller, balances);
    await balances.debit(owner, 1_000, "a request");

    expect(await resolveChargeOwner(caller, balances)).toEqual(clientOwner("acme"));
    expect(await balances.exists(endUserOwner(caller))).toBe(false);
  });

  it("keeps two users of one Application separate once both are funded", async () => {
    const other: Caller = { application: caller.application, subject: "user-2" };
    await balances.grant(endUserOwner(caller), 5_000);

    expect(await resolveChargeOwner(caller, balances)).toEqual(endUserOwner(caller));
    // user-2 was never granted, so it still draws from the pool.
    expect(await resolveChargeOwner(other, balances)).toEqual(clientOwner("acme"));
  });

  it("does not let one Application's funding pay for another's user", async () => {
    const operator = new Operator(store);
    await operator.createClient("other-co", "Other Co");
    const { application } = await operator.createApplication({
      id: "other-app",
      clientId: "other-co",
    });
    await balances.grant(applicationOwner("hairstyle-app"), 100_000_000);

    const stranger: Caller = { application, subject: "user-1" };
    expect(await resolveChargeOwner(stranger, balances)).toEqual(clientOwner("other-co"));
  });
});
