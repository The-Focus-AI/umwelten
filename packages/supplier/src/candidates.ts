/**
 * Working out which Models this machine could plausibly serve.
 *
 * This stage is **allowed to be wrong**, and saying so is the point. It is
 * arithmetic over file sizes and installed memory — it never executes a model,
 * so it produces candidates, not evidence. Nothing downstream may treat a
 * candidate as an Offer: Capabilities come only from probing (ADR 0015), and a
 * candidate that survives this and then fails to load produces no Offer at all.
 *
 * What it buys is time. Probing a 70B on a 32 GB laptop costs minutes to learn
 * something arithmetic knew for free.
 *
 * No network. The estimate uses what is on this machine — file sizes, installed
 * memory, and the accelerator — because a supplier agent that cannot decide
 * what to serve without reaching a leaderboard is a supplier agent that stops
 * working when the leaderboard does.
 */

import { extractQuant } from "./managed.js";
import type { GgufModel } from "@umwelten/core/providers/llamaswap-config.js";

/** What a quantization costs per weight, in bits. Approximate by construction. */
const BITS_PER_WEIGHT: Record<string, number> = {
  F32: 32,
  BF16: 16,
  F16: 16,
  FP16: 16,
  Q8_0: 8.5,
  Q6_K: 6.6,
  Q5_K_M: 5.7,
  Q5_K_S: 5.5,
  Q5_0: 5.5,
  Q4_K_M: 4.9,
  Q4_K_S: 4.6,
  Q4_0: 4.5,
  MXFP4: 4.25,
  Q3_K_M: 3.9,
  Q2_K: 3.4,
};
const DEFAULT_BITS_PER_WEIGHT = 5;

/**
 * Room above the weights for compute buffers, the runtime itself, and the
 * usual gap between a file size and what loading it costs.
 */
const OVERHEAD_FACTOR = 1.15;

/**
 * KV cache, as bytes per context token for a 30B-class model, scaled by the
 * square root of parameter count — cache size tracks layers times heads, which
 * grows far slower than parameters do.
 *
 * Crude, and deliberately generous. Under-estimating here means probing a Model
 * that then fails to load, which costs minutes; over-estimating means skipping
 * one that would have worked, which an operator can override with an explicit
 * list. The asymmetry is the reason for the direction.
 */
const KV_BYTES_PER_TOKEN_AT_30B = 5_500;

export type AcceleratorKind = "apple-silicon" | "cuda" | "cpu";

export interface Accelerator {
  kind: AcceleratorKind;
  name: string;
  /** What a model may actually occupy, in bytes. */
  usableBytes: number;
  /** How we worked that out, so a surprising exclusion can be audited. */
  evidence: string;
}

export interface MachineResources {
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  accelerator: Accelerator;
}

export interface Candidate {
  alias: string;
  path: string;
  quantization: string;
  fileBytes: number;
  /** Derived from file size and quantization, not from the filename. */
  estimatedParamsB: number;
  /** Weights plus overhead plus KV cache at the pinned context length. */
  estimatedLoadBytes: number;
}

export interface Exclusion {
  alias: string;
  reason: string;
}

export interface CandidateSet {
  candidates: Candidate[];
  excluded: Exclusion[];
  /** Whether an operator chose these or the estimate did. */
  source: "operator" | "estimate";
  resources: MachineResources;
}

function bitsPerWeight(quantization: string): number {
  return BITS_PER_WEIGHT[quantization.toUpperCase()] ?? DEFAULT_BITS_PER_WEIGHT;
}

/**
 * Parameter count from file size and quantization, rather than from the name.
 *
 * A filename is a claim; a file size is a measurement. "gemma-4-26B-A4B" is a
 * mixture-of-experts model whose name says 26B and whose file is sized by the
 * total, and a name-parsing estimate gets models like that wrong in the
 * direction that matters.
 */
export function estimateParamsB(fileBytes: number, quantization: string): number {
  const params = (fileBytes * 8) / bitsPerWeight(quantization);
  return Number((params / 1e9).toFixed(1));
}

/** What loading this file at this context length is likely to cost. */
export function estimateLoadBytes(
  fileBytes: number,
  quantization: string,
  contextTokens: number,
): number {
  const paramsB = estimateParamsB(fileBytes, quantization);
  const kvPerToken = KV_BYTES_PER_TOKEN_AT_30B * Math.sqrt(Math.max(paramsB, 1) / 30);
  return Math.round(fileBytes * OVERHEAD_FACTOR + kvPerToken * contextTokens);
}

function gib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

/**
 * Narrow the weights on disk to the ones this machine could load.
 *
 * An explicit operator list wins outright — not as a filter over the estimate,
 * but instead of it. Someone who knows their machine better than this
 * arithmetic does should not have to argue with it, and the estimate is not
 * confident enough to earn a veto.
 */
