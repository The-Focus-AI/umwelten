import { describe, it, expect } from "vitest";
import { scoreLexicalDrift } from "./lexical-drift.js";
import type { DetectorContext } from "./types.js";
import { buildSignature, emptySignature, mergeSignature } from "../tree/signature.js";
import type { FissionNode, TurnRecord } from "../types.js";

function turn(userText: string, assistantText: string, summary?: string): TurnRecord {
  return {
    id: `turn-${userText.slice(0, 8)}`,
    treeId: "tree",
    nodeId: "node",
    arrivedAtNodeId: "node",
    index: 0,
    timestamp: new Date().toISOString(),
    userText,
    assistantText,
    toolCalls: [],
    analysis: summary
      ? { summary, facts: [], topics: [], latencyMs: 0 }
      : undefined,
    shadowDetectors: [],
    contextTokensBefore: 0,
    contextTokensAfter: 0,
    wallMs: 0,
  };
}

function contextFor(userText: string, turns: TurnRecord[], threshold = 0.6): DetectorContext {
  let signature = emptySignature();
  for (const t of turns) {
    signature = mergeSignature(
      signature,
      buildSignature(`${t.userText}\n${t.assistantText}`),
    );
  }
  const node: FissionNode = {
    id: "node",
    treeId: "tree",
    title: "Test thread",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    turnIds: turns.map((t) => t.id),
    topicSignature: signature,
    status: "active",
  };
  return { userText, node, recentTurns: turns, threshold };
}

const KV_TURNS = [
  turn(
    "How does the KV cache decide which slot to reuse?",
    "The runner tokenizes the whole prompt and finds the slot with the longest common token prefix, then resumes from there.",
  ),
  turn(
    "So a chat has no server-side id at all?",
    "Correct — a conversation is identified by matching prompt tokens, not by a handle. You always send the full history.",
  ),
];

describe("scoreLexicalDrift guards", () => {
  it("never forks on the first turn of a node", () => {
    const result = scoreLexicalDrift(contextFor("Completely unrelated new subject", []));
    expect(result.verdict).toBe("continue");
    expect(result.driftScore).toBe(0);
    expect(result.reason).toMatch(/first turn/i);
  });

  it("never forks on a contentless follow-up", () => {
    // The failure mode this guard exists for: "why?" shares no vocabulary with
    // the thread, so pure cosine distance would score it as maximally drifted.
    for (const followUp of ["why?", "keep going", "and?"]) {
      const result = scoreLexicalDrift(contextFor(followUp, KV_TURNS));
      expect(result.verdict, followUp).toBe("continue");
    }
  });
});

describe("scoreLexicalDrift scoring", () => {
  it("continues on a same-topic follow-up", () => {
    const result = scoreLexicalDrift(
      contextFor("Does the prefix matching work across parallel slots too?", KV_TURNS),
    );
    expect(result.verdict).toBe("continue");
    expect(result.driftScore).toBeLessThan(0.6);
  });

  it("forks on an unrelated question", () => {
    const result = scoreLexicalDrift(
      contextFor(
        "Different question — what temperature should I proof sourdough at overnight?",
        KV_TURNS,
      ),
    );
    expect(result.verdict).toBe("fork");
    expect(result.driftScore).toBeGreaterThanOrEqual(0.6);
    expect(result.proposedTitle).toBeTruthy();
  });

  it("scores an unrelated turn above a related one", () => {
    const related = scoreLexicalDrift(
      contextFor("How big does the token prefix have to be to hit the cache?", KV_TURNS),
    );
    const unrelated = scoreLexicalDrift(
      contextFor("Which hiking boots handle wet granite best?", KV_TURNS),
    );
    expect(unrelated.driftScore).toBeGreaterThan(related.driftScore);
  });

  it("raises the score when a pivot phrase is present", () => {
    const plain = scoreLexicalDrift(
      contextFor("What is the best way to render a markdown table?", KV_TURNS),
    );
    const pivoted = scoreLexicalDrift(
      contextFor("New topic: what is the best way to render a markdown table?", KV_TURNS),
    );
    expect(pivoted.driftScore).toBeGreaterThan(plain.driftScore);
    expect(pivoted.signals.find((s) => s.label === "pivot-cue")?.value).toBe(1);
  });

  it("lowers the score when the turn refers back", () => {
    const withRef = scoreLexicalDrift(
      contextFor("Can you explain that same mechanism again, the one you mentioned?", KV_TURNS),
    );
    expect(withRef.signals.find((s) => s.label === "back-reference")?.value).toBeGreaterThan(0);
    expect(withRef.verdict).toBe("continue");
  });

  it("reports every signal it used", () => {
    const result = scoreLexicalDrift(contextFor("How do prefix caches evict?", KV_TURNS));
    expect(result.signals.map((s) => s.label)).toEqual([
      "topic-dissimilarity",
      "unseen-terms",
      "pivot-cue",
      "back-reference",
    ]);
    expect(result.usedLlm).toBe(false);
  });

  it("honours the configured threshold", () => {
    const permissive = scoreLexicalDrift(
      contextFor("How does markdown rendering handle tables?", KV_TURNS, 0.95),
    );
    const strict = scoreLexicalDrift(
      contextFor("How does markdown rendering handle tables?", KV_TURNS, 0.1),
    );
    expect(permissive.driftScore).toBe(strict.driftScore);
    expect(permissive.verdict).toBe("continue");
    expect(strict.verdict).toBe("fork");
  });
});
