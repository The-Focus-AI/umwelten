import { describe, it, expect } from "vitest";
import { buildFissionReport } from "./build-report.js";
import { renderReportHtml } from "./render-html.js";
import { FissionTree } from "../tree/tree.js";
import type { DetectorResult, TurnRecord } from "../types.js";

const MODEL = { name: "test-model", provider: "test" };

function detector(
  detectorId: string,
  verdict: "fork" | "continue",
  driftScore: number,
  extra: Partial<DetectorResult> = {},
): DetectorResult {
  return {
    detectorId,
    verdict,
    driftScore,
    threshold: 0.6,
    reason: `${detectorId} says ${verdict}`,
    signals: [],
    latencyMs: 10,
    usedLlm: false,
    ...extra,
  };
}

function makeTurn(overrides: Partial<TurnRecord> & Pick<TurnRecord, "id" | "nodeId" | "treeId">): TurnRecord {
  return {
    arrivedAtNodeId: overrides.nodeId,
    index: 0,
    timestamp: new Date().toISOString(),
    userText: "a question of about forty characters here",
    assistantText: "an answer that is a bit longer than the question was",
    toolCalls: [],
    shadowDetectors: [],
    contextTokensBefore: 100,
    contextTokensAfter: 60,
    wallMs: 10,
    ...overrides,
  };
}

/** Two turns in root, one forked child turn, one shadow detector, one label. */
function populatedTree(): FissionTree {
  const tree = FissionTree.create({ model: MODEL, title: "Report fixture" });
  const root = tree.data.rootId;
  const child = tree.fork({ parentId: root, title: "Spun off", seed: {
    strategyId: "topic-carryover",
    text: "carried over",
    tokensBefore: 500,
    tokensAfter: 80,
  } });

  tree.addTurn(
    makeTurn({
      id: "t1",
      treeId: tree.id,
      nodeId: root,
      detector: detector("hybrid", "continue", 0.1),
      shadowDetectors: [detector("never", "continue", 0)],
      usage: { costUsd: 0.001 },
      compaction: {
        strategyId: "rolling-summary",
        segmentStart: 1,
        segmentEnd: 2,
        replacementCount: 1,
        tokensBefore: 1000,
        tokensAfter: 300,
        ratio: 0.3,
        latencyMs: 900,
        summaryText: "summary text",
      },
    }),
  );

  tree.addTurn(
    makeTurn({
      id: "t2",
      treeId: tree.id,
      nodeId: child.id,
      arrivedAtNodeId: root,
      detector: detector("hybrid", "fork", 0.9, { usedLlm: true, costUsd: 0.0004 }),
      shadowDetectors: [detector("never", "continue", 0)],
      label: { verdict: "fork", at: new Date().toISOString() },
      usage: { costUsd: 0.002 },
      altCompactions: {
        "recent-window": {
          strategyId: "recent-window",
          segmentStart: 1,
          segmentEnd: 4,
          replacementCount: 3,
          tokensBefore: 1000,
          tokensAfter: 700,
          ratio: 0.7,
          latencyMs: 0,
          summaryText: "(dropped)",
        },
      },
    }),
  );

  return tree;
}

