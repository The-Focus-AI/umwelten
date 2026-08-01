/**
 * Headroom: how much concurrent work this machine can absorb.
 *
 * Everything here is decision-shaped and pure — the sampling policy, what
 * counts as a stable sample, and what a set of samples says about serving two
 * customers at once. Measurement itself lives in `probe.ts`, because that needs
 * metal.
 *
 * The rule from the glossary is structural: **Headroom is measured, never
 * declared.** Nothing in this module accepts a throughput number from an
 * operator, and there is deliberately no way to add one.
 */

import type { HeadroomPolicy, HeadroomSample, SaturationVerdict } from "./types.js";

/**
 * The sampling policy the Exchange can rely on. Recorded in ADR 0021, and
 * published on every Offer so a consumer knows what produced the numbers
 * rather than having to trust that every agent sampled the same way.
 *
 * The shape of it is a compromise between two failures. Sample too little and
 * the single-request number is a floor — a short stream never gets the GPU
 * fully busy, which is how the prototype run ended up with per-stream decode
 * appearing to *rise* under concurrency and one model's aggregate scaling
 * exceeding what four-way parallelism allows. Sample too much and the
 * measurement becomes the load, which is a strange thing to do to a machine
 * that is supposed to be earning.
 */
export const HEADROOM_POLICY: HeadroomPolicy = {
  /**
   * Two levels minimum, because one number cannot distinguish a runtime that
   * batches from one that queues, and those differ sixfold in aggregate under
   * load (`reports/2026-07-26-headroom-ollama-does-not-batch.md`).
   */
  levels: [1, 4],
  /**
   * How long generation must actually run for a sample to be trusted. Twenty
   * seconds is where the prototype's single-stream numbers stopped moving.
   */
  minDecodeSeconds: 20,
  /** Total machine time one Model's sampling may consume, across all levels. */
  maxSampleSeconds: 300,
  /** Idle gap between levels so one level's tail does not land in the next. */
  cooldownMs: 2_000,
  /** How long a sample stays good before the agent re-measures. */
  resampleAfterSeconds: 6 * 60 * 60,
  /**
   * Generation length, as a counting target. Long enough that a fast box still
   * decodes for `minDecodeSeconds`; self-terminating, so no `maxTokens` cap is
   * needed and nothing is truncated mid-stream (which would inflate the rate).
   */
  countTo: 900,
};

/** Never sample harder than this, whatever an operator asks for. */
export const MAX_SAMPLE_CONCURRENCY = 8;

/**
 * Clamp requested levels into something that measures rather than stresses.
 *
 * An operator can choose *where* to sample; they cannot choose how hard, and
 * they cannot choose to sample at one level only — a single point measures a
 * speed, not a Headroom.
 */
export function sanitizeLevels(requested: number[] | undefined): number[] {
  const cleaned = [...new Set((requested ?? HEADROOM_POLICY.levels).map((n) => Math.floor(n)))]
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.min(n, MAX_SAMPLE_CONCURRENCY))
    .sort((a, b) => a - b);

  if (cleaned.length === 0) return [...HEADROOM_POLICY.levels];
  // One level cannot locate saturation, so pad rather than publish a Headroom
  // that says nothing about concurrency.
  if (cleaned.length === 1) {
    const second = cleaned[0] === 1 ? 4 : 1;
    return [cleaned[0], second].sort((a, b) => a - b);
  }
  return cleaned;
}

/** Did generation run long enough for this sample to mean anything? */
export function meetsPolicy(sample: Pick<HeadroomSample, "decodeSeconds" | "errors">): boolean {
  return sample.errors === 0 && sample.decodeSeconds >= HEADROOM_POLICY.minDecodeSeconds;
}

/**
 * What a set of samples says about serving concurrent work.
 *
 * Three numbers, three outcomes, and the discriminator is the point:
 *
 *   - **batches** — aggregate throughput rises with concurrency. Two customers
 *     can be served at once.
 *   - **queues** — aggregate flat while time-to-first-token climbs. Requests
 *     are being served one at a time behind each other; the second customer
 *     waits. Measured on Ollama at its default configuration, where TTFT
 *     reached 48 seconds at four-way concurrency.
 *   - **contends** — aggregate *falls*. Concurrency is actively hurting, which
 *     is a different problem from queueing and wants a different response.
 *   - **inconclusive** — fewer than two usable levels, so no claim is made.
 *
 * A single throughput figure cannot tell these apart, which is why an Offer
 * never carries one.
 */
export function classifySaturation(samples: HeadroomSample[]): SaturationVerdict {
  const usable = samples
    .filter((s) => s.errors === 0 && s.tokensPerSecond > 0)
    .sort((a, b) => a.concurrency - b.concurrency);

  const low = usable[0];
  const high = usable[usable.length - 1];
  if (!low || !high || low.concurrency === high.concurrency) return "inconclusive";

  const scaling = high.tokensPerSecond / low.tokensPerSecond;
  if (scaling >= 1.5) return "batches";
  if (scaling < 0.9) return "contends";

  // Flat aggregate. Rising TTFT is what separates "serialized behind a queue"
  // from "already saturated at one request", and only the first is a reason to
  // refuse the Offer a second customer.
  if (high.ttftMs > low.ttftMs * 2) return "queues";
  return "inconclusive";
}

/** Can this Offer take a second customer without the first one noticing? */
export function servesConcurrently(verdict: SaturationVerdict): boolean {
  return verdict === "batches";
}

/**
 * How many tokens the counting prompt is worth, roughly — used to decide
 * whether the sample is likely to reach `minDecodeSeconds` before running it,
 * so a very slow Model can be sampled at a shorter target rather than burning
 * the whole budget on one level.
 */
export function countingPrompt(countTo: number): string {
  return `Count from 1 to ${countTo}. One number per line.`;
}