export function estimateCandidates(opts: {
  resources: MachineResources;
  weights: GgufModel[];
  contextTokens: number;
  explicit?: string[];
}): CandidateSet {
  const { resources, weights, contextTokens } = opts;

  const toCandidate = (model: GgufModel): Candidate => {
    const quantization = extractQuant(model.baseName);
    const fileBytes = model.sizeBytes ?? 0;
    return {
      alias: model.alias,
      path: model.path,
      quantization,
      fileBytes,
      estimatedParamsB: estimateParamsB(fileBytes, quantization),
      estimatedLoadBytes: estimateLoadBytes(fileBytes, quantization, contextTokens),
    };
  };

  if (opts.explicit?.length) {
    // Instead of the estimate, not on top of it. The matching is left to the
    // managed planner, which does it against the same weights list.
    return {
      candidates: weights
        .filter((w) => opts.explicit!.some((name) => w.alias === name || w.baseName === name))
        .map(toCandidate),
      excluded: [],
      source: "operator",
      resources,
    };
  }

  const candidates: Candidate[] = [];
  const excluded: Exclusion[] = [];
  const budget = resources.accelerator.usableBytes;

  // Largest first, so where two quantizations of the same weights both fit the
  // better one wins — and where only the smaller fits, the exclusion of the
  // larger is still reported rather than silently resolved.
  for (const model of [...weights].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0))) {
    const candidate = toCandidate(model);

    if (candidate.fileBytes === 0) {
      excluded.push({ alias: candidate.alias, reason: "could not read the file size" });
      continue;
    }
    if (candidate.estimatedLoadBytes > budget) {
      excluded.push({
        alias: candidate.alias,
        reason:
          `needs about ${gib(candidate.estimatedLoadBytes)} at ${contextTokens} ctx, ` +
          `and ${resources.accelerator.name} has ${gib(budget)}`,
      });
      continue;
    }
    if (candidates.some((c) => c.alias === candidate.alias)) {
      excluded.push({
        alias: candidate.alias,
        reason: `a larger quantization of the same weights already fits (${candidate.quantization} skipped)`,
      });
      continue;
    }
    candidates.push(candidate);
  }

  return {
    candidates: candidates.sort((a, b) => a.alias.localeCompare(b.alias)),
    excluded,
    source: "estimate",
    resources,
  };
}

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * What detection touches. Injected so the whole estimate is testable against a
 * fabricated machine — there is no GPU in the test suite, and there should not
 * need to be one.
 */
export interface DetectEffects {
  platform: () => NodeJS.Platform;
  arch: () => string;
  totalMemory: () => number;
  freeMemory: () => number;
  /** Runs a command, returning its stdout, or undefined if it is not there. */
  run: (command: string, args: string[]) => string | undefined;
}

/**
 * Share of installed memory a model may occupy on a unified-memory machine.
 *
 * Apple Silicon shares one pool between the GPU and everything else, and macOS
 * caps what the GPU may wire down at roughly this. Taking it all would mean a
 * machine that serves right up until its owner opens a browser.
 */
const UNIFIED_MEMORY_SHARE = 0.7;
/** On a CPU-only box the same argument applies, more conservatively. */
const SYSTEM_MEMORY_SHARE = 0.6;

export function detectResources(effects: DetectEffects): MachineResources {
  const totalMemoryBytes = effects.totalMemory();
  const freeMemoryBytes = effects.freeMemory();

  // NVIDIA first: a discrete accelerator has its own memory, and that is the
  // budget that matters rather than the machine's.
  const smi = effects.run("nvidia-smi", [
    "--query-gpu=name,memory.total",
    "--format=csv,noheader,nounits",
  ]);
  if (smi?.trim()) {
    // Multiple GPUs report one line each. Only the first is used: splitting a
    // model across cards is a serving decision this estimate does not make.
    const [name, memoryMib] = smi.trim().split("\n")[0].split(",").map((s) => s.trim());
    const totalBytes = Number(memoryMib) * 1024 * 1024;
    if (Number.isFinite(totalBytes) && totalBytes > 0) {
      return {
        totalMemoryBytes,
        freeMemoryBytes,
        accelerator: {
          kind: "cuda",
          name: name || "NVIDIA GPU",
          // Leave room for the runtime's own allocations and a second process.
          usableBytes: Math.floor(totalBytes * 0.9),
          evidence: "nvidia-smi reported dedicated device memory",
        },
      };
    }
  }

  if (effects.platform() === "darwin" && effects.arch() === "arm64") {
    return {
      totalMemoryBytes,
      freeMemoryBytes,
      accelerator: {
        kind: "apple-silicon",
        name: "Apple Silicon (unified memory)",
        usableBytes: Math.floor(totalMemoryBytes * UNIFIED_MEMORY_SHARE),
        evidence: `unified memory, ${Math.round(UNIFIED_MEMORY_SHARE * 100)}% of installed RAM`,
      },
    };
  }

  return {
    totalMemoryBytes,
    freeMemoryBytes,
    accelerator: {
      kind: "cpu",
      name: "CPU (system memory)",
      usableBytes: Math.floor(totalMemoryBytes * SYSTEM_MEMORY_SHARE),
      evidence: "no accelerator detected; estimating against system memory",
    },
  };
}
