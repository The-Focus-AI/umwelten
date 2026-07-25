/**
 * hybrid — lexical gate, LLM tiebreak.
 *
 * Most turns are obvious. A follow-up question sharing most of its vocabulary
 * with the last exchange doesn't need a model call to classify, and neither
 * does "different question — how do I renew my passport?" dropped into a thread
 * about KV caches. Only the band in between is worth paying for.
 *
 * The two gates are what make this cheap: the report tracks what fraction of
 * turns escalated to the judge, which is the number that decides whether
 * per-turn detection is affordable at all.
 */

import type { DetectorResult } from "../types.js";
import type { DetectorContext, FissionDetector } from "./types.js";
import { scoreLexicalDrift } from "./lexical-drift.js";
import { llmJudgeDetector } from "./llm-judge.js";

/** Below this the lexical score decides "continue" on its own. */
export const LOW_GATE = 0.3;
/** At or above this the lexical score decides "fork" on its own. */
export const HIGH_GATE = 0.85;

export const hybridDetector: FissionDetector = {
  id: "hybrid",
  name: "Hybrid (lexical gate + LLM tiebreak)",
  description:
    "Runs the free lexical detector first; only escalates to the LLM judge when the score lands in the ambiguous middle band.",
  usesLlm: true,
  async detect(ctx: DetectorContext): Promise<DetectorResult> {
    const started = Date.now();
    const lexical = scoreLexicalDrift(ctx);

    const gateSignal = {
      label: "gate",
      value: lexical.driftScore,
      note: `lexical ${lexical.driftScore.toFixed(2)} vs band [${LOW_GATE}, ${HIGH_GATE})`,
    };

    if (lexical.driftScore < LOW_GATE) {
      return {
        ...lexical,
        detectorId: "hybrid",
        verdict: "continue",
        reason: `Lexical score ${lexical.driftScore.toFixed(2)} is below the ${LOW_GATE} gate — clearly a continuation, no model call. (${lexical.reason})`,
        signals: [...lexical.signals, gateSignal],
        latencyMs: Date.now() - started,
        usedLlm: false,
      };
    }

    if (lexical.driftScore >= HIGH_GATE) {
      return {
        ...lexical,
        detectorId: "hybrid",
        verdict: "fork",
        reason: `Lexical score ${lexical.driftScore.toFixed(2)} clears the ${HIGH_GATE} gate — unambiguously new, no model call. (${lexical.reason})`,
        signals: [...lexical.signals, gateSignal],
        latencyMs: Date.now() - started,
        usedLlm: false,
      };
    }

    const judged = await llmJudgeDetector.detect(ctx);
    return {
      ...judged,
      detectorId: "hybrid",
      reason: `Lexical score ${lexical.driftScore.toFixed(2)} landed in the ambiguous band; judge says: ${judged.reason}`,
      signals: [...lexical.signals, gateSignal, ...judged.signals],
      proposedTitle: judged.proposedTitle ?? lexical.proposedTitle,
      latencyMs: Date.now() - started,
    };
  },
};
