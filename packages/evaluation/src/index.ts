/**
 * `@umwelten/evaluation` — Multi-model benchmarking (`EvalSuite`), Elo ranking
 * (`PairwiseRanker`), calibrated probability judgments (`Jev` / Brier / ECE),
 * and multi-suite scorecards (`combine` + `Reporter`) directly on `@earendil-works/pi-ai`.
 */

export { EvalSuite, isJudgeTask, modelKey } from "./evaluation/suite.js";
export type {
  EvalSuiteConfig,
  EvalSuiteRunStats,
  EvalTask,
  VerifyTask,
  JudgeTask,
  VerifyResult,
  TaskResultRecord,
  TaskTurnOptions,
} from "./evaluation/suite.js";

export {
  runFullEval,
  makeLanguageSuite,
  makeToolCallingSuite,
} from "./evaluation/llm-eval/index.js";
export {
  calculatorTool,
  statisticsTool,
} from "./evaluation/llm-eval/tool-calling.js";
export type {
  FullEvalOptions,
  FullEvalResult,
  SuiteRunResult,
  LlmEvalSuiteName,
  LanguageSuiteOptions,
  ToolCallingSuiteOptions,
} from "./evaluation/llm-eval/index.js";

export {
  PairwiseRanker,
  expectedScore,
  updateElo,
  buildStandings,
  allPairs,
  swissPairs,
  evaluationResultsToRankingEntries,
} from "./evaluation/ranking/index.js";
export type {
  RankingEntry,
  PairwiseResult,
  RankedModel,
  RankingOutput,
  PairwiseRankerConfig,
} from "./evaluation/ranking/index.js";

export { createJevBackend, type JevOptions } from "./evaluation/judgment/jev.js";
export { createLlmJudgmentBackend, JUDGMENT_INSTRUCTIONS } from "./evaluation/judgment/llm.js";
export {
  answerSchema,
  parseAnswers,
  validateRequest,
  wireQuestions,
} from "./evaluation/judgment/schema.js";
export {
  JudgmentError,
  type JudgmentAnswer,
  type JudgmentBackend,
  type JudgmentQuestion,
  type JudgmentQuestions,
  type JudgmentRequest,
  type JudgmentResult,
} from "./evaluation/judgment/types.js";
export {
  brierScore,
  rankedProbabilityScore,
  reliabilityBins,
  selectiveRisk,
} from "./evaluation/judgment/metrics.js";
export {
  pilotKey,
  runPilot,
  summarizePilot,
  validateCase,
  type JudgmentCase,
  type PilotRecord,
} from "./evaluation/judgment/pilot.js";

export {
  loadSuite,
  findLatestRunDir,
  loadDimension,
  buildSuiteReport,
  buildNarrativeReport,
} from "./evaluation/combine/index.js";
export type {
  EvalDimension,
  ModelScorecard,
  SuiteResult,
  DimensionScore,
  SuiteRunInfo,
  TaskResult,
  SuiteReportOptions,
  NarrativeReportOptions,
} from "./evaluation/combine/index.js";

export { Reporter } from "./reporting/reporter.js";
export type { Report, ReportSection, ReportType } from "./reporting/types.js";

export * from "./coding/index.js";
