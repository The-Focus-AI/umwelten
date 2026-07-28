/**
 * Supplier-agent domain types.
 *
 * Vocabulary follows `packages/exchange/CONTEXT.md` — the agent and the
 * Exchange share a bounded context even though they are different deployables.
 * Two rules from the ADRs are structural here:
 *
 *   - **Capabilities are probed, never declared** (ADR 0009). Nothing in this
 *     file lets an operator assert what a Model can do.
 *   - **Headroom is measured, never declared.** Same reason, and it is why
 *     there is no way to hand-write a throughput number.
 *
 * Note what is absent: prices. The agent publishes evidence about what a
 * machine can do; the Exchange decides what to pay and what to charge, because
 * a Supplier that prices itself takes away the routing lever (ADR 0007).
 */

export type CapabilityName =
  | "chat"
  | "streaming"
  | "tool-calling"
  | "structured-output"
  | "reasoning";

/**
 * Whether the agent controls the runtime behind an Offer or is reselling one it
 * does not control. Managed is the default (ADR 0010); adapted is the zero-cost
 * onboarding path and a lesser tier.
 */
export type ServingMode = "managed" | "adapted";

export interface CapabilityProbe {
  name: CapabilityName;
  supported: boolean;
  /** Why we concluded that. Kept so a human can audit a surprising result. */
  evidence: string;
  elapsedMs: number;
}

/**
 * One throughput measurement.
 *
 * Three numbers because they move in different directions and only together
 * locate saturation: aggregate rises with concurrency until the box saturates,
 * per-stream decode falls as concurrency climbs, and time-to-first-token rises
 * under queueing. A flat aggregate with rising TTFT means queueing; a falling
 * aggregate means real contention.
 */
export interface HeadroomSample {
  concurrency: number;
  ttftMs: number;
  tokensPerSecond: number;
  decodeTokensPerSecond: number;
  errors: number;
}

/** A machine state the agent reasons about. Fabricated in tests, real at runtime. */
export interface MachineState {
  /** Runtimes that answered, and what each says it serves. */
  runtimes: { provider: string; reachable: boolean; models: string[]; error?: string }[];
}

/** What a probe run learned about one (runtime, model) pair. */
export interface ProbedOffer {
  provider: string;
  model: string;
  probedAt: string;
  capabilities: CapabilityProbe[];
  headroom: HeadroomSample[];
  contextTokens?: number;
  /** Set when the Model could not be probed at all. No Offer is published. */
  failed?: string;
}

/** What the agent sends to the Exchange. */
export interface OfferDraft {
  model: string;
  capabilities: CapabilityName[];
  servingMode: ServingMode;
  headroom: HeadroomSample[];
  contextTokens?: number;
}

export interface SupplierConfig {
  /** Where the Exchange lives. */
  exchangeUrl: string;
  /** The credential the operator issued when registering this Supplier. */
  credential: string;
  /**
   * Guarantees the operator says this machine is offered under. Echoed to the
   * Exchange for confirmation only — the Exchange's grant decides, and a claim
   * beyond it is rejected (ADR 0006).
   */
  guarantees: string[];
  servingMode: ServingMode;
  /** Restrict probing to these runtimes. Empty means all reachable ones. */
  providers?: string[];
  /** Restrict probing to Models whose name contains this. */
  modelFilter?: string;
}
