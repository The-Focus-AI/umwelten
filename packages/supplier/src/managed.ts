/**
 * Managed mode: the agent owns the runtime.
 *
 * The default posture (ADR 0016). An adapted Offer resells whatever the box was
 * already running and can therefore commit to nothing about it; a managed Offer
 * pins context size and quantization, which is the entire reason it can promise
 * anything at all.
 *
 * This module is the decision half — which weights to serve, at what context and
 * quantization, and which runtime is allowed to serve them. It does no I/O, so
 * the whole of it is testable against a fabricated machine state with no GPU in
 * the room. Starting the process is `runtime.ts`.
 */

import path from "node:path";
import {
  buildLlamaSwapConfig,
  normalizeModelName,
  type GgufModel,
} from "@umwelten/core/providers/llamaswap-config.js";
import type { ManagedOptions } from "./types.js";

/**
 * What we know about how a runtime handles concurrent requests.
 *
 * This is a measured table, not a preference. Across nine models one runtime
 * served requests strictly one at a time — aggregate throughput flat from one
 * to four concurrent requests, per-stream decode identical to three significant
 * figures, and time-to-first-token rising to 48 seconds — while another batched
 * and scaled aggregate roughly three to sevenfold
 * (`reports/2026-07-26-headroom-ollama-does-not-batch.md`).
 *
 * A Supplier that serves one request at a time cannot have two customers, so
 * managed mode will not select a serializing runtime. Where the behaviour is
 * unknown it is measured through the Headroom sample rather than assumed —
 * see `verifyConcurrency`.
 */
export const RUNTIME_CONCURRENCY: Record<string, "batches" | "serializes" | "unknown"> = {
  /** llama-server behind llama-swap, given `--parallel N`. Measured batching. */
  llamaswap: "batches",
  /** Measured serializing at its default configuration. */
  ollama: "serializes",
  lmstudio: "unknown",
  llamabarn: "unknown",
};

/** Managed mode could not be set up. Never falls back to adapted silently. */
export class ManagedModeError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ManagedModeError";
  }
}

/** One Model the agent has committed to serve, and exactly how. */
export interface PinnedModel {
  /** What the operator asked for. */
  requested: string;
  /** The alias the runtime will serve it under, and the Offer's Model name. */
  alias: string;
  /** The weights file chosen. */
  path: string;
  /** Pinned, never inherited. Extracted from the file we actually selected. */
  quantization: string;
  sizeBytes?: number;
}

export interface ManagedPlan {
  provider: string;
  models: PinnedModel[];
  /** Requested Models with no weights on this machine. */
  missing: string[];
  contextTokens: number;
  parallel: number;
  port: number;
  baseUrl: string;
  configPath: string;
  /** The generated serving configuration, verbatim. */
  config: string;
  command: string;
  args: string[];
}

/**
 * Pull the quantization out of a GGUF filename.
 *
 * `normalizeModelName` strips exactly this to build an alias, so this is its
 * inverse and the two must agree on the vocabulary — a quant this misses is a
 * quant the alias keeps, and the alias stops being stable.
 */
export function extractQuant(fileName: string): string {
  const base = path.basename(fileName).replace(/\.gguf$/i, "");
  const match = base.match(/(?:^|[-._])(ud-)?(q\d(?:_k(?:_[ms])?)?|q\d_\d|bf16|f16|fp16|f32|mxfp4|iq\d(?:_[a-z]+)?)\b/i);
  return match ? match[2].toUpperCase() : "unknown";
}

/**
 * Find the weights for one requested Model.
 *
 * Matches on the normalized alias first — the name an operator would type —
 * and falls back to a substring of the raw filename, because the thing someone
 * copies out of a directory listing is usually the filename.
 */
export function matchWeights(requested: string, available: GgufModel[]): GgufModel[] {
  const wanted = normalizeModelName(requested);
  const byAlias = available.filter((m) => m.alias === wanted);
  if (byAlias.length > 0) return byAlias;

  const needle = requested.toLowerCase();
  return available.filter(
    (m) => m.baseName.toLowerCase().includes(needle) || m.alias.includes(wanted),
  );
}

/**
 * Choose the file to serve, given a quantization pin.
 *
 * With a pin, only an exact match will do — a request for Q4_K_M silently
 * served as Q8 is a different Offer from the one that was published. Without
 * one, the largest file wins and the resulting quant is *recorded*, because
 * pinning means reproducible, not merely explicit.
 */
export function selectWeights(
  candidates: GgufModel[],
  quantization?: string,
): GgufModel | undefined {
  const pool = quantization
    ? candidates.filter((m) => extractQuant(m.baseName) === quantization.toUpperCase())
    : candidates;
  return [...pool].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0))[0];
}

/**
 * Which runtime managed mode may use.
 *
 * Refuses a known-serializing runtime up front rather than after spending GPU
 * time on a probe, and refuses an unmeasured one rather than assuming — a
 * runtime whose concurrency behaviour nobody has measured is not evidence that
 * it batches.
 */
