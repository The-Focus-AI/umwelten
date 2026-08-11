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
    kind: "vendor",
    grantedGuarantees: ["on-premise", "no-training"],
    credentialHash: "hash-office",
    baseUrl: "http://127.0.0.1:9/v1",
    upstreamCredentialEnv: "OFFICE_SPARK_KEY",
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
      { concurrency: 4, ttftMs: 900, tokensPerSecond: 310, decodeTokensPerSecond: 88 },
    ],
    headroomMeta: {
      sampledAt: "2026-07-28T00:00:00.000Z",
      coldStartMs: 18_400,
      coldStartFirstTouch: true,
      saturation: "batches",
    },
    contextTokens: 131072,
    quantization: "Q4_K_M",
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
        expect(found?.baseUrl).toBe("http://127.0.0.1:9/v1");
        // The env var *name*, never the secret — a database compromise must
        // not hand over the keys we buy with.
        expect(found?.upstreamCredentialEnv).toBe("OFFICE_SPARK_KEY");
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

      it("round-trips a machine Supplier that dials in", async () => {
        // An agent has no address to register — that is the point of ADR 0023,
        // so a blank baseUrl has to survive the round trip rather than being
        // treated as a missing field.
        await store.createSupplier(
          supplierFixture({ id: "thor", kind: "agent", baseUrl: "" }),
        );

        const found = await store.getSupplier("thor");
        expect(found?.kind).toBe("agent");
        expect(found?.baseUrl).toBe("");
      });

      it("reads a Supplier stored before dial-in existed as a vendor", async () => {
        // The column defaults rather than backfills, so a Supplier written by
        // an older version keeps behaving exactly as it did — dialled out to.
        await store.createSupplier(supplierFixture());

        const found = await store.getSupplier("office-spark");
        expect(found?.kind).toBe("vendor");
      });
    });

    describe("publishing offers", () => {
      beforeEach(async () => {
        await store.createSupplier(supplierFixture());
      });

      it("carries the Supplier's kind onto every Offer", async () => {
        // Dispatch receives Offers and no Supplier records, so it has to be
        // able to tell a machine from a vendor without a second lookup — the
        // same arrangement `guarantees` already uses.
        await store.createSupplier(
          supplierFixture({ id: "thor", kind: "agent", baseUrl: "", credentialHash: "hash-thor" }),
        );
        await store.replaceOffers("thor", [offerFixture()]);

        await store.replaceOffers("office-spark", [offerFixture()]);

        expect((await store.getOffer("thor", "gemma-4-26b"))?.supplierKind).toBe("agent");
        expect((await store.getOffer("office-spark", "gemma-4-26b"))?.supplierKind).toBe("vendor");
      });

      it("stores what was published, verbatim", async () => {
        await store.replaceOffers("office-spark", [offerFixture()]);

        const offer = await store.getOffer("office-spark", "gemma-4-26b");
        expect(offer?.capabilities).toEqual(["chat", "streaming", "tool-calling"]);
        expect(offer?.servingMode).toBe("managed");
        expect(offer?.contextTokens).toBe(131072);
        expect(offer?.headroom).toHaveLength(2);
        expect(offer?.headroom[0].tokensPerSecond).toBe(94);
        // Only a managed Offer can say what quantization is behind it.
        expect(offer?.quantization).toBe("Q4_K_M");
      });

      it("keeps how the Headroom was measured, not just the numbers", async () => {
        // Two Suppliers' throughput figures are only comparable if they were
        // sampled the same way, so the sampling context travels with them.
        await store.replaceOffers("office-spark", [offerFixture()]);

        const offer = await store.getOffer("office-spark", "gemma-4-26b");
        expect(offer?.headroomMeta?.saturation).toBe("batches");
        // Cold-start is the difference between a warm Offer and a sleeping one.
        expect(offer?.headroomMeta?.coldStartMs).toBe(18_400);
      });

      it("publishes an Offer whose Headroom sample failed, with the failure visible", async () => {
        // Withholding it would have Dispatch route around a Model that serves
        // fine. "Throughput unknown" is a weighable fact; absence is not.
        await store.replaceOffers("office-spark", [
          offerFixture({
            headroom: [],
            headroomMeta: {
              sampledAt: "2026-07-28T00:00:00.000Z",
              coldStartFirstTouch: true,
              saturation: "inconclusive",
              failed: "every sample errored or produced no tokens",
            },
          }),
        ]);

        const offer = await store.getOffer("office-spark", "gemma-4-26b");
        expect(offer).not.toBeNull();
        expect(offer?.headroom).toEqual([]);
        expect(offer?.headroomMeta?.failed).toContain("errored");
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

    describe("clients and applications", () => {
      it("round-trips an application", async () => {
        await store.createClient({ id: "acme", name: "Acme" });
        await store.createApplication({
          id: "hairstyle",
          clientId: "acme",
          jwksUrl: "https://app.example/jwks.json",
          requiredGuarantees: ["on-premise"],
          allowedModels: ["gemma-4-26b"],
          enabled: true,
          createdAt: new Date("2026-07-28T00:00:00Z"),
        });

        const found = await store.getApplication("hairstyle");
        expect(found?.clientId).toBe("acme");
        expect(found?.jwksUrl).toBe("https://app.example/jwks.json");
        expect(found?.requiredGuarantees).toEqual(["on-premise"]);
        expect(found?.allowedModels).toEqual(["gemma-4-26b"]);
      });

      it("distinguishes an unset allowedModels from an empty one", async () => {
        // Unset means "any Model"; empty means "none". Collapsing them would
        // either open an Application up or lock it out.
        await store.createClient({ id: "acme", name: "Acme" });
        await store.createApplication({
          id: "open",
          clientId: "acme",
          jwksUrl: "https://x/jwks",
          requiredGuarantees: [],
          enabled: true,
          createdAt: new Date(),
        });
        await store.createApplication({
          id: "closed",
          clientId: "acme",
          jwksUrl: "https://x/jwks",
          requiredGuarantees: [],
          allowedModels: [],
          enabled: true,
          createdAt: new Date(),
        });

        expect((await store.getApplication("open"))?.allowedModels).toBeUndefined();
        expect((await store.getApplication("closed"))?.allowedModels).toEqual([]);
      });

      it("returns null for an unknown application", async () => {
        expect(await store.getApplication("nobody")).toBeNull();
      });

      it("disables an application without losing it", async () => {
        await store.createClient({ id: "acme", name: "Acme" });
        await store.createApplication({
          id: "app",
          clientId: "acme",
          jwksUrl: "https://x/jwks",
          requiredGuarantees: [],
          enabled: true,
          createdAt: new Date(),
        });
        await store.setApplicationEnabled("app", false);

        expect((await store.getApplication("app"))?.enabled).toBe(false);
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
