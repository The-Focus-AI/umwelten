#!/usr/bin/env node
/**
 * Car Wash Test — Common-sense reasoning (the classic).
 *
 * "Should I walk or drive to the car wash?" → DRIVE (you need the car there).
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/evals/car-wash.ts          # quick
 *   dotenvx run -- pnpm tsx examples/evals/car-wash.ts --all    # full
 */

import '../../src/env/load.js';
import { z } from 'zod';
import { EvalSuite } from '../../src/evaluation/suite.js';

const LOCAL = [
  { name: 'gemini-3-flash-preview', provider: 'google' },
  { name: 'openai/gpt-5.4-nano', provider: 'openrouter' },
  { name: 'qwen3:30b-a3b', provider: 'ollama' },
] as const;

const ALL = [
  ...LOCAL,
  { name: 'anthropic/claude-sonnet-4.6', provider: 'openrouter' },
  { name: 'openai/gpt-5.4', provider: 'openrouter' },
  { name: 'deepseek/deepseek-v3.2', provider: 'openrouter' },
  { name: 'deepseek/deepseek-r1', provider: 'openrouter' },
  { name: 'x-ai/grok-4.20-beta', provider: 'openrouter' },
] as const;

const suite = new EvalSuite({
  name: 'car-wash-test',
  stimulus: {
    role: 'helpful assistant',
    objective: 'answer clearly and concisely',
    instructions: ['Think carefully', 'Give a clear recommendation', 'Explain briefly'],
    temperature: 0.3,
    maxTokens: 500,
  },
  models: [...LOCAL],
  allModels: [...ALL],
  tasks: [{
    id: 'car-wash',
    name: 'Car Wash',
    prompt: 'I want to wash my car. The car wash is 50 meters away. Should I walk or drive?',
    maxScore: 5,
    judge: {
      schema: z.object({
        recommendation: z.string().describe('"drive" or "walk" or "unclear"'),
        recognizes_need_for_car: z.coerce.boolean().describe('Does model understand car must be at the wash?'),
        reasoning_quality: z.coerce.number().min(1).max(5).describe('5=immediately gets it, 2=right answer wrong reason, 1=missed'),
        explanation: z.string(),
      }),
      instructions: [
        'The ONLY correct answer is DRIVE — the car must be at the car wash to be washed.',
        'A model saying "drive" for convenience/laziness has the wrong reason (score 2).',
        'A model saying "walk" completely fails (score 1).',
        '5=immediately identifies car must be at wash, 4=good reasoning, 3=partial, 2=right answer wrong reason.',
      ],
    },
  }],
});

suite.run().catch(err => { console.error('Fatal:', err); process.exit(1); });
