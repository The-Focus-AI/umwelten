/**
 * The candidate estimate, against a fabricated machine.
 *
 * No GPU, no `nvidia-smi`, no network. Detection effects are injected precisely
 * so a machine with 128 GB of unified memory and a machine with a 24 GB card
 * can both be asserted from a laptop that is neither.
 */

import { describe, it, expect } from "vitest";
import {
  detectResources,
  estimateCandidates,
  estimateLoadBytes,
  estimateParamsB,
  type DetectEffects,
  type MachineResources,
} from "./candidates.js";
import type { GgufModel } from "@umwelten/core/providers/llamaswap-config.js";

const GIB = 1024 ** 3;

const gguf = (alias: string, baseName: string, sizeBytes: number): GgufModel => ({
  path: `/models/${baseName}.gguf`,
  baseName,
  alias,
  sizeBytes,
});

const DISK: GgufModel[] = [
  gguf("gemma-4-26b", "gemma-4-26B-Q4_K_M", 16 * GIB),
  gguf("qwen-4-32b", "qwen-4-32B-Q4_K_M", 19 * GIB),
  gguf("llama-9-70b", "llama-9-70B-Q4_K_M", 40 * GIB),
];

const machine = (usableBytes: number, name = "test accelerator"): MachineResources => ({
  totalMemoryBytes: usableBytes * 1.5,
  freeMemoryBytes: usableBytes,
  accelerator: { kind: "cpu", name, usableBytes, evidence: "fabricated" },
});

const effects = (overrides: Partial<DetectEffects> = {}): DetectEffects => ({
  platform: () => "linux",
  arch: () => "x64",
  totalMemory: () => 64 * GIB,
  freeMemory: () => 32 * GIB,
  run: () => undefined,
  ...overrides,
});

describe("estimateParamsB", () => {
  it("derives parameters from the file, not the filename", () => {
    // A filename is a claim; a file size is a measurement. Mixture-of-experts
    // models are named for one number and sized by another, and name-parsing
    // gets exactly those wrong.
    expect(estimateParamsB(16 * GIB, "Q4_K_M")).toBeCloseTo(28, 0);
    // Same weights at a heavier quant: same model, twice the file.
    expect(estimateParamsB(28 * GIB, "Q8_0")).toBeCloseTo(28, 0);
  });

  it("assumes a middling quantization when the marker is missing", () => {
    expect(estimateParamsB(10 * GIB, "unknown")).toBeGreaterThan(0);
  });
});

describe("estimateLoadBytes", () => {
  it("costs more than the file it loads", () => {
    // Weights plus compute buffers plus KV cache. A budget check against the
    // raw file size would pass models that then fail to load.
    expect(estimateLoadBytes(16 * GIB, "Q4_K_M", 32_768)).toBeGreaterThan(16 * GIB);
  });

  it("grows with the pinned context length", () => {
    const small = estimateLoadBytes(16 * GIB, "Q4_K_M", 8_192);
    const large = estimateLoadBytes(16 * GIB, "Q4_K_M", 131_072);
    expect(large).toBeGreaterThan(small);
  });
});

