import { describe, expect, it } from "vitest";
import {
  brierScore,
  rankedProbabilityScore,
  reliabilityBins,
  selectiveRisk,
} from "./metrics.js";

describe("judgment metrics", () => {
  it("uses class-summed Brier, not scalar binary or class-averaged error", () => {
    expect(brierScore([0.1, 0.3, 0.6], 1)).toBeCloseTo(0.86);
    expect(brierScore([0.2, 0.8], 1)).toBeCloseTo(0.08);
    expect(brierScore([0, 1], 0)).toBe(2);
  });
  it("respects order and excludes the uninformative final boundary", () => {
    expect(rankedProbabilityScore([0.1, 0.3, 0.6], 1)).toBeCloseTo(0.185);
    expect(rankedProbabilityScore([0, 1, 0], 0)).toBe(0.5);
    expect(rankedProbabilityScore([0, 0, 1], 0)).toBe(1);
  });
  it("handles bin boundaries, certainty and empty bins without inventing accuracy", () => {
    const bins = reliabilityBins(
      [
        { probability: 0, correct: false },
        { probability: 0.5, correct: true },
        { probability: 0.99, correct: false },
        { probability: 1, correct: true },
      ],
      4,
    );
    expect(bins.map((b) => b.count)).toEqual([1, 0, 1, 2]);
    expect(bins[1].accuracy).toBeNull();
    expect(bins[3].meanProbability).toBe(0.995);
    expect(bins[3].accuracy).toBe(0.5);
  });
  it("includes the threshold boundary and keeps zero coverage distinct from zero risk", () => {
    const predictions = [
      { probability: 0.8, correct: false },
      { probability: 0.9, correct: true },
    ];
    expect(selectiveRisk(predictions, 0.8)).toEqual({
      threshold: 0.8,
      accepted: 2,
      coverage: 1,
      errorRate: 0.5,
    });
    expect(selectiveRisk(predictions, 0.9).errorRate).toBe(0);
    expect(selectiveRisk(predictions, 0.91).errorRate).toBeNull();
    expect(selectiveRisk([], 0.9).coverage).toBeNull();
  });
  it("rejects bad labels and probabilities rather than manufacturing a score", () => {
    expect(() => brierScore([0.2, 0.7], 0)).toThrow();
    expect(() => brierScore([0.2, 0.8], 2)).toThrow();
    expect(() => rankedProbabilityScore([NaN, 1], 1)).toThrow();
    expect(() =>
      reliabilityBins([{ probability: Infinity, correct: true }]),
    ).toThrow();
  });
});
