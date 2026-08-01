/**
 * The Headroom policy, and what a set of samples means.
 *
 * Pure decisions only — measurement is in `probe.ts` and needs metal.
 */

import { describe, it, expect } from "vitest";
import {
  HEADROOM_POLICY,
  MAX_SAMPLE_CONCURRENCY,
  classifySaturation,
  meetsPolicy,
  sanitizeLevels,
  servesConcurrently,
} from "./headroom.js";
import type { HeadroomSample } from "./types.js";

const sample = (overrides: Partial<HeadroomSample> = {}): HeadroomSample => ({
  concurrency: 1,
  ttftMs: 300,
  tokensPerSecond: 94,
  decodeTokensPerSecond: 114,
  errors: 0,
  decodeSeconds: 25,
  meetsPolicy: true,
  ...overrides,
});

describe("HEADROOM_POLICY", () => {
  it("samples at more than one concurrency level", () => {
    // One number cannot tell a batching runtime from a serializing one, and
    // under load those differ sixfold.
    expect(HEADROOM_POLICY.levels.length).toBeGreaterThan(1);
  });

  it("bounds how much machine time sampling may take", () => {
    // Sampling is not supposed to become the load on a machine that is meant
    // to be earning.
    expect(HEADROOM_POLICY.maxSampleSeconds).toBeGreaterThan(0);
    expect(HEADROOM_POLICY.cooldownMs).toBeGreaterThan(0);
  });
});

describe("sanitizeLevels", () => {
  it("caps how hard an operator can sample", () => {
    expect(sanitizeLevels([64])).not.toContain(64);
    expect(Math.max(...sanitizeLevels([64]))).toBe(MAX_SAMPLE_CONCURRENCY);
  });

  it("pads a single level, because one point is a speed and not a Headroom", () => {
    expect(sanitizeLevels([1])).toEqual([1, 4]);
    expect(sanitizeLevels([4])).toEqual([1, 4]);
  });

  it("falls back to the policy when given nothing usable", () => {
    expect(sanitizeLevels(undefined)).toEqual(HEADROOM_POLICY.levels);
    expect(sanitizeLevels([])).toEqual(HEADROOM_POLICY.levels);
    expect(sanitizeLevels([0, -3])).toEqual(HEADROOM_POLICY.levels);
  });

  it("dedupes and orders, so samples read low to high", () => {
    expect(sanitizeLevels([4, 1, 4])).toEqual([1, 4]);
  });
});

describe("meetsPolicy", () => {
  it("rejects a window too short to be a rate", () => {
    // A short stream never gets the GPU busy, so the number is a floor. This
    // is the failure that had per-stream decode appearing to *rise* under
    // concurrency in the prototype run.
    expect(meetsPolicy({ decodeSeconds: 3, errors: 0 })).toBe(false);
    expect(meetsPolicy({ decodeSeconds: HEADROOM_POLICY.minDecodeSeconds, errors: 0 })).toBe(true);
  });

  it("rejects a sample that had errors in it", () => {
    expect(meetsPolicy({ decodeSeconds: 60, errors: 1 })).toBe(false);
  });
});

describe("classifySaturation", () => {
  it("calls it batching when aggregate throughput rises", () => {
    const verdict = classifySaturation([
      sample({ concurrency: 1, tokensPerSecond: 94, ttftMs: 300 }),
      sample({ concurrency: 4, tokensPerSecond: 310, ttftMs: 900 }),
    ]);
    expect(verdict).toBe("batches");
    expect(servesConcurrently(verdict)).toBe(true);
  });

  it("calls it queueing when aggregate is flat and TTFT climbs", () => {
    // The measured Ollama shape: throughput unchanged from one to four
    // concurrent requests, time-to-first-token out to 48 seconds. The second
    // customer is simply waiting for the first.
    const verdict = classifySaturation([
      sample({ concurrency: 1, tokensPerSecond: 94, ttftMs: 700 }),
      sample({ concurrency: 4, tokensPerSecond: 96, ttftMs: 48_000 }),
    ]);
    expect(verdict).toBe("queues");
    expect(servesConcurrently(verdict)).toBe(false);
  });

  it("distinguishes contention from queueing", () => {
    // Falling aggregate is a different problem from a queue, and wants a
    // different response, so it does not get the same word.
    const verdict = classifySaturation([
      sample({ concurrency: 1, tokensPerSecond: 94, ttftMs: 300 }),
      sample({ concurrency: 4, tokensPerSecond: 61, ttftMs: 400 }),
    ]);
    expect(verdict).toBe("contends");
    expect(servesConcurrently(verdict)).toBe(false);
  });

  it("makes no claim from a single level", () => {
    expect(classifySaturation([sample()])).toBe("inconclusive");
    expect(classifySaturation([])).toBe("inconclusive");
  });

  it("ignores samples that errored rather than reading them as slow", () => {
    // An errored level reports zero tokens/sec, which looks exactly like
    // catastrophic contention if you let it into the comparison.
    expect(
      classifySaturation([
        sample({ concurrency: 1, tokensPerSecond: 94 }),
        sample({ concurrency: 4, tokensPerSecond: 0, errors: 4 }),
      ]),
    ).toBe("inconclusive");
  });
});
