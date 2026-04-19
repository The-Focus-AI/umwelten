import type { EvalDimension } from '../../src/evaluation/combine/types.js';

/**
 * Local-Providers combined suite.
 *
 * After running each of:
 *   quality/instruction.ts
 *   quality/reasoning.ts
 *   quality/coding.ts
 *   quality/coding-bugfix.ts
 *   quality/tool-math.ts
 *   quality/soul-md.ts
 *
 * …run:
 *   dotenvx run -- pnpm run cli eval combine \
 *     --config examples/local-providers/suite-config.ts \
 *     --format narrative --output report.md
 */

// Additional export names the `umwelten eval combine` CLI looks for.
// Kept as-is for any external importers; aliased below.

export const LOCAL_PROVIDERS_SUITE: EvalDimension[] = [
  {
    evalName: 'local-providers-instruction',
    label: 'Instruction',
    maxScore: 30, // 6 tasks × 5
    perTaskMaxScore: 5,
    extractScore: (r) => r.score ?? 0,
  },
  {
    evalName: 'local-providers-reasoning',
    label: 'Reasoning',
    maxScore: 20, // 4 tasks × 5
    perTaskMaxScore: 5,
    extractScore: (r) => r.judge?.reasoning_quality ?? r.score ?? 0,
  },
  {
    evalName: 'local-providers-coding',
    label: 'Coding (write)',
    maxScore: 126, // 6 × 3 × 7
    perTaskMaxScore: 7,
    extractScore: (r) => r.score ?? 0,
  },
  {
    evalName: 'local-providers-coding-bugfix',
    label: 'Coding (fix)',
    maxScore: 25, // 5 × 5
    perTaskMaxScore: 5,
    extractScore: (r) => r.score ?? 0,
  },
  {
    evalName: 'local-providers-tool-math',
    label: 'Tool Math',
    maxScore: 25, // 5 × 5
    perTaskMaxScore: 5,
    extractScore: (r) => r.score ?? 0,
  },
  {
    evalName: 'local-providers-soul-md',
    label: 'Soul.md',
    maxScore: 10,
    perTaskMaxScore: 10,
    extractScore: (r) => r.quality_score ?? 0,
  },
];

/** Just the four core suites that run-quality.ts actually runs today.
 *  tool-math + soul-md are scaffolded but not yet part of the default run. */
export const LOCAL_PROVIDERS_CORE: EvalDimension[] =
  LOCAL_PROVIDERS_SUITE.filter(d => !['local-providers-tool-math', 'local-providers-soul-md'].includes(d.evalName));

// Aliases for `umwelten eval combine --config ...` (accepts
// `default`, `SHOWDOWN_SUITE`, `suite`, or `dimensions`).
export const suite = LOCAL_PROVIDERS_CORE;
export const dimensions = LOCAL_PROVIDERS_CORE;
export default LOCAL_PROVIDERS_CORE;
