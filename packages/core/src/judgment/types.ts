import type { TokenUsage } from "../costs/costs.js";

/** Experimental: bounded judgments, not conversations or executable policies. */
export type JudgmentState = string | { [key: string]: JsonValue } | JsonValue[];
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type JudgmentQuestion =
  | {
      kind: "binary";
      instructions: string;
      criteria?: { true: string; false: string };
    }
  | {
      kind: "choice";
      instructions: string;
      options: Readonly<Record<string, string>>;
    }
  | { kind: "ordinal"; instructions: string; levels: readonly string[] };

export type JudgmentQuestions = Readonly<Record<string, JudgmentQuestion>>;
export interface JudgmentRequest<
  Q extends JudgmentQuestions = JudgmentQuestions,
> {
  state: JudgmentState;
  questions: Q;
}

export type JudgmentAnswer<Q extends JudgmentQuestion = JudgmentQuestion> =
  Q extends { kind: "binary" }
    ? { kind: "binary"; probabilityTrue: number }
    : Q extends { kind: "choice"; options: infer O }
      ? {
          kind: "choice";
          selected: keyof O & string;
          probabilities: { [K in keyof O]: number };
        }
      : { kind: "ordinal"; probabilities: number[]; expectedIndex: number };

export interface JudgmentResult<
  Q extends JudgmentQuestions = JudgmentQuestions,
> {
  answers: { [K in keyof Q]: JudgmentAnswer<Q[K]> };
  metadata: {
    provider: string;
    requestedModel: string;
    model: string;
    probabilitySource: "native" | "generated";
    execution: "shared-state" | "joint-generation";
    startedAt: string;
    durationMs: number;
    usage?: TokenUsage;
    cost?: { usd: number; source: "provider-reported" | "pricing-table" };
    /** Upstream-reported expense, not the Mycel ledger charge. */
    upstreamCostUsd?: number;
    requestId?: string;
  };
  /** Keep original answers/confidence/usage for audit. Treat input/output as sensitive. */
  raw: unknown;
}

/** Safe error classification plus raw response evidence, never request headers. */
export class JudgmentError extends Error {
  constructor(
    readonly kind: "http" | "invalid-response",
    readonly details: { status?: number; raw?: unknown },
    options?: ErrorOptions,
  ) {
    super(
      kind === "http"
        ? `Decisions HTTP ${details.status}`
        : "Invalid judgment response",
      options,
    );
    this.name = "JudgmentError";
  }
}

export interface JudgmentBackend {
  /** Stable identity including model/settings; used by the experiment cache. */
  readonly identity: string;
  judge<const Q extends JudgmentQuestions>(
    request: JudgmentRequest<Q>,
    options?: { signal?: AbortSignal },
  ): Promise<JudgmentResult<Q>>;
}
