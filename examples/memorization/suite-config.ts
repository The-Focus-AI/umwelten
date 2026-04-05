/**
 * Suite configuration for eval combine integration.
 *
 * Allows memorization metrics to be combined with other evaluations
 * using the standard `loadSuite()` + `buildSuiteReport()` pipeline.
 *
 * Usage:
 *   dotenvx run -- pnpm run cli eval combine --config examples/memorization/suite-config.ts
 */

import type { EvalDimension } from '../../src/evaluation/combine/types.js';

export const MEMORIZATION_SUITE: EvalDimension[] = [
  {
    evalName: 'memorization-metrics',
    label: 'Memorization (bmc@k)',
    maxScore: 100,  // bmc@k as percentage
    extractScore: (r) => (r.bmcAtK ?? 0) * 100,
    hasResultsSubdir: true,
  },
];