describe("estimateCandidates", () => {
  it("excludes a Model too large to load, and says why", () => {
    const set = estimateCandidates({
      resources: machine(24 * GIB, "24 GiB card"),
      weights: DISK,
      contextTokens: 32_768,
    });

    expect(set.candidates.map((c) => c.alias)).not.toContain("llama-9-70b");
    const reason = set.excluded.find((e) => e.alias === "llama-9-70b")?.reason;
    expect(reason).toMatch(/24 GiB card/);
    expect(reason).toMatch(/needs about/);
  });

  it("keeps what fits", () => {
    const set = estimateCandidates({
      resources: machine(128 * GIB),
      weights: DISK,
      contextTokens: 32_768,
    });
    expect(set.candidates.map((c) => c.alias).sort()).toEqual([
      "gemma-4-26b",
      "llama-9-70b",
      "qwen-4-32b",
    ]);
    expect(set.excluded).toEqual([]);
  });

  it("takes the better quantization when both fit, and reports the other", () => {
    const both = [
      gguf("gemma-4-26b", "gemma-4-26B-Q4_K_M", 16 * GIB),
      gguf("gemma-4-26b", "gemma-4-26B-Q8_0", 28 * GIB),
    ];
    const set = estimateCandidates({
      resources: machine(128 * GIB),
      weights: both,
      contextTokens: 32_768,
    });

    expect(set.candidates).toHaveLength(1);
    expect(set.candidates[0].quantization).toBe("Q8_0");
    expect(set.excluded[0].reason).toMatch(/larger quantization/);
  });

  it("lets an explicit list override the estimate entirely", () => {
    // Not a filter over the estimate — instead of it. Someone who knows their
    // machine better than this arithmetic should not have to argue with it.
    const set = estimateCandidates({
      resources: machine(8 * GIB, "tiny box"),
      weights: DISK,
      contextTokens: 32_768,
      explicit: ["llama-9-70b"],
    });

    expect(set.source).toBe("operator");
    expect(set.candidates.map((c) => c.alias)).toEqual(["llama-9-70b"]);
    expect(set.excluded).toEqual([]);
  });

  it("never claims a Capability", () => {
    // Capabilities come only from probing (ADR 0015). This stage never ran a
    // model, so there is nothing here it could honestly say.
    const set = estimateCandidates({
      resources: machine(128 * GIB),
      weights: DISK,
      contextTokens: 32_768,
    });
    expect(JSON.stringify(set)).not.toMatch(/capabilit|tool-calling|streaming|reasoning/i);
  });

  it("excludes a file whose size could not be read, rather than assuming it fits", () => {
    const set = estimateCandidates({
      resources: machine(128 * GIB),
      weights: [gguf("mystery", "mystery-Q4_K_M", 0)],
      contextTokens: 32_768,
    });
    expect(set.candidates).toEqual([]);
    expect(set.excluded[0].reason).toMatch(/file size/);
  });

  it("finds nothing on a machine too small for anything, without failing", () => {
    // "Nothing fits" is an answer. The managed planner turns it into a refusal
    // to start; the estimate's job is only to say so.
    const set = estimateCandidates({
      resources: machine(2 * GIB, "raspberry pi"),
      weights: DISK,
      contextTokens: 32_768,
    });
    expect(set.candidates).toEqual([]);
    expect(set.excluded).toHaveLength(3);
  });
});

describe("detectResources", () => {
  it("prefers a discrete accelerator's own memory over the machine's", () => {
    const resources = detectResources(
      effects({ run: () => "NVIDIA GeForce RTX 4090, 24564\n" }),
    );
    expect(resources.accelerator.kind).toBe("cuda");
    expect(resources.accelerator.name).toBe("NVIDIA GeForce RTX 4090");
    // Not the 64 GiB of system RAM — the card's 24, less headroom.
    expect(resources.accelerator.usableBytes).toBeLessThan(24 * GIB);
    expect(resources.accelerator.usableBytes).toBeGreaterThan(20 * GIB);
  });

  it("uses the first card rather than adding them up", () => {
    // Splitting a model across cards is a serving decision this estimate does
    // not make, so summing them would promise something nothing delivers.
    const resources = detectResources(
      effects({ run: () => "RTX 4090, 24564\nRTX 4090, 24564\n" }),
    );
    expect(resources.accelerator.usableBytes).toBeLessThan(25 * GIB);
  });

  it("treats Apple Silicon as one shared pool, and leaves room in it", () => {
    const resources = detectResources(
      effects({ platform: () => "darwin", arch: () => "arm64", totalMemory: () => 128 * GIB }),
    );
    expect(resources.accelerator.kind).toBe("apple-silicon");
    // A machine that serves right up until its owner opens a browser is not
    // serving.
    expect(resources.accelerator.usableBytes).toBeLessThan(128 * GIB);
  });

  it("falls back to system memory when there is no accelerator", () => {
    const resources = detectResources(effects());
    expect(resources.accelerator.kind).toBe("cpu");
    expect(resources.accelerator.usableBytes).toBeLessThan(64 * GIB);
  });

  it("survives nvidia-smi being absent or broken", () => {
    // Not installed, not on PATH, and failed all mean the same thing, and none
    // of them should stop an agent from starting.
    expect(detectResources(effects({ run: () => undefined })).accelerator.kind).toBe("cpu");
    expect(detectResources(effects({ run: () => "" })).accelerator.kind).toBe("cpu");
    expect(detectResources(effects({ run: () => "garbage" })).accelerator.kind).toBe("cpu");
  });

  it("needs no network", () => {
    // The estimate reads file sizes and installed memory. An agent that cannot
    // decide what to serve without reaching a leaderboard stops working when
    // the leaderboard does.
    const reached: string[] = [];
    detectResources(effects({ run: (cmd) => (reached.push(cmd), undefined) }));
    expect(reached).toEqual(["nvidia-smi"]);
  });
});