export function chooseManagedRuntime(preferred?: string): string {
  const provider = preferred ?? "llamaswap";
  const behaviour = RUNTIME_CONCURRENCY[provider];

  if (behaviour === "serializes") {
    throw new ManagedModeError(
      `Runtime "${provider}" serves requests one at a time, so a Supplier using it cannot have two customers.`,
      "Managed mode requires a runtime that batches. Use llamaswap, or run in adapted mode with --mode adapted.",
    );
  }
  if (behaviour === undefined || behaviour === "unknown") {
    throw new ManagedModeError(
      `Concurrency behaviour of runtime "${provider}" has not been measured.`,
      "Managed mode will not assume a runtime batches. Measure it first, or use llamaswap.",
    );
  }
  return provider;
}

/**
 * Turn a pinned Model list plus what is on disk into a serving plan.
 *
 * Pure: hand it a fabricated list of GGUF files and assert the configuration
 * that comes out. No filesystem, no process, no GPU.
 */
export function planManagedRuntime(opts: {
  managed: ManagedOptions;
  available: GgufModel[];
  provider?: string;
}): ManagedPlan {
  const { managed, available } = opts;
  const provider = chooseManagedRuntime(opts.provider);

  if (managed.models.length === 0) {
    throw new ManagedModeError(
      "There is nothing to serve.",
      "No Models were named with --serve, and none of the weights on this machine survived the size estimate.",
    );
  }
  if (!Number.isFinite(managed.contextTokens) || managed.contextTokens <= 0) {
    throw new ManagedModeError(
      "Managed mode needs an explicit context length.",
      'Pass --ctx-size. A context of 0 means "whatever the model ships with", which is the default managed mode exists to stop inheriting.',
    );
  }
  if (managed.parallel < 2) {
    throw new ManagedModeError(
      `Managed mode was asked for ${managed.parallel} concurrent slot(s).`,
      "Below 2 the runtime cannot batch however capable it is, and a Supplier that serves one request at a time cannot have two customers.",
    );
  }

  const models: PinnedModel[] = [];
  const missing: string[] = [];

  for (const requested of managed.models) {
    const chosen = selectWeights(matchWeights(requested, available), managed.quantization);
    if (!chosen) {
      missing.push(requested);
      continue;
    }
    models.push({
      requested,
      alias: chosen.alias,
      path: chosen.path,
      quantization: extractQuant(chosen.baseName),
      sizeBytes: chosen.sizeBytes,
    });
  }

  // Two requested names resolving to the same weights would be silently
  // collapsed into one entry by the config generator, and the Offer set would
  // come out a Model short with nothing saying why.
  const collided = models
    .filter((m, i) => models.findIndex((o) => o.alias === m.alias) !== i)
    .map((m) => m.alias);
  if (collided.length > 0) {
    throw new ManagedModeError(
      `Requested Models resolve to the same weights: ${[...new Set(collided)].join(", ")}.`,
      "Serve one of them, or pin different quantizations.",
    );
  }

  const config = buildLlamaSwapConfig(
    models.map((m) => ({ path: m.path, alias: m.alias, baseName: m.alias, sizeBytes: m.sizeBytes })),
    {
      ctxSize: managed.contextTokens,
      llamaServerPath: managed.binaryPath,
      // `--parallel` is what makes llama-server batch at all; without it the
      // runtime is capable of concurrency and configured out of it.
      extraArgs: ["--parallel", String(managed.parallel)],
      includeHeader: true,
    },
  );

  return {
    provider,
    models,
    missing,
    contextTokens: managed.contextTokens,
    parallel: managed.parallel,
    port: managed.port,
    baseUrl: `http://127.0.0.1:${managed.port}/v1`,
    configPath: managed.configPath,
    config,
    command: "llama-swap",
    args: ["--config", managed.configPath, "--listen", `127.0.0.1:${managed.port}`],
  };
}

/**
 * Confirm after the fact that the runtime we started actually batches.
 *
 * The table says llama-swap does; this checks that this build, on this box,
 * with this `--parallel`, does too. A runtime configured out of its own
 * concurrency looks exactly like one that never had any.
 */
export function verifyConcurrency(
  saturation: string,
): { ok: true } | { ok: false; reason: string } {
  if (saturation === "batches") return { ok: true };
  if (saturation === "inconclusive") {
    return {
      ok: false,
      reason:
        "Headroom sampling could not establish whether the runtime batches. Managed mode does not assume it does.",
    };
  }
  return {
    ok: false,
    reason:
      saturation === "queues"
        ? "Measured serving requests one at a time — aggregate throughput flat while time-to-first-token climbed."
        : "Measured aggregate throughput falling under concurrency, so concurrent work makes this Offer worse, not better.",
  };
}
