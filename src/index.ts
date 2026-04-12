/**
 * Public library entry for `umwelten`. Prefer deep imports (`umwelten/dist/...`) only when needed.
 */

export { Habitat } from "./habitat/index.js";
export type {
  HabitatConfig,
  HabitatOptions,
  HabitatSessionMetadata,
  HabitatSessionType,
  AgentEntry,
  OnboardingResult,
} from "./habitat/types.js";

export { Interaction } from "./interaction/core/interaction.js";
export { Stimulus } from "./stimulus/stimulus.js";

export {
  runEvaluation,
  generateReport,
  listEvaluations,
  runEvaluationWithProgress,
  parseModel,
} from "./evaluation/api.js";
export type {
  EvaluationConfig,
  EvaluationResult,
  EnhancedEvaluationConfig,
} from "./evaluation/api.js";

export { EvalSuite } from "./evaluation/suite.js";
export type {
  EvalSuiteConfig,
  EvalTask,
  VerifyTask,
  JudgeTask,
  VerifyResult,
  TaskResultRecord,
} from "./evaluation/suite.js";

export { PairwiseRanker } from "./evaluation/ranking/index.js";
export type {
  RankingEntry,
  PairwiseResult,
  RankedModel,
  RankingOutput,
  PairwiseRankerConfig,
} from "./evaluation/ranking/index.js";
