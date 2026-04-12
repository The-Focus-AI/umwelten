#!/usr/bin/env node
/**
 * Reasoning Eval — 4 classic logic puzzles scored by LLM judge.
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/evals/reasoning.ts          # quick (3 models)
 *   dotenvx run -- pnpm tsx examples/evals/reasoning.ts --all    # full
 *   dotenvx run -- pnpm tsx examples/evals/reasoning.ts --new    # fresh run
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
  { name: 'openai/gpt-5.4-mini', provider: 'openrouter' },
  { name: 'deepseek/deepseek-v3.2', provider: 'openrouter' },
] as const;

const judgeSchema = z.object({
  reasoning_quality: z.coerce.number().min(1).max(5).describe('1=missed, 3=partial, 5=perfect'),
  explanation: z.string().describe('Brief explanation'),
});

const suite = new EvalSuite({
  name: 'reasoning-eval',
  stimulus: {
    role: 'helpful assistant',
    objective: 'answer clearly and concisely',
    instructions: ['Think carefully', 'Give a clear answer', 'Explain briefly'],
    temperature: 0.3,
    maxTokens: 500,
  },
  models: [...LOCAL],
  allModels: [...ALL],
  tasks: [
    {
      id: 'surgeon',
      name: 'Surgeon Riddle',
      prompt: 'A father and his son are in a car accident. The father dies. The son is rushed to the hospital. The surgeon says: "I can\'t operate on this boy, he\'s my son." How is this possible?',
      maxScore: 5,
      judge: {
        schema: judgeSchema,
        instructions: [
          'Correct answer: the surgeon is the boy\'s MOTHER.',
          '5=immediately says mother, 4=says mother with explanation, 3=lists many possibilities including mother, 2=wrong, 1=missed.',
        ],
      },
    },
    {
      id: 'bat-ball',
      name: 'Bat & Ball',
      prompt: 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?',
      maxScore: 5,
      judge: {
        schema: judgeSchema,
        instructions: [
          'Correct answer: $0.05 (five cents). The trap answer is $0.10.',
          '5=immediately gets $0.05, 3=self-corrects from $0.10, 2=says $0.10, 1=other wrong answer.',
        ],
      },
    },
    {
      id: 'lily-pad',
      name: 'Lily Pad',
      prompt: 'A patch of lily pads doubles in size every day. If it takes 48 days to cover the entire lake, how many days to cover half?',
      maxScore: 5,
      judge: {
        schema: judgeSchema,
        instructions: [
          'Correct answer: 47 days. The trap answer is 24 (half of 48).',
          '5=immediately says 47, 2=says 24, 1=other wrong answer.',
        ],
      },
    },
    {
      id: 'counterfeit-coin',
      name: 'Counterfeit Coin',
      prompt: 'You have 12 coins. One is counterfeit (heavier or lighter). Using a balance scale exactly 3 times, can you find it and determine heavier/lighter? Describe the procedure.',
      maxScore: 5,
      judge: {
        schema: judgeSchema,
        instructions: [
          'Answer is YES. Classic: weigh 4v4, narrow down, determine weight.',
          '5=complete correct procedure, 3=right idea incomplete, 1=says impossible.',
        ],
      },
    },
  ],
});

suite.run().catch(err => { console.error('Fatal:', err); process.exit(1); });
