/**
 * @umwelten/fission — session fission.
 *
 * A conversation is a tree, not a line. Every turn is scored for topic drift,
 * compacted, and — when it reads as the start of something new — spun off into
 * its own thread seeded with only what it needs from the parent.
 *
 * See README.md for the model, the knobs, and how to read the report.
 */

export * from "./types.js";

export { FissionTree } from "./tree/tree.js";
export type { CreateTreeOptions } from "./tree/tree.js";
export { FissionStore, defaultFissionRoot } from "./tree/store.js";
export {
  buildSignature,
  mergeSignature,
  cosineSimilarity,
  termCoverage,
  emptySignature,
  tokenize,
  surfaceTerms,
  stem,
  topTerms,
} from "./tree/signature.js";

export type { FissionDetector, DetectorContext } from "./detect/types.js";
export { continueResult } from "./detect/types.js";
export { registerDetector, getDetector, listDetectors } from "./detect/registry.js";
export { lexicalDriftDetector, scoreLexicalDrift, turnTopicText } from "./detect/lexical-drift.js";
export { llmJudgeDetector, scoreFromJudgement } from "./detect/llm-judge.js";
export { hybridDetector, LOW_GATE, HIGH_GATE } from "./detect/hybrid.js";
export { neverDetector } from "./detect/never.js";

export { analyzeTurn, degradedAnalysis } from "./analysis/turn-analysis.js";

export { rollingSummaryStrategy } from "./compaction/rolling-summary.js";
export { topicCarryoverStrategy } from "./compaction/topic-carryover.js";
export { recentWindowStrategy } from "./compaction/recent-window.js";
export {
  registerFissionStrategies,
  listAllStrategies,
  FISSION_STRATEGIES,
} from "./compaction/register.js";

export { FissionChat } from "./engine/fission-chat.js";
export type { FissionChatOptions, SendOptions } from "./engine/fission-chat.js";
export { runCompaction, planCompaction } from "./engine/compact.js";
export type { CompactionOutcome } from "./engine/compact.js";
export { buildFissionTools, searchTree, createRecallTool } from "./engine/tools.js";
export type { FissionEvent, FissionEventHandler } from "./engine/events.js";

export { buildFissionReport } from "./report/build-report.js";
export type { FissionReport } from "./report/build-report.js";
export { renderReportHtml } from "./report/render-html.js";
export { startFissionServer } from "./server/server.js";
export type { FissionServerOptions, FissionServerHandle } from "./server/server.js";
