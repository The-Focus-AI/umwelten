/**
 * Report builder.
 *
 * Turns a tree's turn log into the numbers worth arguing about:
 *
 *  - **Prompt tokens sent, cumulative.** The headline. Every turn re-sends its
 *    whole context, so what a strategy costs is the sum of context sizes across
 *    turns, not the size at the end. Compared against the counterfactual of one
 *    long uncompacted chat.
 *  - **Detector agreement.** Shadow detectors score every turn without acting,
 *    so the cheap ones can be compared against the expensive ones on identical
 *    input, for free.
 *  - **Detector accuracy.** Only over turns a human labeled. Reported with the
 *    label count attached, because 4 labels is not an accuracy measurement and
 *    the table should say so.
 *  - **Compaction ratios.** Including playground runs, where every strategy saw
 *    the same rebuilt context.
 *
 * Pure function over the tree — no model calls, no I/O.
 */

import type { FissionTree } from "../tree/tree.js";
import type { FissionConfig, TreeStats, TurnRecord } from "../types.js";

export interface DetectorRow {
  detectorId: string;
  /** Turns this detector scored. */
  scored: number;
  forks: number;
  continues: number;
  llmCalls: number;
  meanLatencyMs: number;
  costUsd: number;
  /** Fraction of turns where this detector agreed with the one that decided. */
  agreementWithActive: number;
  /** Confusion counts against human labels, where labels exist. */
  labeled: {
    count: number;
    truePositive: number;
    falsePositive: number;
    trueNegative: number;
    falseNegative: number;
    precision: number | null;
    recall: number | null;
    accuracy: number | null;
  };
  errors: number;
}

export interface CompactionRow {
  strategyId: string;
  runs: number;
  meanRatio: number;
  meanLatencyMs: number;
  meanTokensBefore: number;
  meanTokensAfter: number;
  tokensSaved: number;
  errors: number;
  /** True when these runs came from the playground (same input for all). */
  fromPlayground: boolean;
}

export interface GrowthPoint {
  turnIndex: number;
  timestamp: string;
  nodeTitle: string;
  /** Context actually sent for this turn. */
  actualTokens: number;
  /** Context a single never-compacted, never-forked chat would have sent. */
  baselineTokens: number;
  forked: boolean;
}

export interface NodeRow {
  id: string;
  title: string;
  depth: number;
  parentTitle?: string;
  turnCount: number;
  seedTokens: number;
  bornFromTurnId?: string;
}

export interface ForkRow {
  turnId: string;
  timestamp: string;
  detectorId: string;
  driftScore: number;
  threshold: number;
  reason: string;
  userText: string;
  fromNode: string;
  toNode: string;
  usedLlm: boolean;
  label?: string;
}

export interface FissionReport {
  treeId: string;
  title: string;
  generatedAt: string;
  model: { name: string; provider: string };
  config: FissionConfig;
  stats: TreeStats;
  detectors: DetectorRow[];
  compaction: CompactionRow[];
  growth: GrowthPoint[];
  nodes: NodeRow[];
  forks: ForkRow[];
  totals: {
    promptTokensSent: number;
    baselinePromptTokensSent: number;
    savingsRatio: number;
    detectorCostUsd: number;
    answerCostUsd: number;
    llmDetectorCalls: number;
    detectorCallsAvoided: number;
  };
}

