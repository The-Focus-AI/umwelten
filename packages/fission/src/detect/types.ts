/**
 * The fission detector contract.
 *
 * A detector answers one question about an incoming user turn: does this belong
 * to the thread it landed in, or is it the start of a new chat? It returns a
 * 0..1 drift score plus the signals behind it, so the tree browser can show
 * *why* a fork happened rather than just that it did.
 *
 * Mirrors the shape of core's CompactionStrategy on purpose — same registry
 * pattern, same pluggability.
 */

import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import type { DetectorResult, FissionNode, TurnRecord, TurnAnalysis } from "../types.js";

export interface DetectorContext {
  /** The incoming user message. */
  userText: string;
  /** The node the turn arrived at. */
  node: FissionNode;
  /** Turns already in that node, oldest first. */
  recentTurns: TurnRecord[];
  /** Analysis of the incoming turn, when the engine computed one first. */
  analysis?: TurnAnalysis;
  /** The node's running compaction summary, when one exists. */
  runningSummary?: string;
  /** Model to use for LLM-backed detectors. */
  model?: ModelDetails;
  /** Score at or above which the engine will fork. */
  threshold: number;
  signal?: AbortSignal;
}

export interface FissionDetector {
  /** Stable id for registration, config, and the UI. */
  id: string;
  name: string;
  description: string;
  /** True when detect() issues a model call. Drives cost reporting. */
  usesLlm: boolean;
  detect(ctx: DetectorContext): Promise<DetectorResult>;
}

/** Build a "continue" result. Used by detectors bailing out early. */
export function continueResult(
  detectorId: string,
  ctx: DetectorContext,
  reason: string,
  extra: Partial<DetectorResult> = {},
): DetectorResult {
  return {
    detectorId,
    verdict: "continue",
    driftScore: 0,
    threshold: ctx.threshold,
    reason,
    signals: [],
    latencyMs: 0,
    usedLlm: false,
    ...extra,
  };
}
