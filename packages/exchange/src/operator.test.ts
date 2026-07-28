import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore } from "./store/memory-store.js";
import { GuaranteeNotGrantedError, Operator } from "./operator.js";
import { hashCredential } from "./supply/handler.js";
import { offerFixture } from "./store/conformance.js";

describe("Operator", () => {
  let store: MemoryStore;
  let operator: Operator;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.setup();
    operator = new Operator(store);
  });

  describe("registering a supplier", () => {
    it("issues a credential and stores only its hash", async () => {
      const { supplier, credential } = await operator.registerSupplier({
        id: "office-spark",
        displayName: "Office DGX Spark",
        baseUrl: "http://spark.local/v1",
      });

      expect(credential).toBeTruthy();
      // The credential is shown once and never recoverable.
      expect(supplier.credentialHash).toBe(hashCredential(credential));
      expect(JSON.stringify(supplier)).not.toContain(credential);
    });

    it("makes the credential resolve to the supplier", async () => {
      const { credential } = await operator.registerSupplier({
        id: "office-spark",
        displayName: "Spark",
        baseUrl: "http://spark.local/v1",
      });

      const found = await store.getSupplierByCredentialHash(hashCredential(credential));
      expect(found?.id).toBe("office-spark");
    });

    it("issues a different credential each time", async () => {
      const a = await operator.registerSupplier({ id: "a", displayName: "a", baseUrl: "u" });
      const b = await operator.registerSupplier({ id: "b", displayName: "b", baseUrl: "u" });
      expect(a.credential).not.toBe(b.credential);
    });

    it("grants nothing by default", async () => {
      // A Supplier starts with no Guarantees. The operator is liable for each
      // one, so each has to be a deliberate act.
      const { supplier } = await operator.registerSupplier({
        id: "office-spark",
        displayName: "Spark",
        baseUrl: "u",
      });
      expect(supplier.grantedGuarantees).toEqual([]);
    });
  });

  describe("granting guarantees", () => {
    beforeEach(async () => {
      await operator.registerSupplier({
        id: "office-spark",
        displayName: "Spark",
        baseUrl: "u",
        grantedGuarantees: ["on-premise"],
      });
    });

    it("accepts a claim within the grant", async () => {
      const supplier = (await store.getSupplier("office-spark"))!;
      expect(() => Operator.assertGuaranteesGranted(supplier, ["on-premise"])).not.toThrow();
    });

    it("rejects a claim beyond the grant, naming the guarantee", async () => {
      const supplier = (await store.getSupplier("office-spark"))!;
      expect(() => Operator.assertGuaranteesGranted(supplier, ["no-training"])).toThrow(
        GuaranteeNotGrantedError,
      );
    });

    it("can widen a grant later", async () => {
      await operator.grantGuarantees("office-spark", ["on-premise", "no-training"]);
      const supplier = (await store.getSupplier("office-spark"))!;
      expect(() =>
        Operator.assertGuaranteesGranted(supplier, ["on-premise", "no-training"]),
      ).not.toThrow();
    });

    it("can narrow a grant later", async () => {
      await operator.grantGuarantees("office-spark", []);
      const supplier = (await store.getSupplier("office-spark"))!;
      expect(() => Operator.assertGuaranteesGranted(supplier, ["on-premise"])).toThrow();
    });

    it("does not lose the credential when the grant changes", async () => {
      const before = (await store.getSupplier("office-spark"))!.credentialHash;
      await operator.grantGuarantees("office-spark", ["on-premise", "no-training"]);
      const after = (await store.getSupplier("office-spark"))!.credentialHash;
      expect(after).toBe(before);
    });
  });

  describe("rotation and rotation-out", () => {
    beforeEach(async () => {
      await operator.registerSupplier({ id: "s", displayName: "s", baseUrl: "u" });
      await store.replaceOffers("s", [offerFixture()]);
    });

    it("rotating a credential invalidates the old one", async () => {
      const first = (await store.getSupplier("s"))!.credentialHash;
      const rotated = await operator.rotateCredential("s");

      expect(await store.getSupplierByCredentialHash(first)).toBeNull();
      expect((await store.getSupplierByCredentialHash(hashCredential(rotated)))?.id).toBe("s");
    });

    it("disabling an offer hides it without deleting it", async () => {
      await operator.setOfferEnabled("s", "gemma-4-26b", false);

      expect((await store.getOffer("s", "gemma-4-26b"))?.enabled).toBe(false);
      expect(await store.listOffersBySupplier("s")).toHaveLength(1);
    });

    it("re-enabling restores an offer rather than needing a republish", async () => {
      await operator.setOfferEnabled("s", "gemma-4-26b", false);
      await operator.setOfferEnabled("s", "gemma-4-26b", true);
      expect((await store.getOffer("s", "gemma-4-26b"))?.enabled).toBe(true);
    });

    it("disabling a supplier takes all of its offers out of rotation at once", async () => {
      await operator.setSupplierEnabled("s", false);
      expect(await store.listOffers()).toEqual([]);
    });
  });

  describe("pricing", () => {
    it("sets both wholesale and retail independently", async () => {
      await operator.registerSupplier({ id: "s", displayName: "s", baseUrl: "u" });
      await store.replaceOffers("s", [offerFixture()]);
      await operator.setPricing("s", "gemma-4-26b", {
        wholesalePromptPerMillion: 0,
        wholesaleCompletionPerMillion: 0,
        retailPromptPerMillion: 42,
        retailCompletionPerMillion: 84,
      });

      const offer = (await store.getOffer("s", "gemma-4-26b"))!;
      // Owned hardware: nothing is owed, and it still costs the buyer
      // something. That gap is the whole of ADR 0007.
      expect(offer.wholesalePromptPerMillion).toBe(0);
      expect(offer.retailPromptPerMillion).toBe(42);
    });
  });
});
