/**
 * Managed mode's decisions, from a fabricated machine state.
 *
 * There is no GPU in this file, no process, and no filesystem. Everything
 * managed mode *decides* — which weights, at what context and quantization,
 * which runtime is allowed to serve them — is asserted here; only measurement
 * needs metal.
 */

import { describe, it, expect } from "vitest";
import type { GgufModel } from "@umwelten/core/providers/llamaswap-config.js";
import {
  ManagedModeError,
  RUNTIME_CONCURRENCY,
  chooseManagedRuntime,
  extractQuant,
  matchWeights,
  planManagedRuntime,
  selectWeights,
  verifyConcurrency,
} from "./managed.js";
import type { ManagedOptions } from "./types.js";

const gguf = (baseName: string, sizeBytes = 1_000): GgufModel => ({
  path: `/models/${baseName}.gguf`,
  baseName,
  // Mirrors what the scanner does, so the fixtures behave like real ones.
  alias: baseName
    .toLowerCase()
    .replace(/[-._]?(ud-)?(q\d(_k_[ms])?|q\d_\d|bf16|f16|mxfp4)\b.*$/i, "")
    .replace(/[-._]?(it|instruct)\b/gi, "")
    .replace(/[._]/g, "-"),
  sizeBytes,
});

const DISK: GgufModel[] = [
  gguf("gemma-4-26B-A4B-it-UD-Q4_K_M", 16_000),
  gguf("gemma-4-26B-A4B-it-Q8_0", 28_000),
  gguf("qwen-4-32B-Q4_K_M", 19_000),
];

const managed = (overrides: Partial<ManagedOptions> = {}): ManagedOptions => ({
  models: ["gemma-4-26b-a4b"],
  contextTokens: 32_768,
  parallel: 4,
  port: 7450,
  configPath: "/tmp/llama-swap.yaml",
  ...overrides,
});

describe("extractQuant", () => {
  it("recovers the quantization the alias throws away", () => {
    expect(extractQuant("gemma-4-26B-A4B-it-UD-Q4_K_M.gguf")).toBe("Q4_K_M");
    expect(extractQuant("qwen-4-32B-Q8_0.gguf")).toBe("Q8_0");
    expect(extractQuant("model-BF16.gguf")).toBe("BF16");
  });

  it("says so rather than guessing when there is no marker", () => {
    expect(extractQuant("some-model.gguf")).toBe("unknown");
  });
});

describe("chooseManagedRuntime", () => {
  it("refuses a runtime that serves one request at a time", () => {
    // Measured, not assumed: aggregate throughput flat from one to four
    // concurrent requests, TTFT climbing to 48 seconds. A Supplier that
    // serializes cannot have two customers.
    expect(RUNTIME_CONCURRENCY.ollama).toBe("serializes");
    expect(() => chooseManagedRuntime("ollama")).toThrow(ManagedModeError);
    expect(() => chooseManagedRuntime("ollama")).toThrow(/one at a time/);
  });

  it("refuses a runtime nobody has measured, rather than assuming", () => {
    expect(() => chooseManagedRuntime("lmstudio")).toThrow(/has not been measured/);
    expect(() => chooseManagedRuntime("something-new")).toThrow(/has not been measured/);
  });

  it("accepts the runtime measured to batch", () => {
    expect(chooseManagedRuntime("llamaswap")).toBe("llamaswap");
    expect(chooseManagedRuntime()).toBe("llamaswap");
  });
});

describe("selectWeights", () => {
  it("takes only an exact match when a quantization is pinned", () => {
    // A request for Q4_K_M silently served as Q8 is a different Offer from the
    // one that was published.
    const chosen = selectWeights(matchWeights("gemma-4-26b-a4b", DISK), "Q4_K_M");
    expect(chosen?.baseName).toContain("Q4_K_M");
  });

  it("finds nothing rather than substituting when the pin is unavailable", () => {
    expect(selectWeights(matchWeights("gemma-4-26b-a4b", DISK), "Q2_K")).toBeUndefined();
  });

  it("takes the highest-quality quant when nothing is pinned", () => {
    const chosen = selectWeights(matchWeights("gemma-4-26b-a4b", DISK));
    expect(chosen?.baseName).toContain("Q8_0");
  });
});

