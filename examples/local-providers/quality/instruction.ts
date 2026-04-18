#!/usr/bin/env node
/**
 * Local-Providers Instruction Following
 *
 * Reuses the 6 instruction-following tasks from model-showdown. Exports
 * `makeSuite(models)` so the top-level run-quality.ts driver can invoke
 * this suite once per model (model-major iteration for memory safety).
 *
 * Direct invocation (runs all LOCAL_MODELS in one go, task-major):
 *   dotenvx run -- pnpm tsx examples/local-providers/quality/instruction.ts
 *   dotenvx run -- pnpm tsx examples/local-providers/quality/instruction.ts --frontier --new
 */

import '../../model-showdown/shared/env.js';
import { fileURLToPath } from 'node:url';
import { EvalSuite } from '../../../src/evaluation/suite.ts';
import { ALL_TASKS } from '../../model-showdown/instruction/tasks.js';
import type { ModelDetails } from '../../../src/cognition/types.js';
import { LOCAL_MODELS, ALL_MODELS, includeFrontier } from '../shared/models.js';

export function makeSuite(models: ModelDetails[]): EvalSuite {
  return new EvalSuite({
    name: 'local-providers-instruction',
    stimulus: {
      role: 'precise assistant that follows instructions exactly',
      objective: 'follow the given instructions with exact format compliance',
      instructions: [
        'Follow the instructions EXACTLY as given',
        'Pay close attention to format requirements',
        'Do not add extra text, explanations, or commentary unless asked',
        'Output ONLY what is requested',
      ],
      temperature: 0.0,
      maxTokens: 500,
      runnerType: 'base',
    },
    tasks: ALL_TASKS.map(t => ({
      id: t.id,
      name: t.name,
      prompt: t.prompt,
      maxScore: 5,
      verify: (response: string) => {
        const v = t.verify(response);
        return { score: v.score, details: v.details };
      },
    })),
    models,
    allModels: models,
    concurrency: 1, // local runtimes serialize — parallel calls thrash model-swap
  });
}

// Direct invocation entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const models = includeFrontier() ? ALL_MODELS : LOCAL_MODELS;
  makeSuite(models).run().catch(err => { console.error(err); process.exit(1); });
}
