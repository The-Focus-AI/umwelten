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
      // something. That gap is the whole of ADR 0013.
      expect(offer.wholesalePromptPerMillion).toBe(0);
      expect(offer.retailPromptPerMillion).toBe(42);
    });
  });

  describe("publishing on a Supplier's behalf", () => {
    beforeEach(async () => {
      await operator.registerSupplier({ id: "thor", displayName: "thor", kind: "agent" });
    });

    it("defaults to adapted, the honest answer when nobody claimed otherwise", async () => {
      await operator.publishOffersFor("thor", [
        { model: "m", capabilities: ["chat"] } as never,
      ]);

      expect((await store.getOffer("thor", "m"))?.servingMode).toBe("adapted");
    });

    it("lets hardware the operator controls say so, and commit to what it serves", async () => {
      // This was forced to `adapted` for every operator-published Offer, which
      // was right for a vendor API nobody on this side controls and wrong for a
      // box in the next room — and it silently cost that box the ability to
      // promise a context size or a quantization at all (ADR 0016).
      await operator.publishOffersFor("thor", [
        {
          model: "m",
          capabilities: ["chat"],
          servingMode: "managed",
          contextTokens: 128_000,
          quantization: "NVFP4",
        },
      ]);

      const offer = (await store.getOffer("thor", "m"))!;
      expect(offer.servingMode).toBe("managed");
      expect(offer.contextTokens).toBe(128_000);
      expect(offer.quantization).toBe("NVFP4");
    });
  });

  describe("rotating a Supplier's credential", () => {
    it("issues a new one and stops accepting the old", async () => {
      const { credential: original } = await operator.registerSupplier({
        id: "thor",
        displayName: "thor",
        kind: "agent",
      });

      const rotated = await operator.rotateCredential("thor");

      expect(rotated).not.toBe(original);
      // Looked up by hash, so the old one no longer resolves to anything —
      // which is what makes this a rotation rather than a second key.
      expect(await store.getSupplierByCredentialHash(hashCredential(original))).toBeNull();
      expect(await store.getSupplierByCredentialHash(hashCredential(rotated))).not.toBeNull();
    });

    it("keeps everything else about the Supplier", async () => {
      await operator.registerSupplier({
        id: "thor",
        displayName: "thor (Jetson)",
        kind: "agent",
        grantedGuarantees: ["on-premise"],
      });

      await operator.rotateCredential("thor");

      const supplier = (await store.getSupplier("thor"))!;
      // A rotation that quietly dropped a granted Guarantee would take the
      // machine out of eligibility for the traffic it exists to serve.
      expect(supplier.grantedGuarantees).toEqual(["on-premise"]);
      expect(supplier.kind).toBe("agent");
      expect(supplier.displayName).toBe("thor (Jetson)");
    });
  });
});
