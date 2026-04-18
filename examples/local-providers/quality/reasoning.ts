#!/usr/bin/env node
/**
 * Local-Providers Reasoning Eval — 4 LLM-judged puzzles.
 *
 * Direct invocation (runs all LOCAL_MODELS in one go, task-major):
 *   dotenvx run -- pnpm tsx examples/local-providers/quality/reasoning.ts
 *   dotenvx run -- pnpm tsx examples/local-providers/quality/reasoning.ts --frontier --new
 */

import '../../model-showdown/shared/env.js';
import { fileURLToPath } from 'node:url';
import { EvalSuite } from '../../../src/evaluation/suite.ts';
import { ALL_PUZZLES } from '../../model-showdown/reasoning/puzzles.js';
import type { ModelDetails } from '../../../src/cognition/types.js';
import { LOCAL_MODELS, ALL_MODELS, includeFrontier } from '../shared/models.js';

export function makeSuite(models: ModelDetails[]): EvalSuite {
  return new EvalSuite({
    name: 'local-providers-reasoning',
    stimulus: {
      role: 'helpful assistant',
      objective: 'answer the question clearly and concisely',
      instructions: [
        'Think through the question carefully',
        'Give a clear, definitive answer',
        'Explain your reasoning briefly',
      ],
      temperature: 0.3,
      maxTokens: 800,
      runnerType: 'base',
    },
    tasks: ALL_PUZZLES.map(p => ({
      id: p.id,
      name: p.name,
      prompt: p.prompt,
      maxScore: 5,
      judge: {
        schema: p.judgeSchema,
        instructions: p.judgeInstructions,
        extractScore: (j: any) => j.reasoning_quality ?? 0,
      },
    })),
    models,
    allModels: models,
    concurrency: 1,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const models = includeFrontier() ? ALL_MODELS : LOCAL_MODELS;
  makeSuite(models).run().catch(err => { console.error(err); process.exit(1); });
}
