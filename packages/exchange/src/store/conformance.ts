/**
 * One suite, both implementations.
 *
 * `MemoryStore` runs it under `pnpm test:run`; `NeonStore` runs it under
 * `pnpm test:integration` when a connection string is present. Anything
 * asserted here is part of the ExchangeStore contract, and a difference
 * between the two is a bug in whichever one is surprising.
 *
 * Exported as a function rather than a test file so both callers can supply
 * their own fresh-store factory and cleanup.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_PRICING } from "../types.js";
import type { PublishedOffer, Supplier } from "../types.js";
import type { ExchangeStore } from "./types.js";

export function supplierFixture(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: "office-spark",
    displayName: "Office DGX Spark",
    grantedGuarantees: ["on-premise", "no-training"],
    credentialHash: "hash-office",
    enabled: true,
    createdAt: new Date("2026-07-26T00:00:00Z"),
    ...overrides,
  };
}

export function offerFixture(overrides: Partial<PublishedOffer> = {}): PublishedOffer {
  return {
    model: "gemma-4-26b",
    capabilities: ["chat", "streaming", "tool-calling"],
    servingMode: "managed",
    headroom: [
      { concurrency: 1, ttftMs: 300, tokensPerSecond: 94, decodeTokensPerSecond: 114 },
    ],
    contextTokens: 131072,
    ...overrides,
  };
}

/**
 * @param makeStore  Returns a store with no data in it. Called before each test.
 */
