/**
 * llm-eval — provider-agnostic top-level evaluation entry point.
 *
 * `runFullEval(model, opts)` runs three sub-suites against one model:
 *   1. language (instruction following + reasoning)
 *   2. coding (write-from-spec + bugfix)
 *   3. tool-calling (multi-step tool-math)
 *
 * Each sub-suite is an EvalSuite, which means caching, judging,
 * leaderboards, and the model-response cache layout all stay
 * compatible with existing reports under
 * `output/evaluations/<suite>/runs/NNN/`.
 *
 * Provider-agnostic by design: this module knows nothing about
 * Ollama / llama-swap / battery / memory. The local-providers harness
 * (Layer 2) wraps this with eviction, preflight, and watchdog.
 */

import { makeLanguageSuite, type LanguageSuiteOptions } from './language.js';
import { makeCodingSuite, type CodingSuiteOptions } from './coding.js';
import {
  makeToolCallingSuite,
  type ToolCallingSuiteOptions,
} from './tool-calling.js';
import type { ModelDetails } from '@umwelten/core/cognition/types.js';
import type { TaskResultRecord } from '../suite.js';

export { makeLanguageSuite, makeCodingSuite, makeToolCallingSuite };
export type {
  LanguageSuiteOptions,
  CodingSuiteOptions,
  ToolCallingSuiteOptions,
};

export type LlmEvalSuiteName = 'language' | 'coding' | 'tool-calling';

export interface FullEvalOptions {
  /**
   * Optional AbortSignal. If aborted between suites, the run stops; if
   * aborted mid-suite, EvalSuite forwards the signal down to the AI
   * SDK call so the underlying HTTP request is actually cancelled
   * (the deeper fix for the watchdog/phantom-traffic bug).
   */
  signal?: AbortSignal;
  /**
   * Restrict to a subset of suites. Default: all three. Useful for
   * `run-one.ts` style debugging where you only want to re-run e.g.
   * tool-calling for a single contaminated model.
   */
  only?: LlmEvalSuiteName[];
  /**
   * Optional eval-name overrides per sub-suite. Defaults are
   * `llm-eval-language`, `llm-eval-coding`, `llm-eval-tool-calling`,
   * which keeps cache layout aligned with existing combine reports.
   */
  names?: Partial<Record<LlmEvalSuiteName, string>>;
  /** Judge model passed to the language suite. */
  judgeModel?: ModelDetails;
  /** Restrict coding suite to specific languages. */
  codingLanguages?: CodingSuiteOptions['languages'];
  /**
   * Override per-task timeout (ms). Applied to all sub-suites.
   * Use to retry cells that hit the default 5-min watchdog due to
   * legitimate (not hung) reasoning chains. Default: undefined → EvalSuite
   * default (300_000 ms).
   */
  perTaskTimeoutMs?: number;
}

export interface SuiteRunResult {
  suite: LlmEvalSuiteName;
  results: TaskResultRecord[];
  durationMs: number;
}

export interface FullEvalResult {
  model: ModelDetails;
  suites: SuiteRunResult[];
  /** Total wall-clock time across all suites. */
  durationMs: number;
}

const ALL_SUITES: LlmEvalSuiteName[] = ['language', 'coding', 'tool-calling'];

/**
 * Run all three sub-suites against one model. Each sub-suite is run
 * sequentially (parallelism is *within* a suite, not across — local
 * runtimes can't handle a second concurrent model anyway). Honors
 * `opts.signal` so a harness watchdog can cancel cleanly.
 */
export async function runFullEval(
  model: ModelDetails,
  opts: FullEvalOptions = {},
): Promise<FullEvalResult> {
  const { signal } = opts;
  const enabled = new Set(opts.only ?? ALL_SUITES);
  const suites: SuiteRunResult[] = [];
  const start = Date.now();

  // Helper: bail if the harness has aborted between suites. EvalSuite
  // also checks at task boundaries inside .run().
  const checkAborted = () => {
    if (signal?.aborted) {
      throw new Error(
        signal.reason instanceof Error
          ? signal.reason.message
          : 'runFullEval aborted',
      );
    }
  };

  if (enabled.has('language')) {
    checkAborted();
    const t0 = Date.now();
    const suite = makeLanguageSuite(model, {
      name: opts.names?.language,
      judgeModel: opts.judgeModel,
      perTaskTimeoutMs: opts.perTaskTimeoutMs,
    });
    const results = await suite.run({ signal });
    suites.push({
      suite: 'language',
      results,
      durationMs: Date.now() - t0,
    });
  }

  if (enabled.has('coding')) {
    checkAborted();
    const t0 = Date.now();
    const suite = makeCodingSuite(model, {
      name: opts.names?.coding,
      languages: opts.codingLanguages,
      perTaskTimeoutMs: opts.perTaskTimeoutMs,
    });
    const results = await suite.run({ signal });
    suites.push({
      suite: 'coding',
      results,
      durationMs: Date.now() - t0,
    });
  }

  if (enabled.has('tool-calling')) {
    checkAborted();
    const t0 = Date.now();
    const suite = makeToolCallingSuite(model, {
      name: opts.names?.['tool-calling'],
      perTaskTimeoutMs: opts.perTaskTimeoutMs,
    });
    const results = await suite.run({ signal });
    suites.push({
      suite: 'tool-calling',
      results,
      durationMs: Date.now() - t0,
    });
  }

  return {
    model,
    suites,
    durationMs: Date.now() - start,
  };
}
