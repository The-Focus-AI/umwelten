/**
 * Coding challenges — re-export from the canonical source.
 *
 * Relocated to `src/evaluation/llm-eval/data/coding-challenges.ts` so
 * the llm-eval module can compose them with the other suites. Old
 * scripts keep importing from this path unchanged.
 */

export {
  ALL_CHALLENGES,
  ALL_LANGUAGES,
  type CodingChallenge,
  type Language,
} from '@umwelten/evaluation/evaluation/llm-eval/data/coding-challenges.js';
