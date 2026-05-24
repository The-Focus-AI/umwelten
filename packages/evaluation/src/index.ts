/**
 * @umwelten/evaluation — Model evaluation, ranking, reporting.
 *
 * The canonical entry point is `EvalSuite` (below); for end-to-end runs
 * across language / coding / tool-calling, compose with `runFullEval`
 * from `./evaluation/llm-eval/`. See examples/local-providers and
 * examples/evals for usage patterns.
 */

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