const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function buildDetectorRows(turns: TurnRecord[]): DetectorRow[] {
  const byDetector = new Map<
    string,
    { results: { turn: TurnRecord; verdict: string; latencyMs: number; costUsd: number; usedLlm: boolean; error?: string }[] }
  >();

  for (const turn of turns) {
    const all = [
      ...(turn.detector ? [turn.detector] : []),
      ...turn.shadowDetectors,
    ];
    for (const result of all) {
      const bucket = byDetector.get(result.detectorId) ?? { results: [] };
      bucket.results.push({
        turn,
        verdict: result.verdict,
        latencyMs: result.latencyMs,
        costUsd: result.costUsd ?? 0,
        usedLlm: result.usedLlm,
        error: result.error,
      });
      byDetector.set(result.detectorId, bucket);
    }
  }

  const rows: DetectorRow[] = [];
  for (const [detectorId, bucket] of byDetector) {
    let agreements = 0;
    let comparable = 0;
    let truePositive = 0;
    let falsePositive = 0;
    let trueNegative = 0;
    let falseNegative = 0;
    let labeledCount = 0;

    for (const entry of bucket.results) {
      const active = entry.turn.detector;
      if (active) {
        comparable++;
        if (active.verdict === entry.verdict) agreements++;
      }
      const label = entry.turn.label;
      if (label) {
        labeledCount++;
        const predictedFork = entry.verdict === "fork";
        const actualFork = label.verdict === "fork";
        if (predictedFork && actualFork) truePositive++;
        else if (predictedFork && !actualFork) falsePositive++;
        else if (!predictedFork && !actualFork) trueNegative++;
        else falseNegative++;
      }
    }

    const precisionDenom = truePositive + falsePositive;
    const recallDenom = truePositive + falseNegative;

    rows.push({
      detectorId,
      scored: bucket.results.length,
      forks: bucket.results.filter((r) => r.verdict === "fork").length,
      continues: bucket.results.filter((r) => r.verdict === "continue").length,
      llmCalls: bucket.results.filter((r) => r.usedLlm).length,
      meanLatencyMs: Math.round(mean(bucket.results.map((r) => r.latencyMs))),
      costUsd: bucket.results.reduce((sum, r) => sum + r.costUsd, 0),
      agreementWithActive: comparable > 0 ? agreements / comparable : 1,
      labeled: {
        count: labeledCount,
        truePositive,
        falsePositive,
        trueNegative,
        falseNegative,
        precision: precisionDenom > 0 ? truePositive / precisionDenom : null,
        recall: recallDenom > 0 ? truePositive / recallDenom : null,
        accuracy:
          labeledCount > 0 ? (truePositive + trueNegative) / labeledCount : null,
      },
      errors: bucket.results.filter((r) => r.error).length,
    });
  }

  return rows.sort((a, b) => b.scored - a.scored);
}

function buildCompactionRows(turns: TurnRecord[]): CompactionRow[] {
  const live = new Map<string, ReturnType<typeof collect>>();
  const playground = new Map<string, ReturnType<typeof collect>>();

  function collect() {
    return {
      ratios: [] as number[],
      latencies: [] as number[],
      before: [] as number[],
      after: [] as number[],
      saved: 0,
      errors: 0,
      runs: 0,
    };
  }

  for (const turn of turns) {
    if (turn.compaction) {
      const bucket = live.get(turn.compaction.strategyId) ?? collect();
      bucket.runs++;
      if (turn.compaction.error) bucket.errors++;
      else {
        bucket.ratios.push(turn.compaction.ratio);
        bucket.latencies.push(turn.compaction.latencyMs);
        bucket.before.push(turn.compaction.tokensBefore);
        bucket.after.push(turn.compaction.tokensAfter);
        bucket.saved += Math.max(0, turn.compaction.tokensBefore - turn.compaction.tokensAfter);
      }
      live.set(turn.compaction.strategyId, bucket);
    }
    for (const [strategyId, record] of Object.entries(turn.altCompactions ?? {})) {
      const bucket = playground.get(strategyId) ?? collect();
      bucket.runs++;
      if (record.error) bucket.errors++;
      else {
        bucket.ratios.push(record.ratio);
        bucket.latencies.push(record.latencyMs);
        bucket.before.push(record.tokensBefore);
        bucket.after.push(record.tokensAfter);
        bucket.saved += Math.max(0, record.tokensBefore - record.tokensAfter);
      }
      playground.set(strategyId, bucket);
    }
  }

  const rows: CompactionRow[] = [];
  const emit = (map: typeof live, fromPlayground: boolean) => {
    for (const [strategyId, bucket] of map) {
      rows.push({
        strategyId,
        runs: bucket.runs,
        meanRatio: Number(mean(bucket.ratios).toFixed(4)),
        meanLatencyMs: Math.round(mean(bucket.latencies)),
        meanTokensBefore: Math.round(mean(bucket.before)),
        meanTokensAfter: Math.round(mean(bucket.after)),
        tokensSaved: bucket.saved,
        errors: bucket.errors,
        fromPlayground,
      });
    }
  };
  emit(live, false);
  emit(playground, true);

  return rows.sort((a, b) => a.meanRatio - b.meanRatio);
}

