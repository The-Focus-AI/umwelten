/**
 * Supplier-agent domain types.
 *
 * Vocabulary follows `packages/mycel/CONTEXT.md` — the agent and the
 * Exchange share a bounded context even though they are different deployables.
 * Two rules from the ADRs are structural here:
 *
 *   - **Capabilities are probed, never declared** (ADR 0015). Nothing in this
 *     file lets an operator assert what a Model can do.
 *   - **Headroom is measured, never declared.** Same reason, and it is why
 *     there is no way to hand-write a throughput number.
 *
 * Note what is absent: prices. The agent publishes evidence about what a
 * machine can do; the Exchange decides what to pay and what to charge, because
 * a Supplier that prices itself takes away the routing lever (ADR 0013).
 */

export type CapabilityName =
  | "chat"
  | "streaming"
  | "tool-calling"
  | "structured-output"
  | "reasoning";

/**
 * Whether the agent controls the runtime behind an Offer or is reselling one it
 * does not control. Managed is the default (ADR 0016); adapted is the zero-cost
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
  /**
   * How long generation actually ran. Published because a short window
   * understates — a single stream on a short prompt never gets the GPU busy,
   * so the number is a floor rather than a rate. A consumer can see whether
   * the window was long enough instead of taking the rate on faith.
   */
  decodeSeconds: number;
  /** Whether this sample met `HEADROOM_POLICY` — long enough, and error-free. */
  meetsPolicy: boolean;
}

/**
 * The sampling policy that produced a Headroom, published alongside it.
 *
 * Carried on the Offer rather than assumed, so the Exchange can compare two
 * Suppliers' numbers knowing they were taken the same way — and can tell when
 * one of them wasn't.
 */
export interface HeadroomPolicy {
  levels: number[];
  minDecodeSeconds: number;
  maxSampleSeconds: number;
  cooldownMs: number;
  resampleAfterSeconds: number;
  countTo: number;
}

/**
 * What the samples say about concurrent work. A flat aggregate with rising
 * time-to-first-token is queueing; a falling aggregate is contention. They want
 * different responses, so they are not collapsed into one word.
 */
export type SaturationVerdict = "batches" | "queues" | "contends" | "inconclusive";

/** Everything about a Headroom measurement that is not itself a sample. */
export interface HeadroomMeta {
  sampledAt: string;
  /**
   * Time to first token on the first request this run made to the Model —
   * the difference between dispatching to a warm Offer and a sleeping one,
   * observed at 14–28 seconds for on-demand loads.
   *
   * First-touch, not forced-cold: a runtime that already had the Model
   * resident reports a warm number, which `coldStartFirstTouch` records.
   */
  coldStartMs?: number;
  /** False when something had already touched the Model before we measured. */
  coldStartFirstTouch: boolean;
  policy: HeadroomPolicy;
  saturation: SaturationVerdict;
  /**
   * Set when sampling failed. The Offer is still published — a Model that
   * serves but whose throughput we could not measure is more useful to
   * Dispatch than no Model at all, as long as the gap is visible.
   */
  failed?: string;
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
  headroomMeta?: HeadroomMeta;
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
  headroomMeta?: HeadroomMeta;
  contextTokens?: number;
  /**
   * The quantization this Offer is actually serving, when the agent pinned it.
   * Only a managed Offer can say — an adapted one is reselling a configuration
   * it does not control (ADR 0016).
   */
  quantization?: string;
}

export interface SupplierConfig {
  /** Where the Exchange lives. */
  exchangeUrl: string;
  /** The credential the operator issued when registering this Supplier. */
  credential: string;
  /**
   * Guarantees the operator says this machine is offered under. Echoed to the
   * Exchange for confirmation only — the Exchange's grant decides, and a claim
   * beyond it is rejected (ADR 0012).
   */
  guarantees: string[];
  servingMode: ServingMode;
  /** Restrict probing to these runtimes. Empty means all reachable ones. */
  providers?: string[];
  /** Restrict probing to Models whose name contains this. */
  modelFilter?: string;
  /** Required when `servingMode` is managed; meaningless otherwise. */
  managed?: ManagedOptions;
}

/**
 * What the operator pins when the agent owns the runtime.
 *
 * Everything here is a commitment the Offer then makes. That is the whole
 * difference between the two Serving Modes: an adapted Offer inherits whatever
 * the machine was already doing and can promise nothing about it.
 */
export interface ManagedOptions {
  /** Models to serve. Explicit in this ticket; worked out automatically is #308. */
  models: string[];
  /**
   * Context length to pin. No default of "whatever the model ships with" —
   * that is the thing managed mode exists to stop inheriting.
   */
  contextTokens: number;
  /** Quantization to pin, e.g. `Q4_K_M`. Highest available when unset. */
  quantization?: string;
  /**
   * Concurrent request slots the runtime is configured for. Below 2 the
   * runtime cannot batch however capable it is, so a Supplier with one slot
   * cannot have two customers.
   */
  parallel: number;
  /** Port the agent's runtime listens on. */
  port: number;
  /** Where to write the generated serving configuration. */
  configPath: string;
  /** Path to the serving binary, when it is not on PATH. */
  binaryPath?: string;
}
