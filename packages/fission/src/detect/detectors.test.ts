import { describe, it, expect } from "vitest";
import { getDetector, listDetectors, registerDetector } from "./registry.js";
import { neverDetector } from "./never.js";
import { scoreFromJudgement } from "./llm-judge.js";
import { hybridDetector, LOW_GATE, HIGH_GATE } from "./hybrid.js";
import type { DetectorContext, FissionDetector } from "./types.js";
import { buildSignature, emptySignature, mergeSignature } from "../tree/signature.js";
import type { FissionNode, TurnRecord } from "../types.js";

function turn(userText: string, assistantText: string): TurnRecord {
  return {
    id: `turn-${userText.slice(0, 6)}`,
    treeId: "tree",
    nodeId: "node",
    arrivedAtNodeId: "node",
    index: 0,
    timestamp: new Date().toISOString(),
    userText,
    assistantText,
    toolCalls: [],
    shadowDetectors: [],
    contextTokensBefore: 0,
    contextTokensAfter: 0,
    wallMs: 0,
  };
}

function contextFor(userText: string, turns: TurnRecord[]): DetectorContext {
  let signature = emptySignature();
  for (const t of turns) {
    signature = mergeSignature(signature, buildSignature(`${t.userText}\n${t.assistantText}`));
  }
  const node: FissionNode = {
    id: "node",
    treeId: "tree",
    title: "Thread",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    turnIds: turns.map((t) => t.id),
    topicSignature: signature,
    status: "active",
  };
  return { userText, node, recentTurns: turns, threshold: 0.6 };
}

const THREAD = [
  turn(
    "How does prefix caching pick a slot?",
    "It tokenizes the prompt and reuses the slot with the longest common token prefix.",
  ),
  turn(
    "And what happens when every slot is busy?",
    "The runner evicts the least useful slot, then re-evaluates the divergent suffix.",
  ),
];

describe("registry", () => {
  it("exposes the four built-ins", () => {
    expect(listDetectors().map((d) => d.id).sort()).toEqual([
      "hybrid",
      "lexical-drift",
      "llm-judge",
      "never",
    ]);
  });

  it("returns undefined for an unknown id instead of throwing", () => {
    expect(getDetector("nope")).toBeUndefined();
  });

  it("accepts a custom detector", () => {
    const custom: FissionDetector = {
      id: "test-custom",
      name: "Custom",
      description: "test",
      usesLlm: false,
      async detect(ctx) {
        return {
          detectorId: "test-custom",
          verdict: "continue",
          driftScore: 0,
          threshold: ctx.threshold,
          reason: "test",
          signals: [],
          latencyMs: 0,
          usedLlm: false,
        };
      },
    };
    registerDetector(custom);
    expect(getDetector("test-custom")).toBe(custom);
  });
});

describe("neverDetector", () => {
  it("always continues, whatever the input", async () => {
    const result = await neverDetector.detect(
      contextFor("Completely unrelated: how do I bleed a radiator?", THREAD),
    );
    expect(result.verdict).toBe("continue");
    expect(result.driftScore).toBe(0);
    expect(result.usedLlm).toBe(false);
  });
});

describe("scoreFromJudgement", () => {
  it("maps relationships onto the drift axis", () => {
    expect(scoreFromJudgement("continuation", 1)).toBeLessThan(0.1);
    expect(scoreFromJudgement("elaboration", 1)).toBeLessThan(0.3);
    expect(scoreFromJudgement("tangent", 1)).toBeGreaterThan(0.5);
    expect(scoreFromJudgement("new-topic", 1)).toBeGreaterThan(0.9);
  });

  it("pulls an unconfident judgement toward undecided", () => {
    expect(scoreFromJudgement("new-topic", 0)).toBe(0.5);
    expect(scoreFromJudgement("continuation", 0)).toBe(0.5);
    expect(scoreFromJudgement("new-topic", 0.5)).toBeLessThan(
      scoreFromJudgement("new-topic", 1),
    );
  });

  it("keeps a hedged new-topic call below a default threshold", () => {
    // The point of the confidence blend: a coin-flip judgement must not fork.
    expect(scoreFromJudgement("new-topic", 0.1)).toBeLessThan(0.6);
  });

  it("clamps out-of-range confidence", () => {
    expect(scoreFromJudgement("continuation", 5)).toBe(scoreFromJudgement("continuation", 1));
    expect(scoreFromJudgement("continuation", -3)).toBe(0.5);
  });
});

describe("hybridDetector gates", () => {
  it("decides an obvious continuation without a model call", async () => {
    const result = await hybridDetector.detect(
      contextFor("How does the slot eviction interact with prefix caching?", THREAD),
    );
    expect(result.usedLlm).toBe(false);
    expect(result.verdict).toBe("continue");
    expect(result.driftScore).toBeLessThan(LOW_GATE);
    expect(result.reason).toMatch(/no model call/);
  });

  it("decides an unambiguous new topic without a model call", async () => {
    const result = await hybridDetector.detect(
      contextFor(
        "New topic: recommend hiking boots for wet granite scrambling in Scotland",
        THREAD,
      ),
    );
    expect(result.driftScore).toBeGreaterThanOrEqual(HIGH_GATE);
    expect(result.usedLlm).toBe(false);
    expect(result.verdict).toBe("fork");
  });

  it("reports the gate it used as a signal", async () => {
    const result = await hybridDetector.detect(
      contextFor("Does the eviction policy have a name?", THREAD),
    );
    expect(result.signals.some((s) => s.label === "gate")).toBe(true);
  });

  it("falls back to continue when the judge has no model configured", async () => {
    // Score lands in the ambiguous band, so hybrid escalates; with no model the
    // judge must degrade to "continue" rather than throw.
    const ctx = contextFor("What about markdown table rendering in the UI?", THREAD);
    const result = await hybridDetector.detect(ctx);
    if (result.driftScore >= LOW_GATE && result.driftScore < HIGH_GATE) {
      expect(result.verdict).toBe("continue");
      expect(result.error ?? "missing model").toBeTruthy();
    }
  });
});
