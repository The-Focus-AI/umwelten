/**
 * Language eval — instruction following + reasoning, against a single model.
 *
 * Composes the existing instruction tasks (deterministic verify) and
 * reasoning puzzles (LLM judge) into one EvalSuite. Each task is tagged
 * with `section: 'instruction-following' | 'reasoning'` so reports can
 * compute sub-scores.
 *
 * Provider-agnostic: takes a single ModelDetails and runs against it.
 * The "matrix" concept lives in the harness (Layer 2), not here.
 */

import { EvalSuite, type EvalTask } from '../suite.js';
import type { ModelDetails } from '../../cognition/types.js';
import { ALL_TASKS as INSTRUCTION_TASKS } from './data/instruction-tasks.js';
import { ALL_PUZZLES as REASONING_PUZZLES } from './data/reasoning-puzzles.js';

const SECTION_INSTRUCTION = 'instruction-following';
const SECTION_REASONING = 'reasoning';

function buildInstructionTasks(): EvalTask[] {
  return INSTRUCTION_TASKS.map((t) => ({
    id: `instr-${t.id}`,
    name: t.name,
    prompt: t.prompt,
    maxScore: 5,
    section: SECTION_INSTRUCTION,
    verify: (response: string) => {
      const v = t.verify(response);
      return { score: v.score, details: v.details };
    },
  }));
}

function buildReasoningTasks(): EvalTask[] {
  return REASONING_PUZZLES.map((p) => ({
    id: `reason-${p.id}`,
    name: p.name,
    prompt: p.prompt,
    maxScore: 5,
    section: SECTION_REASONING,
    judge: {
      schema: p.judgeSchema,
      instructions: p.judgeInstructions,
      extractScore: (j: any) => j.reasoning_quality ?? 0,
    },
  }));
}

export interface LanguageSuiteOptions {
  /** Override the eval name (default: `llm-eval-language`). Useful for the
   * harness so each model writes to its own cache directory. */
  name?: string;
  /** Judge model for reasoning puzzles. Defaults to suite default. */
  judgeModel?: ModelDetails;
  /** Override per-task timeout (ms). Defaults to EvalSuite default (5 min). */
  perTaskTimeoutMs?: number;
}

export function makeLanguageSuite(
  model: ModelDetails,
  opts: LanguageSuiteOptions = {},
): EvalSuite {
  const tasks: EvalTask[] = [
    ...buildInstructionTasks(),
    ...buildReasoningTasks(),
  ];

  return new EvalSuite({
    name: opts.name ?? 'llm-eval-language',
    stimulus: (task) => {
      // Distinct stimuli per section: instruction wants strict literal
      // following, reasoning wants brief CoT. Keeping these separate is
      // why we pass a function instead of a single Stimulus options blob.
      if (task.section === SECTION_REASONING) {
        return {
          role: 'helpful assistant',
          objective: 'answer the question clearly and concisely',
          instructions: [
            'Think through the question carefully',
            'Give a clear, definitive answer',
            'Explain your reasoning briefly',
          ],
          temperature: 0.3,
          maxTokens: 800,
        };
      }
      return {
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
      };
    },
    tasks,
    models: [model],
    allModels: [model],
    judgeModel: opts.judgeModel,
    concurrency: 1,
    perTaskTimeoutMs: opts.perTaskTimeoutMs,
  });
}
