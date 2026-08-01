import { describe, it, expect } from "vitest";
import { DEFAULT_STALE_AFTER_MS, dispatch, rankingPrice } from "./dispatch.js";
import type { Offer } from "./types.js";

/**
 * The supplier agent's heartbeat interval, restated rather than imported: the
 * exchange does not depend on the supplier package and must not start.
 */
const HEARTBEAT_INTERVAL_MS = 5 * 60_000;

const MODEL = "gemma-4-26b";

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    supplierId: "a",
    model: MODEL,
    capabilities: ["chat", "streaming"],
    guarantees: [],
    servingMode: "managed",
    headroom: [],
    wholesalePromptPerMillion: 0,
    wholesaleCompletionPerMillion: 0,
    retailPromptPerMillion: 100,
    retailCompletionPerMillion: 100,
    enabled: true,
    // Freshly published, because staleness is on by default and these tests
    // are about the other filters. The staleness tests set this explicitly.
    publishedAt: new Date(),
    ...overrides,
  };
}

describe("dispatch", () => {
  describe("guarantees are a hard filter", () => {
    it("never selects an Offer lacking a required Guarantee, even when cheapest", () => {
      // The load-bearing case. Serving from a Supplier that lacks a required
      // Guarantee is the worst thing this system can do, and the "fix" for it
      // looks like a resilience improvement.
      const cheapButIneligible = offer({
        supplierId: "vendor",
        guarantees: [],
        retailPromptPerMillion: 1,
        retailCompletionPerMillion: 1,
      });
      const expensiveButEligible = offer({
        supplierId: "office",
        guarantees: ["on-premise"],
        retailPromptPerMillion: 9_000,
        retailCompletionPerMillion: 9_000,
      });

      const result = dispatch([cheapButIneligible, expensiveButEligible], {
        model: MODEL,
        guarantees: ["on-premise"],
      });

      expect(result.offer?.supplierId).toBe("office");
    });

    it("fails rather than falling back when the only eligible Offer is gone", () => {
      const result = dispatch([offer({ supplierId: "vendor", guarantees: [] })], {
        model: MODEL,
        guarantees: ["on-premise"],
      });

      expect(result.offer).toBeUndefined();
      expect(result.considered[0].reason).toBe("missing-guarantee");
    });

    it("requires every named Guarantee, not just one", () => {
      const result = dispatch([offer({ guarantees: ["on-premise"] })], {
        model: MODEL,
        guarantees: ["on-premise", "no-training"],
      });

      expect(result.offer).toBeUndefined();
    });
  });

  describe("capabilities are a hard filter", () => {
    it("never selects an Offer lacking a required Capability", () => {
      const result = dispatch([offer({ capabilities: ["chat"] })], {
        model: MODEL,
        capabilities: ["tool-calling"],
      });

      expect(result.offer).toBeUndefined();
      expect(result.considered[0].reason).toBe("missing-capability");
    });

    it("selects when every required Capability was probed true", () => {
      const result = dispatch([offer({ capabilities: ["chat", "tool-calling"] })], {
        model: MODEL,
        capabilities: ["chat", "tool-calling"],
      });

      expect(result.offer).toBeDefined();
    });
  });

  describe("ranking", () => {
    it("takes the cheapest among eligible Offers", () => {
      const result = dispatch(
        [
          offer({ supplierId: "pricey", retailCompletionPerMillion: 5_000 }),
          offer({ supplierId: "cheap", retailCompletionPerMillion: 10 }),
        ],
        { model: MODEL },
      );

      expect(result.offer?.supplierId).toBe("cheap");
    });

    it("is deterministic under a price tie", () => {
      // Otherwise the tests flake and, worse, so does production routing.
      const offers = [offer({ supplierId: "b" }), offer({ supplierId: "a" })];
      expect(dispatch(offers, { model: MODEL }).offer?.supplierId).toBe("a");
      expect(dispatch([...offers].reverse(), { model: MODEL }).offer?.supplierId).toBe("a");
    });

    it("weights completion more heavily than prompt", () => {
      const promptHeavy = offer({ retailPromptPerMillion: 300, retailCompletionPerMillion: 100 });
      const completionHeavy = offer({
        retailPromptPerMillion: 100,
        retailCompletionPerMillion: 300,
      });
      expect(rankingPrice(promptHeavy)).toBeLessThan(rankingPrice(completionHeavy));
    });
  });

  describe("exclusions", () => {
    it("never selects a disabled Offer", () => {
      const result = dispatch([offer({ enabled: false })], { model: MODEL });
      expect(result.offer).toBeUndefined();
      expect(result.considered[0].reason).toBe("offer-disabled");
    });

    it("never selects a Model outside an allowed list", () => {
      const result = dispatch([offer()], { model: MODEL, allowedModels: ["something-else"] });
      expect(result.offer).toBeUndefined();
      expect(result.considered[0].reason).toBe("model-not-allowed");
    });

    it("never selects a stale Offer", () => {
      // A Supplier that stopped reporting has probably gone, and its last known
      // capabilities are a guess.
      const result = dispatch(
        [offer({ publishedAt: new Date("2026-07-28T00:00:00Z") })],
        { model: MODEL },
        { staleAfterMs: 60_000, now: new Date("2026-07-28T00:05:00Z") },
      );

      expect(result.offer).toBeUndefined();
      expect(result.considered[0].reason).toBe("offer-stale");
    });

    it("selects an Offer republished inside the window", () => {
      const result = dispatch(
        [offer({ publishedAt: new Date("2026-07-28T00:04:30Z") })],
        { model: MODEL },
        { staleAfterMs: 60_000, now: new Date("2026-07-28T00:05:00Z") },
      );

      expect(result.offer).toBeDefined();
    });

    it("expires without being configured to", () => {
      // An expiry window nobody remembered to switch on is a window that never
      // fires, and then the live agent's withdrawal and the Exchange's expiry
      // stop being two mechanisms and become one.
      const old = new Date(Date.now() - DEFAULT_STALE_AFTER_MS - 1_000);
      const result = dispatch([offer({ publishedAt: old })], { model: MODEL });

      expect(result.offer).toBeUndefined();
      expect(result.considered[0].reason).toBe("offer-stale");
    });

    it("leaves room for a missed heartbeat", () => {
      // The agent republishes every five minutes. One publish lost to a flaky
      // link must not take a working machine out of the pool.
      const oneMissed = new Date(Date.now() - 2 * HEARTBEAT_INTERVAL_MS);
      expect(dispatch([offer({ publishedAt: oneMissed })], { model: MODEL }).offer).toBeDefined();
    });

    it("can be turned off deliberately", () => {
      // Distinct from never having been turned on: an operator running a
      // Supplier that publishes by hand should be able to say so.
      const ancient = new Date("2020-01-01T00:00:00Z");
      const result = dispatch([offer({ publishedAt: ancient })], { model: MODEL }, {
        staleAfterMs: 0,
      });
      expect(result.offer).toBeDefined();
    });

    it("brings a resumed Supplier's Offers back without operator action", () => {
      // Republishing is the whole recovery path — nothing to re-enable, and
      // nothing to re-register.
      const wasStale = offer({ publishedAt: new Date(Date.now() - 60 * 60_000) });
      expect(dispatch([wasStale], { model: MODEL }).offer).toBeUndefined();

      const republished = { ...wasStale, publishedAt: new Date() };
      expect(dispatch([republished], { model: MODEL }).offer).toBeDefined();
    });
  });

  describe("the considered list", () => {
    it("records every Offer weighed and why each was rejected", () => {
      // "Why did this request go there" is otherwise unanswerable after the
      // fact, and a failed request needs to say more than "no".
      const result = dispatch(
        [
          offer({ supplierId: "wrong-model", model: "other" }),
          offer({ supplierId: "no-guarantee", guarantees: [] }),
          offer({ supplierId: "eligible", guarantees: ["on-premise"] }),
        ],
        { model: MODEL, guarantees: ["on-premise"] },
      );

      const byId = Object.fromEntries(result.considered.map((c) => [c.supplierId, c]));
      expect(byId["wrong-model"].reason).toBe("model-mismatch");
      expect(byId["no-guarantee"].reason).toBe("missing-guarantee");
      expect(byId["eligible"].eligible).toBe(true);
      expect(byId["eligible"].rankingPrice).toBeGreaterThan(0);
    });
  });
});
