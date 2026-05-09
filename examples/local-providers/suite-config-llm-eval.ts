import type { EvalDimension } from '@umwelten/evaluation/evaluation/combine/types.js';

/**
 * Local-Providers combined suite — backed by the new `llm-eval-*` evaluations
 * (the layout produced by `harness/runner.ts` → `runFullEval`). Splits the
 * three underlying evals into 5 reportable dimensions by filtering tasks via
 * `includeTask`:
 *
 *   llm-eval-language    → Instruction (instr-*) + Reasoning (reason-*)
 *   llm-eval-coding      → Coding write (gen-*) + Coding fix (bugfix-*)
 *   llm-eval-tool-calling → Tool Math (toolmath-*)
 *
 * Use:
 *   dotenvx run -- pnpm run cli eval combine \
 *     --config examples/local-providers/suite-config-llm-eval.ts \
 *     --format md --output output/local-providers-report.md
 */

export const LOCAL_PROVIDERS_SUITE: EvalDimension[] = [
  {
    id: 'instruction',
    evalName: 'llm-eval-language',
    label: 'Instruction',
    maxScore: 30, // 6 tasks × 5
    perTaskMaxScore: 5,
    extractScore: (r) => r.score ?? 0,
    includeTask: (id) => id.startsWith('instr-'),
  },
  {
    id: 'reasoning',
    evalName: 'llm-eval-language',
    label: 'Reasoning',
    maxScore: 20, // 4 tasks × 5
    perTaskMaxScore: 5,
    extractScore: (r) => r.score ?? 0,
    includeTask: (id) => id.startsWith('reason-'),
  },
  {
    id: 'coding-write',
    evalName: 'llm-eval-coding',
    label: 'Coding (write)',
    maxScore: 126, // 6 problems × 3 langs × 7
    perTaskMaxScore: 7,
    extractScore: (r) => r.score ?? 0,
    includeTask: (id) => id.startsWith('gen-'),
  },
  {
    id: 'coding-fix',
    evalName: 'llm-eval-coding',
    label: 'Coding (fix)',
    maxScore: 25, // 5 × 5
    perTaskMaxScore: 5,
    extractScore: (r) => r.score ?? 0,
    includeTask: (id) => id.startsWith('bugfix-'),
  },
  {
    id: 'tool-math',
    evalName: 'llm-eval-tool-calling',
    label: 'Tool Math',
    maxScore: 25, // 5 × 5
    perTaskMaxScore: 5,
    extractScore: (r) => r.score ?? 0,
    includeTask: (id) => id.startsWith('toolmath-'),
  },
  {
    id: 'coding-2pass',
    evalName: 'llm-eval-coding-2pass',
    label: 'Coding (2-pass)',
    maxScore: 126, // same shape as Coding (write): 6 × 3 × 7
    perTaskMaxScore: 7,
    extractScore: (r) => r.score ?? 0,
    includeTask: (id) => id.startsWith('gen-'),
  },
];

export const suite = LOCAL_PROVIDERS_SUITE;
export const dimensions = LOCAL_PROVIDERS_SUITE;
export default LOCAL_PROVIDERS_SUITE;
