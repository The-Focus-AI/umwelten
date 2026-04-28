/**
 * Reasoning puzzles — re-export from the canonical source.
 *
 * Relocated to `src/evaluation/llm-eval/data/reasoning-puzzles.ts` so
 * the llm-eval module can compose them with the other suites. Old
 * scripts keep importing from this path unchanged.
 */

export {
  ALL_PUZZLES,
  type Puzzle,
} from '../../../src/evaluation/llm-eval/data/reasoning-puzzles.js';