export function buildFissionReport(tree: FissionTree): FissionReport {
  const turns = tree.allTurns();

  // Baseline: one chat, never compacted, never forked. Its context at turn N is
  // everything said in turns 1..N — plus the system prompt, which it also pays
  // for on every turn. Leaving that out would flatter the tree, since the
  // tree's measured context includes it.
  const systemPromptTokens = turns.length > 0 ? turns[0].contextTokensBefore : 0;
  let baselineRunning = 0;
  let promptTokensSent = 0;
  let baselinePromptTokensSent = 0;
  const growth: GrowthPoint[] = [];

  turns.forEach((turn, index) => {
    baselineRunning += estimateTokens(turn.userText) + estimateTokens(turn.assistantText);
    // The baseline sends everything said *before* this turn, plus this user turn.
    const baselineForThisTurn =
      systemPromptTokens + baselineRunning - estimateTokens(turn.assistantText);
    promptTokensSent += turn.contextTokensBefore + estimateTokens(turn.userText);
    baselinePromptTokensSent += baselineForThisTurn;

    growth.push({
      turnIndex: index + 1,
      timestamp: turn.timestamp,
      nodeTitle: tree.node(turn.nodeId)?.title ?? turn.nodeId.slice(0, 8),
      actualTokens: turn.contextTokensBefore + estimateTokens(turn.userText),
      baselineTokens: baselineForThisTurn,
      forked: turn.nodeId !== turn.arrivedAtNodeId,
    });
  });

  const nodes: NodeRow[] = Object.values(tree.data.nodes)
    .map((node) => ({
      id: node.id,
      title: node.title,
      depth: tree.depth(node.id),
      parentTitle: node.parentId ? tree.node(node.parentId)?.title : undefined,
      turnCount: node.turnIds.length,
      seedTokens: node.seed?.tokensAfter ?? 0,
      bornFromTurnId: node.bornFromTurnId,
    }))
    .sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title));

  const forks: ForkRow[] = turns
    .filter((turn) => turn.nodeId !== turn.arrivedAtNodeId)
    .map((turn) => ({
      turnId: turn.id,
      timestamp: turn.timestamp,
      detectorId: turn.detector?.detectorId ?? "manual",
      driftScore: turn.detector?.driftScore ?? 1,
      threshold: turn.detector?.threshold ?? tree.config.driftThreshold,
      reason: turn.detector?.reason ?? "Manual fork.",
      userText: turn.userText,
      fromNode: tree.node(turn.arrivedAtNodeId)?.title ?? turn.arrivedAtNodeId.slice(0, 8),
      toNode: tree.node(turn.nodeId)?.title ?? turn.nodeId.slice(0, 8),
      usedLlm: turn.detector?.usedLlm ?? false,
      label: turn.label?.verdict,
    }));

  const detectors = buildDetectorRows(turns);
  const answerCostUsd = turns.reduce((sum, turn) => sum + (turn.usage?.costUsd ?? 0), 0);
  const detectorCostUsd = detectors.reduce((sum, row) => sum + row.costUsd, 0);

  const activeRow = detectors.find((row) => row.detectorId === tree.config.detectorId);
  const llmDetectorCalls = activeRow?.llmCalls ?? 0;
  const detectorCallsAvoided = (activeRow?.scored ?? 0) - llmDetectorCalls;

  return {
    treeId: tree.id,
    title: tree.data.title,
    generatedAt: new Date().toISOString(),
    model: { name: tree.data.model.name, provider: tree.data.model.provider },
    config: tree.config,
    stats: tree.stats(),
    detectors,
    compaction: buildCompactionRows(turns),
    growth,
    nodes,
    forks,
    totals: {
      promptTokensSent,
      baselinePromptTokensSent,
      savingsRatio:
        baselinePromptTokensSent > 0
          ? Number((promptTokensSent / baselinePromptTokensSent).toFixed(4))
          : 1,
      detectorCostUsd,
      answerCostUsd,
      llmDetectorCalls,
      detectorCallsAvoided,
    },
  };
}
