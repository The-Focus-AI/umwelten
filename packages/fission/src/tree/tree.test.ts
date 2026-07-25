import { describe, it, expect } from "vitest";
import { FissionTree } from "./tree.js";
import { buildSignature, stem } from "./signature.js";
import type { TurnRecord } from "../types.js";

const MODEL = { name: "test-model", provider: "test" };

function makeTree() {
  return FissionTree.create({ model: MODEL, title: "Test", rootTitle: "Root" });
}

function makeTurn(tree: FissionTree, nodeId: string, overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id: `turn-${Math.random().toString(36).slice(2, 8)}`,
    treeId: tree.id,
    nodeId,
    arrivedAtNodeId: nodeId,
    index: 0,
    timestamp: new Date().toISOString(),
    userText: "hello",
    assistantText: "hi",
    toolCalls: [],
    shadowDetectors: [],
    contextTokensBefore: 100,
    contextTokensAfter: 60,
    wallMs: 10,
    ...overrides,
  };
}

describe("FissionTree", () => {
  it("starts with a single active root", () => {
    const tree = makeTree();
    expect(Object.keys(tree.data.nodes)).toHaveLength(1);
    expect(tree.data.activeNodeId).toBe(tree.data.rootId);
    expect(tree.activeNode.title).toBe("Root");
  });

  it("forks children and tracks the path back to the root", () => {
    const tree = makeTree();
    const child = tree.fork({ parentId: tree.data.rootId, title: "Child" });
    const grandchild = tree.fork({ parentId: child.id, title: "Grandchild" });

    expect(tree.children(tree.data.rootId).map((n) => n.title)).toEqual(["Child"]);
    expect(tree.pathTo(grandchild.id).map((n) => n.title)).toEqual([
      "Root",
      "Child",
      "Grandchild",
    ]);
    expect(tree.depth(grandchild.id)).toBe(2);
  });

  it("keeps the parent intact when a child forks off", () => {
    const tree = makeTree();
    tree.addTurn(makeTurn(tree, tree.data.rootId));
    const child = tree.fork({ parentId: tree.data.rootId, title: "Child" });

    expect(tree.requireNode(tree.data.rootId).turnIds).toHaveLength(1);
    expect(child.turnIds).toHaveLength(0);
  });

  it("throws on an unknown node rather than silently continuing", () => {
    expect(() => makeTree().requireNode("nope")).toThrow(/No such node/);
  });

  it("merges turn signatures into the node fingerprint", () => {
    const tree = makeTree();
    tree.updateSignature(tree.data.rootId, buildSignature("compaction strategy tokens"));
    tree.updateSignature(tree.data.rootId, buildSignature("compaction ratio"));
    const sig = tree.requireNode(tree.data.rootId).topicSignature;
    expect(sig.weights[stem("compaction")]).toBeGreaterThan(sig.weights[stem("tokens")]);
    expect(sig.turnCount).toBe(2);
  });
});

describe("FissionTree.stats", () => {
  it("aggregates turns, forks, savings, and labels", () => {
    const tree = makeTree();
    const child = tree.fork({ parentId: tree.data.rootId, title: "Child" });

    tree.addTurn(
      makeTurn(tree, tree.data.rootId, {
        id: "t1",
        compaction: {
          strategyId: "rolling-summary",
          segmentStart: 1,
          segmentEnd: 4,
          replacementCount: 1,
          tokensBefore: 1000,
          tokensAfter: 400,
          ratio: 0.4,
          latencyMs: 500,
          summaryText: "…",
        },
        usage: { costUsd: 0.002 },
      }),
    );
    tree.addTurn(
      makeTurn(tree, child.id, {
        id: "t2",
        arrivedAtNodeId: tree.data.rootId,
        detector: {
          detectorId: "hybrid",
          verdict: "fork",
          driftScore: 0.9,
          threshold: 0.6,
          reason: "new subject",
          signals: [],
          latencyMs: 12,
          usedLlm: false,
          costUsd: 0.0005,
        },
      }),
    );
    tree.labelTurn("t2", { verdict: "fork", at: new Date().toISOString() });

    const stats = tree.stats();
    expect(stats.turnCount).toBe(2);
    expect(stats.nodeCount).toBe(2);
    expect(stats.forkCount).toBe(1);
    expect(stats.maxDepth).toBe(1);
    expect(stats.tokensSaved).toBe(600);
    expect(stats.meanCompactionRatio).toBeCloseTo(0.4, 5);
    expect(stats.labeledTurns).toBe(1);
    expect(stats.totalCostUsd).toBeCloseTo(0.0025, 6);
  });

  it("reports a neutral ratio when nothing has been compacted", () => {
    expect(makeTree().stats().meanCompactionRatio).toBe(1);
  });
});
