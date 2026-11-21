import { makeLanguageSuite, type LanguageSuiteOptions } from "./language.js";
import {
  makeToolCallingSuite,
  type ToolCallingSuiteOptions,
} from "./tool-calling.js";
import type { ModelSpec } from "@umwelten/pi";
import type { TaskResultRecord } from "../suite.js";

export { makeLanguageSuite, makeToolCallingSuite };
export type { LanguageSuiteOptions, ToolCallingSuiteOptions };

export type LlmEvalSuiteName = "language" | "tool-calling";

export interface FullEvalOptions {
  signal?: AbortSignal;
  only?: LlmEvalSuiteName[];
  names?: Partial<Record<LlmEvalSuiteName, string>>;
  judgeModel?: ModelSpec;
  perTaskTimeoutMs?: number;
}

export interface SuiteRunResult {
  suite: LlmEvalSuiteName;
  results: TaskResultRecord[];
  durationMs: number;
}

export interface FullEvalResult {
  model: ModelSpec;
  suites: SuiteRunResult[];
  durationMs: number;
}

const ALL_SUITES: LlmEvalSuiteName[] = ["language", "tool-calling"];

export async function runFullEval(
  model: ModelSpec,
  opts: FullEvalOptions = {},
): Promise<FullEvalResult> {
  const { signal } = opts;
  const enabled = new Set(opts.only ?? ALL_SUITES);
  const suites: SuiteRunResult[] = [];
  const start = Date.now();

  const checkAborted = () => {
    if (signal?.aborted) {
      throw new Error(
        signal.reason instanceof Error
          ? signal.reason.message
          : "runFullEval aborted",
      );
    }
  };

  if (enabled.has("language")) {
    checkAborted();
    const t0 = Date.now();
    const suite = makeLanguageSuite(model, {
      name: opts.names?.language,
      judgeModel: opts.judgeModel,
      perTaskTimeoutMs: opts.perTaskTimeoutMs,
    });
    const results = await suite.run({ signal });
    suites.push({ suite: "language", results, durationMs: Date.now() - t0 });
  }

  if (enabled.has("tool-calling")) {
    checkAborted();
    const t0 = Date.now();
    const suite = makeToolCallingSuite(model, {
      name: opts.names?.["tool-calling"],
      perTaskTimeoutMs: opts.perTaskTimeoutMs,
    });
    const results = await suite.run({ signal });
    suites.push({ suite: "tool-calling", results, durationMs: Date.now() - t0 });
  }

  return { model, suites, durationMs: Date.now() - start };
}
