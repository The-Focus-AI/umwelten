/**
 * Turn lifecycle events.
 *
 * The CLI prints them, the web server forwards them over SSE. Both surfaces see
 * the same sequence, so what you watch in the terminal is exactly what the tree
 * browser records.
 */

import type {
  CompactionRecord,
  DetectorResult,
  FissionNode,
  TurnAnalysis,
  TurnRecord,
} from "../types.js";

export type FissionEvent =
  | { type: "turn-start"; nodeId: string; userText: string }
  | { type: "detect-start"; nodeId: string; detectorId: string }
  | { type: "detect"; result: DetectorResult; shadow: boolean }
  | { type: "fork"; parentId: string; child: FissionNode; reason: string }
  | { type: "fork-proposed"; nodeId: string; reason: string; proposedTitle?: string }
  | { type: "answer-start"; nodeId: string }
  | { type: "answer-delta"; delta: string }
  | { type: "tool-call"; name: string; input: unknown }
  | { type: "tool-result"; name: string; isError: boolean }
  | { type: "answer"; nodeId: string; text: string }
  | { type: "analysis"; analysis: TurnAnalysis }
  | { type: "compaction"; record: CompactionRecord }
  | { type: "turn-complete"; turn: TurnRecord }
  | { type: "error"; message: string };

export type FissionEventHandler = (event: FissionEvent) => void;