describe("buildFissionReport", () => {
  it("summarizes an empty tree without dividing by zero", () => {
    const report = buildFissionReport(FissionTree.create({ model: MODEL }));
    expect(report.stats.turnCount).toBe(0);
    expect(report.growth).toEqual([]);
    expect(report.totals.savingsRatio).toBe(1);
    expect(report.detectors).toEqual([]);
    expect(report.forks).toEqual([]);
  });

  it("rolls up detectors including shadows", () => {
    const report = buildFissionReport(populatedTree());
    const hybrid = report.detectors.find((d) => d.detectorId === "hybrid");
    const never = report.detectors.find((d) => d.detectorId === "never");

    expect(hybrid?.scored).toBe(2);
    expect(hybrid?.forks).toBe(1);
    expect(hybrid?.llmCalls).toBe(1);
    expect(hybrid?.agreementWithActive).toBe(1);

    // The control never forks, so it disagrees on exactly the forked turn.
    expect(never?.scored).toBe(2);
    expect(never?.forks).toBe(0);
    expect(never?.agreementWithActive).toBe(0.5);
  });

  it("scores detectors against human labels only", () => {
    const report = buildFissionReport(populatedTree());
    const hybrid = report.detectors.find((d) => d.detectorId === "hybrid");
    const never = report.detectors.find((d) => d.detectorId === "never");

    expect(hybrid?.labeled.count).toBe(1);
    expect(hybrid?.labeled.truePositive).toBe(1);
    expect(hybrid?.labeled.accuracy).toBe(1);

    expect(never?.labeled.falseNegative).toBe(1);
    expect(never?.labeled.accuracy).toBe(0);
    // No fork predicted at all, so precision is undefined rather than zero.
    expect(never?.labeled.precision).toBeNull();
  });

  it("separates live compaction rows from playground rows", () => {
    const report = buildFissionReport(populatedTree());
    const live = report.compaction.find((r) => !r.fromPlayground);
    const playground = report.compaction.find((r) => r.fromPlayground);

    expect(live?.strategyId).toBe("rolling-summary");
    expect(live?.meanRatio).toBeCloseTo(0.3, 5);
    expect(live?.tokensSaved).toBe(700);
    expect(playground?.strategyId).toBe("recent-window");
    expect(playground?.fromPlayground).toBe(true);
  });

  it("builds a growth series where the baseline only grows", () => {
    const report = buildFissionReport(populatedTree());
    expect(report.growth).toHaveLength(2);
    expect(report.growth[1].baselineTokens).toBeGreaterThan(report.growth[0].baselineTokens);
    expect(report.growth[1].forked).toBe(true);
    expect(report.totals.baselinePromptTokensSent).toBeGreaterThan(0);
  });

  it("charges the baseline for the system prompt too", () => {
    // The tree's measured context includes the system prompt on every turn.
    // A baseline that skipped it would make any tree look better than it is.
    const report = buildFissionReport(populatedTree());
    const firstTurn = populatedTree().allTurns()[0];
    expect(report.growth[0].baselineTokens).toBeGreaterThanOrEqual(
      firstTurn.contextTokensBefore,
    );
  });

  it("lists forks with the reason that caused them", () => {
    const report = buildFissionReport(populatedTree());
    expect(report.forks).toHaveLength(1);
    expect(report.forks[0].toNode).toBe("Spun off");
    expect(report.forks[0].reason).toMatch(/hybrid says fork/);
    expect(report.forks[0].label).toBe("fork");
  });

  it("reports nodes with their depth and seed cost", () => {
    const report = buildFissionReport(populatedTree());
    const child = report.nodes.find((n) => n.title === "Spun off");
    expect(child?.depth).toBe(1);
    expect(child?.seedTokens).toBe(80);
  });

  it("counts detector calls the gate avoided", () => {
    const report = buildFissionReport(populatedTree());
    expect(report.totals.llmDetectorCalls).toBe(1);
    expect(report.totals.detectorCallsAvoided).toBe(1);
  });
});

describe("renderReportHtml", () => {
  it("renders a self-contained document with no external references", () => {
    const html = renderReportHtml(buildFissionReport(populatedTree()));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain("Report fixture");
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("escapes user text rather than injecting it", () => {
    const tree = populatedTree();
    const turn = tree.turns.get("t2")!;
    turn.userText = '<img src=x onerror="alert(1)">';
    const html = renderReportHtml(buildFissionReport(tree));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("says so plainly when there is nothing to plot", () => {
    const html = renderReportHtml(buildFissionReport(FissionTree.create({ model: MODEL })));
    expect(html).toContain("Not enough turns yet");
    expect(html).toContain("No turns are labeled yet");
  });
});
