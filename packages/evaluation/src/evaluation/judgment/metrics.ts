/** All distributions passed to these metrics are validated, never normalized. */
function check(probabilities: readonly number[], observed: number): void {
  if (
    probabilities.length < 2 ||
    !Number.isInteger(observed) ||
    observed < 0 ||
    observed >= probabilities.length ||
    probabilities.some((p) => !Number.isFinite(p) || p < 0 || p > 1) ||
    Math.abs(probabilities.reduce((sum, p) => sum + p, 0) - 1) > 0.0001
  ) {
    throw new Error("Invalid probability distribution or observed index");
  }
}

/** Multiclass Brier: sum over classes, range 0–2 (binary is twice the scalar convention). */
export function brierScore(
  probabilities: readonly number[],
  observed: number,
): number {
  check(probabilities, observed);
  return probabilities.reduce(
    (sum, p, i) => sum + (p - Number(i === observed)) ** 2,
    0,
  );
}

/** Normalized ranked probability score: cumulative error over K-1 ordered boundaries. */
export function rankedProbabilityScore(
  probabilities: readonly number[],
  observed: number,
): number {
  check(probabilities, observed);
  let cumulative = 0;
  let score = 0;
  for (let i = 0; i < probabilities.length - 1; i++) {
    cumulative += probabilities[i];
    score += (cumulative - Number(observed <= i)) ** 2;
  }
  return score / (probabilities.length - 1);
}

export interface Prediction {
  probability: number;
  correct: boolean;
}

/** Top-label reliability; empty bins explicitly remain empty. Includes p=1 in the last bin. */
export function reliabilityBins(
  predictions: readonly Prediction[],
  count = 10,
) {
  if (!Number.isInteger(count) || count < 1)
    throw new Error("Invalid bin count");
  const bins = Array.from({ length: count }, (_, i) => ({
    lower: i / count,
    upper: (i + 1) / count,
    count: 0,
    probabilitySum: 0,
    correct: 0,
  }));
  for (const prediction of predictions) {
    if (
      !Number.isFinite(prediction.probability) ||
      prediction.probability < 0 ||
      prediction.probability > 1
    )
      throw new Error("Invalid probability");
    const bin =
      bins[Math.min(count - 1, Math.floor(prediction.probability * count))];
    bin.count++;
    bin.probabilitySum += prediction.probability;
    bin.correct += Number(prediction.correct);
  }
  return bins.map((bin) => ({
    lower: bin.lower,
    upper: bin.upper,
    count: bin.count,
    meanProbability: bin.count ? bin.probabilitySum / bin.count : null,
    accuracy: bin.count ? bin.correct / bin.count : null,
  }));
}

/** Descriptive only: thresholds must be selected on development data, not this curve. */
export function selectiveRisk(
  predictions: readonly Prediction[],
  threshold: number,
) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw new Error("Invalid threshold");
  reliabilityBins(predictions); // same validation as reliability reporting
  const accepted = predictions.filter((p) => p.probability >= threshold);
  return {
    threshold,
    accepted: accepted.length,
    coverage: predictions.length ? accepted.length / predictions.length : null,
    errorRate: accepted.length
      ? accepted.filter((p) => !p.correct).length / accepted.length
      : null,
  };
}
