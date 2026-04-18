#!/usr/bin/env node
/**
 * Local-Providers Reasoning Eval
 *
 * Reuses the 4 reasoning puzzles (surgeon, bat & ball, lily pad,
 * counterfeit coin) from model-showdown. Each is LLM-judged.
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/local-providers/quality/reasoning.ts
 *   dotenvx run -- pnpm tsx examples/local-providers/quality/reasoning.ts --frontier --new
 */

import '../../model-showdown/shared/env.js';
import { EvalSuite } from '../../../src/evaluation/suite.ts';
import { ALL_PUZZLES } from '../../model-showdown/reasoning/puzzles.js';
import { LOCAL_MODELS, ALL_MODELS, includeFrontier } from '../shared/models.js';

const models = includeFrontier() ? ALL_MODELS : LOCAL_MODELS;

const suite = new EvalSuite({
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
  concurrency: 3,
});

suite.run().catch(err => { console.error(err); process.exit(1); });
