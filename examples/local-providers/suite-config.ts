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
