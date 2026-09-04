/**
 * CompletionRecord — one row per model call, as seen by the runner.
 *
 * This is umwelten's own record of what a call consumed, independent of any
 * viewer. Field names follow OpenInference (Arize Phoenix) conventions so an
 * exporter is a rename, not a redesign. See
 * reports/2026-09-02-observability-and-cheapest-model-mvp.md.
 *
 * Not a billing record: Mycel's RequestRecord meters at the exchange
 * boundary (ADR 0017). This records what the runner observed, for every
 * provider, so that usage can be aggregated and turned into evals.
 */

export interface CompletionTokens {
  prompt: number;
  completion: number;
  total: number;
  /** Prompt tokens served from the provider's prompt cache. Subset of `prompt`. */
  cacheRead?: number;
  /** Prompt tokens written into the provider's prompt cache. Subset of `prompt`. */
  cacheWrite?: number;
  /** Reasoning/thinking tokens. Subset of `completion` where the provider counts them there. */
  reasoning?: number;
}

export interface CompletionCost {
  prompt: number;
  completion: number;
  total: number;
  cacheRead?: number;
  cacheWrite?: number;
  /**
   * Where the number came from. `pricing-table` is computed from
   * `ModelDetails.costs`; `provider-reported` is reserved for exact figures
   * fetched from the provider after the fact.
   */
  source: "pricing-table" | "provider-reported";
}

export type CompletionOutcome =
  /** The model finished the response. */
  | "completed"
  /** The caller aborted mid-stream; tokens are estimated. */
  | "aborted"
  /** The call threw. Usage, if any, is whatever was available. */
  | "error";

export interface CompletionRecord {
  /** Unique id for this record. */
  id: string;
  /** The Interaction this call belonged to (one Interaction = one trace). */
  traceId: string;
  /** Groups Interactions into a larger unit of work (habitat session, eval run). */
  sessionId?: string;
  /** End-user id as sent to the provider. */
  userId?: string;
  /** Which program made the call, e.g. "habitat:<name>", "cli:run", "eval:<suite>". */
  app?: string;
  /** Free-form labels for grouping, e.g. "task:issue-123". */
  tags: string[];

  kind: "llm";
  /** Which runner method produced this record. */
  operation: "generateText" | "streamText" | "generateObject" | "streamObject";
  provider: string;
  model: string;
  reasoningEffort?: string;

  startedAt: string;
  endedAt: string;
  durationMs: number;

  tokens: CompletionTokens;
  /** Absent when the model has no pricing or usage was unavailable. */
  cost?: CompletionCost;

  outcome: CompletionOutcome;
  finishReason?: string;
  /** Tool calls the model made across all steps of this call. */
  toolCallCount: number;
  /** Agent-loop steps (model round-trips) inside this call. */
  steps: number;
  error?: string;

  /** Provider-side request/generation id, for later reconciliation. */
  providerRequestId?: string;
  /** The provider's usage object as received, for reconciliation. */
  usageRaw?: Record<string, unknown>;
}

/** Receives one record per model call. Implementations must never throw into the runner. */
export interface CompletionSink {
  record(record: CompletionRecord): void;
}
