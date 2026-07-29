/**
 * The seam: what the agent decides to publish, given a described machine.
 *
 * No GPU, no network, and no assertions about how it got there. Everything
 * decision-shaped is testable here; only measurement needs metal.
 */

import { describe, it, expect } from "vitest";
import { findDuplicateModels, probeTargets, toOfferDrafts } from "./offers.js";
import type { MachineState, ProbedOffer } from "./types.js";

const machine = (overrides: Partial<MachineState> = {}): MachineState => ({
  runtimes: [
    { provider: "ollama", reachable: true, models: ["gemma4:26b", "gemma4:e2b"] },
    { provider: "lmstudio", reachable: false, models: [], error: "fetch failed" },
    { provider: "llamaswap", reachable: true, models: ["ggml-org/gemma-4-26B:Q4_K_M"] },
  ],
  ...overrides,
});

const probed = (overrides: Partial<ProbedOffer> = {}): ProbedOffer => ({
  provider: "ollama",
  model: "gemma4:26b",
  probedAt: "2026-07-28T00:00:00Z",
  capabilities: [
    { name: "chat", supported: true, evidence: "ok", elapsedMs: 1 },
    { name: "streaming", supported: true, evidence: "ok", elapsedMs: 1 },
    { name: "tool-calling", supported: false, evidence: "no tool call", elapsedMs: 1 },
  ],
  headroom: [
    { concurrency: 1, ttftMs: 300, tokensPerSecond: 94, decodeTokensPerSecond: 114, errors: 0 },
  ],
  ...overrides,
});

describe("probeTargets", () => {
  it("skips unreachable runtimes rather than failing", () => {
    // A box running only one runtime is the normal case, not an error.
    const targets = probeTargets(machine());
    expect(targets.map((t) => t.provider)).not.toContain("lmstudio");
    expect(targets).toHaveLength(3);
  });

  it("honours an explicit runtime list", () => {
    const targets = probeTargets(machine(), { providers: ["ollama"] });
    expect(targets.every((t) => t.provider === "ollama")).toBe(true);
  });

  it("honours a model filter", () => {
    const targets = probeTargets(machine(), { modelFilter: "e2b" });
    expect(targets).toEqual([{ provider: "ollama", model: "gemma4:e2b" }]);
  });

  it("returns nothing when no runtime answers", () => {
    const targets = probeTargets({
      runtimes: [{ provider: "ollama", reachable: false, models: [], error: "down" }],
    });
    expect(targets).toEqual([]);
  });
});

describe("toOfferDrafts", () => {
  it("carries probed capabilities through verbatim", () => {
    // Nothing inferred, defaulted, or added. An Offer's capability set is
    // evidence (ADR 0015), and the moment something is added it stops being.
    const [draft] = toOfferDrafts([probed()], { servingMode: "managed" });
    expect(draft.capabilities).toEqual(["chat", "streaming"]);
  });

  it("produces no Offer for a failed probe, rather than one with a hole in it", () => {
    // "We did not establish this" is not "this machine cannot do it", and
    // publishing the second when we only know the first has Dispatch route
    // around a Model that works.
    const drafts = toOfferDrafts(
      [probed({ failed: "chat probe failed: timed out" })],
      { servingMode: "managed" },
    );
    expect(drafts).toEqual([]);
  });

  it("marks the serving mode it was told to", () => {
    expect(toOfferDrafts([probed()], { servingMode: "adapted" })[0].servingMode).toBe("adapted");
    expect(toOfferDrafts([probed()], { servingMode: "managed" })[0].servingMode).toBe("managed");
  });

  it("carries Headroom samples through as measured", () => {
    const [draft] = toOfferDrafts([probed()], { servingMode: "managed" });
    expect(draft.headroom).toHaveLength(1);
    expect(draft.headroom[0].tokensPerSecond).toBe(94);
  });

  it("publishes no price", () => {
    // The Exchange sets Cost and Charge. A Supplier that prices itself takes
    // away the routing lever (ADR 0013).
    const [draft] = toOfferDrafts([probed()], { servingMode: "managed" });
    expect(JSON.stringify(draft)).not.toMatch(/price|retail|wholesale|cost|charge/i);
  });

  it("publishes no guarantee on the Offer itself", () => {
    // Guarantees are the operator's, granted at the Supplier level.
    const [draft] = toOfferDrafts([probed()], { servingMode: "managed" });
    expect(JSON.stringify(draft)).not.toMatch(/guarantee/i);
  });

  it("keeps an Offer whose capabilities all probed false", () => {
    // Different from a failed probe: we established that it does nothing
    // useful, which is a fact the Exchange can filter on.
    const drafts = toOfferDrafts(
      [
        probed({
          capabilities: [{ name: "chat", supported: false, evidence: "no", elapsedMs: 1 }],
        }),
      ],
      { servingMode: "managed" },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].capabilities).toEqual([]);
  });
});

describe("findDuplicateModels", () => {
  it("flags the same Model published from two runtimes", () => {
    // The Exchange keys an Offer on (Supplier, Model), so the second would
    // silently overwrite the first. Better to say so than lose one at random.
    const drafts = toOfferDrafts(
      [probed({ provider: "ollama" }), probed({ provider: "llamaswap" })],
      { servingMode: "managed" },
    );
    expect(findDuplicateModels(drafts)).toEqual(["gemma4:26b"]);
  });

  it("is quiet when every Model is distinct", () => {
    const drafts = toOfferDrafts(
      [probed({ model: "a" }), probed({ model: "b" })],
      { servingMode: "managed" },
    );
    expect(findDuplicateModels(drafts)).toEqual([]);
  });
});
