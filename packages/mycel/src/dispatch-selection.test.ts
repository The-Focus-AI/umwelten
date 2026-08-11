/**
 * The two selection changes from ADR 0027.
 *
 * Both correct things that were built on assumptions: that two Offers sharing a
 * Model name are interchangeable, and that the cheapest eligible one always
 * wins. The second mattered more than it sounds — owned hardware costs zero, so
 * it beat every vendor regardless of how slow or how serialized it was.
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_WEIGHTS, dispatch, scoreOffers } from "./dispatch.js";
import type { HeadroomSample, Offer } from "./types.js";

const MODEL = "gemma-4-26b";

const sample = (o: Partial<HeadroomSample> = {}): HeadroomSample => ({
  concurrency: 4,
  ttftMs: 400,
  tokensPerSecond: 300,
  decodeTokensPerSecond: 90,
  ...o,
});

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    supplierId: "a",
    supplierKind: "vendor",
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
    publishedAt: new Date(),
    ...overrides,
  };
}

describe("resource properties are requirable", () => {
  it("refuses an Offer at the wrong quantization", () => {
    // The same weights served two ways expose different capabilities — the
    // finding this whole project rests on. A buyer who needs Q8 gets a refusal
    // rather than a quiet downgrade to Q4.
    const result = dispatch([offer({ quantization: "Q4_K_M" })], {
      model: MODEL,
      quantization: "Q8_0",
    });

    expect(result.offer).toBeUndefined();
    expect(result.considered[0].reason).toBe("wrong-quantization");
  });

  it("refuses an Offer that never said which quantization it serves", () => {
    // An adapted Offer resells a configuration its Supplier does not control,
    // so it cannot honestly claim one — and silence must not pass as a match.
    const result = dispatch([offer({ servingMode: "adapted" })], {
      model: MODEL,
      quantization: "Q8_0",
    });
    expect(result.considered[0].reason).toBe("wrong-quantization");
  });

  it("takes the matching quantization over the cheaper one", () => {
    const cheapWrongQuant = offer({
      supplierId: "vendor",
      quantization: "Q4_K_M",
      retailPromptPerMillion: 1,
      retailCompletionPerMillion: 1,
    });
    const pricierRightQuant = offer({
      supplierId: "office",
      quantization: "Q8_0",
      retailPromptPerMillion: 9_000,
      retailCompletionPerMillion: 9_000,
    });

    const result = dispatch([cheapWrongQuant, pricierRightQuant], {
      model: MODEL,
      quantization: "Q8_0",
    });
    expect(result.offer?.supplierId).toBe("office");
  });

  it("refuses an Offer whose context is too small", () => {
    const result = dispatch([offer({ contextTokens: 8_192 })], {
      model: MODEL,
      minContextTokens: 131_072,
    });
    expect(result.considered[0].reason).toBe("insufficient-context");
  });

  it("ignores both when the buyer does not ask", () => {
    // Requirable, not mandatory. Making everyone specify a quantization would
    // turn the catalogue into an exam.
    const result = dispatch([offer({ quantization: "Q4_K_M", contextTokens: 4_096 })], {
      model: MODEL,
    });
    expect(result.offer).toBeDefined();
  });
});

describe("scoring", () => {
  it("no longer hands every request to the cheapest Offer", () => {
    // The case that motivated this. Owned hardware costs zero, so under
    // price-only ranking a DGX that queues four-deep beat an idle vendor every
    // single time.
    const freeButSerializing = offer({
      supplierId: "office",
      retailPromptPerMillion: 0,
      retailCompletionPerMillion: 0,
      headroom: [sample({ tokensPerSecond: 95, ttftMs: 48_000 })],
      headroomMeta: { sampledAt: "x", saturation: "queues" },
    });
    const pricierButFast = offer({
      supplierId: "vendor",
      retailPromptPerMillion: 3_000,
      retailCompletionPerMillion: 3_000,
      headroom: [sample({ tokensPerSecond: 900, ttftMs: 300 })],
      headroomMeta: { sampledAt: "x", saturation: "batches" },
    });

    const result = dispatch([freeButSerializing, pricierButFast], { model: MODEL });
    expect(result.offer?.supplierId).toBe("vendor");
  });

  it("still prefers cheap when nothing else separates them", () => {
    // Price remains the dominant term. Owned hardware being cheap is a real
    // advantage, not an accident to correct away.
    const cheap = offer({ supplierId: "cheap", retailCompletionPerMillion: 10 });
    const pricey = offer({ supplierId: "pricey", retailCompletionPerMillion: 5_000 });

    expect(dispatch([pricey, cheap], { model: MODEL }).offer?.supplierId).toBe("cheap");
  });

  it("does not punish an Offer for having no Headroom", () => {
    // A vendor catalogue is published without probes. Scoring the gap as slow
    // would make every vendor lose to any probed Offer on grounds nobody
    // established.
    const unmeasured = offer({ supplierId: "vendor", retailCompletionPerMillion: 10 });
    const measured = offer({
      supplierId: "office",
      retailCompletionPerMillion: 5_000,
      headroom: [sample()],
      headroomMeta: { sampledAt: "x", saturation: "batches" },
    });

    expect(dispatch([measured, unmeasured], { model: MODEL }).offer?.supplierId).toBe("vendor");
  });

  it("records the terms, so the choice stays explicable", () => {
    // A weighted function stops being answerable the moment nobody writes down
    // what went into it.
    const result = dispatch([offer({ headroom: [sample()] })], { model: MODEL });
    const [entry] = result.considered;

    expect(entry.score).toBeGreaterThan(0);
    expect(entry.terms).toMatchObject({
      price: expect.any(Number),
      throughput: expect.any(Number),
      timeToFirstToken: expect.any(Number),
      concurrency: expect.any(Number),
    });
  });

  it("scores a lone Offer at full marks on every term", () => {
    // Nothing to prefer it over, so nothing should count against it.
    const [only] = scoreOffers([offer({ headroom: [sample()] })]);
    expect(only.terms.price).toBe(1);
    expect(only.terms.throughput).toBe(1);
  });

  it("is deterministic under a tie", () => {
    const offers = [offer({ supplierId: "b" }), offer({ supplierId: "a" })];
    expect(dispatch(offers, { model: MODEL }).offer?.supplierId).toBe("a");
    expect(dispatch([...offers].reverse(), { model: MODEL }).offer?.supplierId).toBe("a");
  });

  it("collapses to price-only when the other weights are zeroed", () => {
    // The escape hatch, and the reason the old behaviour is still reachable.
    const free = offer({
      supplierId: "office",
      retailPromptPerMillion: 0,
      retailCompletionPerMillion: 0,
      headroomMeta: { sampledAt: "x", saturation: "queues" },
      headroom: [sample({ ttftMs: 48_000 })],
    });
    const fast = offer({
      supplierId: "vendor",
      retailCompletionPerMillion: 3_000,
      headroom: [sample({ ttftMs: 300 })],
      headroomMeta: { sampledAt: "x", saturation: "batches" },
    });

    const result = dispatch([free, fast], { model: MODEL }, {
      weights: { ...DEFAULT_WEIGHTS, throughput: 0, timeToFirstToken: 0, concurrency: 0 },
    });
    expect(result.offer?.supplierId).toBe("office");
  });
});