describe("planManagedRuntime", () => {
  it("records the quantization it actually chose, even unpinned", () => {
    // Pinning means reproducible, not merely explicit — an operator has to be
    // able to see what the Offer is serving.
    const plan = planManagedRuntime({ managed: managed(), available: DISK });
    expect(plan.models[0].quantization).toBe("Q8_0");
  });

  it("writes the pinned context size into the serving configuration", () => {
    const plan = planManagedRuntime({
      managed: managed({ contextTokens: 16_384 }),
      available: DISK,
    });
    expect(plan.config).toContain("--ctx-size 16384");
    // Not the generator's "0 means model maximum" default, which is the thing
    // managed mode exists to stop inheriting.
    expect(plan.config).not.toContain("--ctx-size 0");
  });

  it("configures the runtime for concurrent slots", () => {
    // llama-server is capable of batching and configured out of it by default;
    // without --parallel a managed Offer would serialize exactly like the
    // runtime we refused.
    const plan = planManagedRuntime({ managed: managed({ parallel: 4 }), available: DISK });
    expect(plan.config).toContain("--parallel 4");
  });

  it("refuses to plan a runtime with one slot", () => {
    try {
      planManagedRuntime({ managed: managed({ parallel: 1 }), available: DISK });
      expect.unreachable("should have refused a single-slot runtime");
    } catch (error) {
      expect(error).toBeInstanceOf(ManagedModeError);
      expect((error as ManagedModeError).message).toMatch(/1 concurrent slot/);
      expect((error as ManagedModeError).detail).toMatch(/two customers/);
    }
  });

  it("refuses an unpinned context length", () => {
    expect(() =>
      planManagedRuntime({ managed: managed({ contextTokens: 0 }), available: DISK }),
    ).toThrow(/explicit context length/);
  });

  it("refuses an empty Model list rather than serving whatever it finds", () => {
    expect(() => planManagedRuntime({ managed: managed({ models: [] }), available: DISK })).toThrow(
      /explicit list of Models/,
    );
  });

  it("reports Models with no weights instead of quietly serving fewer", () => {
    const plan = planManagedRuntime({
      managed: managed({ models: ["gemma-4-26b-a4b", "llama-9-70b"] }),
      available: DISK,
    });
    expect(plan.missing).toEqual(["llama-9-70b"]);
    expect(plan.models).toHaveLength(1);
  });

  it("refuses two requests that resolve to the same weights", () => {
    // The config generator would collapse them and the Offer set would come
    // out a Model short with nothing saying why.
    expect(() =>
      planManagedRuntime({
        managed: managed({ models: ["gemma-4-26b-a4b", "gemma-4-26B-A4B-it-Q8_0"] }),
        available: DISK,
      }),
    ).toThrow(/same weights/);
  });

  it("points the runtime at the port it was told to use", () => {
    const plan = planManagedRuntime({ managed: managed({ port: 7451 }), available: DISK });
    expect(plan.baseUrl).toBe("http://127.0.0.1:7451/v1");
    expect(plan.args).toContain("127.0.0.1:7451");
  });

  it("serves only what was pinned, not everything on disk", () => {
    const plan = planManagedRuntime({ managed: managed(), available: DISK });
    expect(plan.models).toHaveLength(1);
    expect(plan.config).not.toContain("qwen");
  });
});

describe("verifyConcurrency", () => {
  it("accepts a runtime measured to batch", () => {
    expect(verifyConcurrency("batches")).toEqual({ ok: true });
  });

  it("rejects one that queues, and says which failure it was", () => {
    const verdict = verifyConcurrency("queues");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/one at a time/);
  });

  it("distinguishes contention from queueing", () => {
    // They want different responses, so they do not collapse into one message.
    const verdict = verifyConcurrency("contends");
    expect(verdict.ok === false && verdict.reason).toMatch(/falling/);
  });

  it("rejects an inconclusive measurement rather than assuming the best", () => {
    expect(verifyConcurrency("inconclusive").ok).toBe(false);
  });
});
