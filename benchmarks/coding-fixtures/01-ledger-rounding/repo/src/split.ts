import type { Money } from "./money.ts";

/**
 * Allocate `total` across participants in proportion to `weights`
 * so the returned shares sum exactly to `total.minor`.
 */
export function splitByWeights(total: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) {
    throw new Error("weights must not be empty");
  }
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) {
    throw new Error("weights must be finite non-negative numbers");
  }
  const sumWeights = weights.reduce((acc, w) => acc + w, 0);
  if (sumWeights <= 0) {
    throw new Error("sum of weights must be positive");
  }

  // BUG: naive floor drops remainder pennies (and breaks negative credit splits)
  return weights.map((w) => ({
    minor: Math.floor((total.minor * w) / sumWeights),
    currency: total.currency.toUpperCase(),
  }));
}
