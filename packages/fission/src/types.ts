/**
 * Core types for session fission.
 *
 * The model: a conversation is a *tree*, not a line. Every user turn is scored
 * for topic drift against the node it landed in. When drift crosses a threshold
 * the turn is spun off into a child node seeded with a compacted carry-over of
 * the parent, and the parent is left intact.
 *
 * Everything a turn produced — the detector's reasoning, every shadow
 * detector's verdict, the compaction that ran, the token deltas — is recorded
 * on the TurnRecord so a run can be replayed and re-scored offline without
 * re-issuing any model calls.
 */

import type { ModelDetails } from "@umwelten/core/cognition/types.js";

/** What the detector decided to do with a turn. */
export type FissionVerdict = "continue" | "fork";

/** Lightweight lexical fingerprint of a node or turn. Deterministic, no LLM. */
export interface TopicSignature {
  /** Distinct stemmed content terms, lowercased, stopwords stripped. */
  terms: string[];
  /** stem → frequency within the sampled text. */
  weights: Record<string, number>;
  /** stem → a readable surface form, for titles and signal notes. */
  display?: Record<string, string>;
  /** Number of turns folded into this signature. */
  turnCount: number;
}

/** What the analysis pass extracted from a single turn. */
export interface TurnAnalysis {
  /** One sentence: what happened in this turn. */
  summary: string;
  /** Durable facts worth carrying forward. */
  facts: string[];
  /** Short topic labels (2-4 words each). */
  topics: string[];
  /** What the turn left unresolved, if anything. */
  openQuestion?: string;
  /** Model latency for the analysis pass. */
  latencyMs: number;
  /** True when the analysis fell back to deterministic extraction (no LLM). */
  degraded?: boolean;
}

/** One named input to a drift score, surfaced in the UI so a verdict is legible. */
export interface DetectorSignal {
  label: string;
  /** Normalized 0..1 where higher = more evidence of a new chat. */
  value: number;
  note?: string;
}

/** A detector's verdict on one turn. */
export interface DetectorResult {
  detectorId: string;
  verdict: FissionVerdict;
  /** 0..1 — how strongly this reads as the start of a NEW chat. */
  driftScore: number;
  /** The cutoff this detector compared driftScore against. */
  threshold: number;
  /** Human-readable justification. Shown verbatim in the tree browser. */
  reason: string;
  signals: DetectorSignal[];
  /** Suggested title for the spun-off child, when forking. */
  proposedTitle?: string;
  latencyMs: number;
  costUsd?: number;
  usedLlm: boolean;
  /** Set when the detector failed and fell back to "continue". */
  error?: string;
}

/** A single compaction pass over a node's context. */
export interface CompactionRecord {
  strategyId: string;
  segmentStart: number;
  segmentEnd: number;
  replacementCount: number;
  tokensBefore: number;
  tokensAfter: number;
  /** tokensAfter / tokensBefore. Lower = more aggressive. */
  ratio: number;
  latencyMs: number;
  /** The replacement text, so the UI can diff strategies side by side. */
  summaryText: string;
  /** Set when the strategy threw; the context was left untouched. */
  error?: string;
}

/** Human ground truth on a decision. Turns usage into a labeled dataset. */
export interface TurnLabel {
  verdict: FissionVerdict;
  note?: string;
  at: string;
}

export interface ToolCallRecord {
  name: string;
  argsPreview: string;
}

export interface TurnUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

/** Everything one user→assistant exchange produced. Append-only. */
export interface TurnRecord {
  id: string;
  treeId: string;
  /** Node the turn was answered in (post-fork, if it forked). */
  nodeId: string;
  /** Node the turn arrived at (pre-fork). Differs from nodeId on a fork. */
  arrivedAtNodeId: string;
  /** 0-based position within nodeId. */
  index: number;
  timestamp: string;
  userText: string;
  assistantText: string;
  toolCalls: ToolCallRecord[];
  analysis?: TurnAnalysis;
  /** The active detector's verdict — the one that actually decided. */
  detector?: DetectorResult;
  /** Other detectors scored on the same turn but not acted on. */
  shadowDetectors: DetectorResult[];
  /** The active compaction pass, when one ran this turn. */
  compaction?: CompactionRecord;
  /** Compaction runs the playground triggered later, keyed by strategy id. */
  altCompactions?: Record<string, CompactionRecord>;
  contextTokensBefore: number;
  contextTokensAfter: number;
  usage?: TurnUsage;
  wallMs: number;
  label?: TurnLabel;
}

/** A branch of the conversation tree. */
export interface FissionNode {
  id: string;
  treeId: string;
  parentId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** The turn in the parent whose drift caused this node to exist. */
  bornFromTurnId?: string;
  /** Compacted parent context this node started from. */
  seed?: {
    strategyId: string;
    text: string;
    tokensBefore: number;
    tokensAfter: number;
  };
  turnIds: string[];
  topicSignature: TopicSignature;
  status: "active" | "archived";
}

export interface FissionConfig {
  /** Detector that decides forks. */
  detectorId: string;
  /** Detectors scored for comparison but never acted on. */
  shadowDetectorIds: string[];
  /** Strategy used for the running per-turn compaction. */
  compactionStrategyId: string;
  /** Strategy used to seed a spun-off child from its parent. */
  carryoverStrategyId: string;
  /** Compact after every turn (the experiment's default) vs only at a size threshold. */
  compactEveryTurn: boolean;
  /** Token count above which compaction runs when compactEveryTurn is false. */
  compactAboveTokens: number;
  /**
   * Messages left verbatim at the tail. Compacting *everything* every turn
   * makes short follow-ups ("why?", "do that again") unanswerable, because the
   * thing they refer to only survives as a summary line.
   */
  keepRecentMessages: number;
  /** Score at or above which the active detector forks. */
  driftThreshold: number;
  /** When false, forks are proposed and recorded but not applied. */
  autoFork: boolean;
  /** Turns a node must hold before it may fork (avoids forking on turn 1). */
  minTurnsBeforeFork: number;
}

export const DEFAULT_FISSION_CONFIG: FissionConfig = {
  detectorId: "hybrid",
  shadowDetectorIds: ["lexical-drift", "llm-judge", "never"],
  compactionStrategyId: "rolling-summary",
  carryoverStrategyId: "topic-carryover",
  compactEveryTurn: true,
  compactAboveTokens: 4000,
  keepRecentMessages: 4,
  driftThreshold: 0.6,
  autoFork: true,
  minTurnsBeforeFork: 1,
};

export interface FissionTreeData {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: ModelDetails;
  config: FissionConfig;
  rootId: string;
  activeNodeId: string;
  nodes: Record<string, FissionNode>;
}

/** Aggregate view used by the report and the dashboard header. */
export interface TreeStats {
  nodeCount: number;
  turnCount: number;
  forkCount: number;
  maxDepth: number;
  totalCostUsd: number;
  /** Mean tokensAfter/tokensBefore across compactions. */
  meanCompactionRatio: number;
  /** Tokens saved vs. never compacting, summed over turns. */
  tokensSaved: number;
  labeledTurns: number;
}
