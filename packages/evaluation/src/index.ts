/**
 * @umwelten/evaluation — Model evaluation, ranking, reporting, and introspection.
 */

// ── Evaluation API ──────────────────────────────────────────────────────
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

// ── EvalSuite (declarative eval runner) ─────────────────────────────────
export { EvalSuite } from "./evaluation/suite.js";
export type {
	EvalSuiteConfig,
	EvalTask,
	VerifyTask,
	JudgeTask,
	VerifyResult,
	TaskResultRecord,
} from "./evaluation/suite.js";

// ── Ranking ─────────────────────────────────────────────────────────────
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

// ── Combine (multi-evaluation aggregation) ──────────────────────────────
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

// ── Reporting ───────────────────────────────────────────────────────────
export { Reporter } from "./reporting/reporter.js";
export type { Report, ReportSection, ReportType } from "./reporting/types.js";

