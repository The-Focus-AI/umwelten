/**
 * Supplier-agent domain types.
 *
 * Vocabulary follows `packages/exchange/CONTEXT.md` — Supplier, Offer,
 * Capability, Headroom. Two rules from that glossary are load-bearing here:
 *
 *   1. Capabilities belong to the **Offer**, not the Model. The same model
 *      served by Ollama and by llama.cpp is two Offers with two capability
 *      sets, because quantization, chat template, and build flags differ.
 *   2. Headroom is **measured, never declared.** Nothing in this file lets a
 *      supplier assert its own throughput.
 *
 * Note what is absent: prices. The agent publishes evidence about what a box
 * can do; the exchange decides what to pay for it and what to charge. Price is
 * the exchange's routing lever, so a supplier must not be able to set it.
 */

/** A capability an Offer either has or doesn't. Established by probing. */
export type CapabilityName =
  | "chat"
  | "streaming"
  | "tool-calling"
  | "structured-output"
  | "reasoning";

export interface CapabilityProbe {
  name: CapabilityName;
  supported: boolean;
  /** Why we concluded that. Kept so a human can audit a surprising result. */
  evidence: string;
  elapsedMs: number;
}

/** One throughput measurement at a given level of concurrency. */
export interface ThroughputSample {
  /** Requests in flight during the sample. */
  concurrency: number;
  /** Median time to first token across the sample, in milliseconds. */
  ttftMs: number;
  /** Completion tokens per second, aggregated across all in-flight requests. */
  tokensPerSecond: number;
  completionTokens: number;
  errors: number;
}

/** A local runtime that answered when we knocked. */
export interface DiscoveredRuntime {
  /** Umwelten provider id: ollama, lmstudio, llamabarn, llamaswap. */
  provider: string;
  reachable: boolean;
  models: string[];
  /** Populated when `reachable` is false. */
  error?: string;
}

/** What a probe run learned about one (runtime, model) pair. */
export interface ProbedOffer {
  provider: string;
  model: string;
  probedAt: string;
  capabilities: CapabilityProbe[];
  throughput: ThroughputSample[];
  /**
   * Largest prompt we successfully round-tripped, in characters. Absent unless
   * `--context` was passed, because the probe is slow and evicts other models.
   */
  contextChars?: number;
  /** Set when the model could not be probed at all. */
  failed?: string;
}

/**
 * What the agent sends up to the exchange. A draft because the exchange
 * completes it with Cost and Charge before it becomes a live Offer.
 */
export interface OfferDraft {
  supplierId: string;
  provider: string;
  model: string;
  probedAt: string;
  /** Capability names that probed true. Anything absent is unsupported. */
  capabilities: CapabilityName[];
  /** Best observed single-stream and concurrent throughput. */
  throughput: ThroughputSample[];
  contextChars?: number;
}

/** Identity and claims about the box itself, not about any one model. */
export interface SupplierProfile {
  supplierId: string;
  /** Free-text, e.g. "DGX Spark, office" or "M4 Max 128GB". */
  description?: string;
  /**
   * Guarantee names this supplier is offered under, e.g. ["on-premise",
   * "no-training"]. Recorded here only so the agent can echo them back for
   * confirmation — the exchange is the source of truth, because the operator
   * is the one liable for a Guarantee, not the box.
   */
  guarantees: string[];
}
