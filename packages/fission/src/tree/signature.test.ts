import { describe, it, expect } from "vitest";
import {
  buildSignature,
  cosineSimilarity,
  emptySignature,
  mergeSignature,
  stem,
  surfaceTerms,
  termCoverage,
  tokenize,
  topTerms,
} from "./signature.js";

describe("tokenize", () => {
  it("strips stopwords, short tokens, and bare numbers", () => {
    expect(tokenize("The cat is on a mat with 42 things")).toEqual(["cat", "mat"]);
  });

  it("keeps domain vocabulary, stemmed", () => {
    expect(tokenize("compaction strategy for the KV-cache")).toEqual([
      "compact",
      "strategy",
      "kv-cach",
    ]);
  });

  it("preserves the unstemmed words too", () => {
    expect(surfaceTerms("compaction strategies")).toEqual(["compaction", "strategies"]);
  });
});

describe("stem", () => {
  it("collapses inflections of the same word", () => {
    // The case that motivated stemming: without it, an on-topic follow-up
    // about "eviction" reads as new vocabulary next to "evicts".
    expect(stem("eviction")).toBe(stem("evicts"));
    expect(stem("cache")).toBe(stem("caching"));
    expect(stem("cache")).toBe(stem("caches"));
    expect(stem("strategy")).toBe(stem("strategies"));
    expect(stem("token")).toBe(stem("tokens"));
    expect(stem("compact")).toBe(stem("compaction"));
  });

  it("leaves distinct words distinct", () => {
    expect(stem("prompt")).not.toBe(stem("prefix"));
    expect(stem("summary")).not.toBe(stem("summit"));
  });

  it("does not chew short words down to nothing", () => {
    expect(stem("api")).toBe("api");
    expect(stem("ops")).toBe("ops");
    expect(stem("css")).toBe("css");
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical text and 0 for disjoint text", () => {
    const a = buildSignature("kv cache benchmark prompt tokens");
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
    const b = buildSignature("sourdough starter hydration schedule");
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("is 0 against an empty signature", () => {
    expect(cosineSimilarity(buildSignature("anything"), emptySignature())).toBe(0);
  });

  it("ranks partial overlap between the extremes", () => {
    const node = buildSignature("compaction strategy tokens summary");
    const related = buildSignature("which compaction strategy is cheapest");
    const unrelated = buildSignature("recommend a pizza dough recipe");
    const relatedScore = cosineSimilarity(node, related);
    expect(relatedScore).toBeGreaterThan(0);
    expect(relatedScore).toBeLessThan(1);
    expect(relatedScore).toBeGreaterThan(cosineSimilarity(node, unrelated));
  });
});

describe("mergeSignature", () => {
  it("decays old weight and adds new", () => {
    const base = buildSignature("cache cache cache");
    const merged = mergeSignature(base, buildSignature("tokens"), 0.5);
    expect(merged.weights[stem("cache")]).toBeCloseTo(1.5, 5);
    expect(merged.weights[stem("tokens")]).toBe(1);
    expect(merged.turnCount).toBe(2);
  });

  it("carries readable surface forms through the merge", () => {
    const merged = mergeSignature(
      buildSignature("compaction compaction"),
      buildSignature("tokens"),
    );
    expect(topTerms(merged, 2)).toEqual(["compaction", "tokens"]);
  });

  it("drops terms that decay into noise, keeping signatures bounded", () => {
    let sig = buildSignature("ephemeral");
    for (let i = 0; i < 40; i++) {
      sig = mergeSignature(sig, buildSignature("current subject"), 0.5);
    }
    expect(sig.weights[stem("ephemeral")]).toBeUndefined();
    expect(sig.weights[stem("subject")]).toBeDefined();
  });
});

describe("termCoverage", () => {
  it("reports the share of incoming terms the node already knows", () => {
    const node = buildSignature("compaction strategy");
    expect(termCoverage(node, buildSignature("compaction strategy"))).toBe(1);
    expect(termCoverage(node, buildSignature("compaction pizza"))).toBe(0.5);
    expect(termCoverage(node, buildSignature("pizza dough"))).toBe(0);
  });

  it("treats a contentless turn as fully covered", () => {
    expect(termCoverage(buildSignature("anything"), buildSignature("why?"))).toBe(1);
  });
});

describe("topTerms", () => {
  it("orders by weight and returns words, not stems", () => {
    const sig = buildSignature("cache cache cache tokens tokens summary");
    expect(topTerms(sig, 2)).toEqual(["cache", "tokens"]);
  });
});
