/**
 * Instruction-following tasks — re-export from the canonical source.
 *
 * The data was relocated to `src/evaluation/llm-eval/data/instruction-tasks.ts`
 * so the runtime evaluation module (under `rootDir: "src"`) can compose it
 * with reasoning + coding + tool-calling into the `runFullEval` entry
 * point. Existing model-showdown scripts keep importing from this path
 * unchanged.
 */

export {
  ALL_TASKS,
  type InstructionTask,
} from '@umwelten/evaluation/evaluation/llm-eval/data/instruction-tasks.js';