export function runExchangeStoreConformance(
  name: string,
  makeStore: () => Promise<ExchangeStore>,
): void {
  describe(`ExchangeStore conformance — ${name}`, () => {
    let store: ExchangeStore;

    beforeEach(async () => {
      store = await makeStore();
      await store.setup();
    });

    describe("suppliers", () => {
      it("round-trips a supplier", async () => {
        const supplier = supplierFixture();
        await store.createSupplier(supplier);

        const found = await store.getSupplier(supplier.id);
        expect(found?.displayName).toBe("Office DGX Spark");
        expect(found?.grantedGuarantees).toEqual(["on-premise", "no-training"]);
        expect(found?.enabled).toBe(true);
      });

      it("returns null for an unknown supplier", async () => {
        expect(await store.getSupplier("nobody")).toBeNull();
      });

      it("resolves a supplier by credential hash", async () => {
        await store.createSupplier(supplierFixture({ credentialHash: "hash-a" }));
        const found = await store.getSupplierByCredentialHash("hash-a");
        expect(found?.id).toBe("office-spark");
      });

      it("returns null for an unknown credential hash", async () => {
        await store.createSupplier(supplierFixture({ credentialHash: "hash-a" }));
        expect(await store.getSupplierByCredentialHash("hash-b")).toBeNull();
      });

      it("disables a supplier without losing it", async () => {
        await store.createSupplier(supplierFixture());
        await store.setSupplierEnabled("office-spark", false);

        const found = await store.getSupplier("office-spark");
        expect(found).not.toBeNull();
        expect(found?.enabled).toBe(false);
      });
    });

    describe("publishing offers", () => {
      beforeEach(async () => {
        await store.createSupplier(supplierFixture());
      });

      it("stores what was published, verbatim", async () => {
        await store.replaceOffers("office-spark", [offerFixture()]);

        const offer = await store.getOffer("office-spark", "gemma-4-26b");
        expect(offer?.capabilities).toEqual(["chat", "streaming", "tool-calling"]);
        expect(offer?.servingMode).toBe("managed");
        expect(offer?.contextTokens).toBe(131072);
        expect(offer?.headroom).toHaveLength(1);
        expect(offer?.headroom[0].tokensPerSecond).toBe(94);
      });

      it("applies default pricing to a newly published offer", async () => {
        await store.replaceOffers("office-spark", [offerFixture()]);

        const offer = await store.getOffer("office-spark", "gemma-4-26b");
        expect(offer?.wholesalePromptPerMillion).toBe(DEFAULT_PRICING.wholesalePromptPerMillion);
        expect(offer?.retailPromptPerMillion).toBe(DEFAULT_PRICING.retailPromptPerMillion);
      });

      it("replaces rather than accumulates on republish", async () => {
        await store.replaceOffers("office-spark", [
          offerFixture({ model: "gemma-4-26b" }),
          offerFixture({ model: "gemma-4-31b" }),
        ]);
        await store.replaceOffers("office-spark", [offerFixture({ model: "gemma-4-26b" })]);

        const offers = await store.listOffersBySupplier("office-spark");
        expect(offers.map((o) => o.model)).toEqual(["gemma-4-26b"]);
      });

      it("removes an offer the supplier stopped listing", async () => {
        await store.replaceOffers("office-spark", [offerFixture({ model: "gone" })]);
        await store.replaceOffers("office-spark", []);

        expect(await store.getOffer("office-spark", "gone")).toBeNull();
      });

      it("updates capabilities when a re-probe finds different ones", async () => {
        await store.replaceOffers("office-spark", [
          offerFixture({ capabilities: ["chat"] }),
        ]);
        await store.replaceOffers("office-spark", [
          offerFixture({ capabilities: ["chat", "structured-output"] }),
        ]);

        const offer = await store.getOffer("office-spark", "gemma-4-26b");
        expect(offer?.capabilities).toEqual(["chat", "structured-output"]);
      });

      it("does not disturb another supplier's offers", async () => {
        await store.createSupplier(
          supplierFixture({ id: "vendor", credentialHash: "hash-vendor" }),
        );
        await store.replaceOffers("vendor", [offerFixture({ model: "gpt-5-nano" })]);
        await store.replaceOffers("office-spark", [offerFixture()]);

        const vendorOffers = await store.listOffersBySupplier("vendor");
        expect(vendorOffers.map((o) => o.model)).toEqual(["gpt-5-nano"]);
      });
    });

    describe("pricing", () => {
      beforeEach(async () => {
        await store.createSupplier(supplierFixture());
        await store.replaceOffers("office-spark", [offerFixture()]);
      });

      it("applies operator pricing to an existing offer", async () => {
        await store.setOfferPricing("office-spark", "gemma-4-26b", {
          wholesalePromptPerMillion: 0,
          wholesaleCompletionPerMillion: 0,
          retailPromptPerMillion: 50_000,
          retailCompletionPerMillion: 150_000,
        });

        const offer = await store.getOffer("office-spark", "gemma-4-26b");
        expect(offer?.retailPromptPerMillion).toBe(50_000);
        expect(offer?.retailCompletionPerMillion).toBe(150_000);
      });

      it("keeps operator pricing across a republish", async () => {
        // The point of the test: re-probing must not silently reset an
        // operator's prices back to the default.
        await store.setOfferPricing("office-spark", "gemma-4-26b", {
          wholesalePromptPerMillion: 1,
          wholesaleCompletionPerMillion: 2,
          retailPromptPerMillion: 3,
          retailCompletionPerMillion: 4,
        });
        await store.replaceOffers("office-spark", [
          offerFixture({ capabilities: ["chat"] }),
        ]);

        const offer = await store.getOffer("office-spark", "gemma-4-26b");
        expect(offer?.retailPromptPerMillion).toBe(3);
        expect(offer?.retailCompletionPerMillion).toBe(4);
      });
    });

    describe("listing what dispatch can select from", () => {
      it("omits offers from a disabled supplier", async () => {
        await store.createSupplier(supplierFixture());
        await store.replaceOffers("office-spark", [offerFixture()]);
        await store.setSupplierEnabled("office-spark", false);

        expect(await store.listOffers()).toEqual([]);
        // Still retrievable directly — disabling hides, it does not delete.
        expect(await store.listOffersBySupplier("office-spark")).toHaveLength(1);
      });

      it("reports an offer disabled by the operator", async () => {
        await store.createSupplier(supplierFixture());
        await store.replaceOffers("office-spark", [offerFixture()]);
        await store.setOfferEnabled("office-spark", "gemma-4-26b", false);

        const offers = await store.listOffers();
        expect(offers).toHaveLength(1);
        expect(offers[0].enabled).toBe(false);
      });

      it("spans suppliers", async () => {
        await store.createSupplier(supplierFixture());
        await store.createSupplier(
          supplierFixture({ id: "vendor", credentialHash: "hash-vendor" }),
        );
        await store.replaceOffers("office-spark", [offerFixture()]);
        await store.replaceOffers("vendor", [offerFixture({ model: "gpt-5-nano" })]);

        const offers = await store.listOffers();
        expect(offers.map((o) => `${o.supplierId}:${o.model}`)).toEqual([
          "office-spark:gemma-4-26b",
          "vendor:gpt-5-nano",
        ]);
      });
    });
  });
}
