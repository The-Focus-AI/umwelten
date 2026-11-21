import type { EvalDimension } from "@umwelten/evaluation/evaluation/combine/types.js";

/** Active 5-dimension Model Watch suite (`examples/model-watch/run.ts`). */
export const MODEL_WATCH_SUITE: EvalDimension[] = [
  {
    evalName: "model-watch-reasoning",
    label: "Reasoning",
    maxScore: 20,
    perTaskMaxScore: 5,
    extractScore: (r) => r.score ?? r.judge?.reasoning_quality ?? 0,
  },
  {
    evalName: "model-watch-knowledge",
    label: "Knowledge",
    maxScore: 20,
    perTaskMaxScore: 5,
    extractScore: (r) => r.score ?? 0,
  },
  {
    evalName: "model-watch-instruction",
    label: "Instruction",
    maxScore: 25,
    perTaskMaxScore: 5,
    extractScore: (r) => r.score ?? 0,
  },
  {
    evalName: "model-watch-coding",
    label: "JS Coding",
    maxScore: 30,
    perTaskMaxScore: 10,
    extractScore: (r) => r.score ?? 0,
  },
  {
    evalName: "model-watch-tools",
    label: "Tool Chaining",
    maxScore: 10,
    perTaskMaxScore: 5,
    extractScore: (r) => r.score ?? 0,
  },
];

/** Legacy March 2026 5-dimension Model Showdown suite layout. */
export const SHOWDOWN_SUITE: EvalDimension[] = [
  {
    evalName: "model-showdown-reasoning",
    label: "Reasoning",
    maxScore: 20,
    perTaskMaxScore: 5,
    extractScore: (r) => r.judge?.reasoning_quality ?? r.reasoningQuality ?? r.score ?? 0,
    hasResultsSubdir: true,
  },
  {
    evalName: "model-showdown-knowledge",
    label: "Knowledge",
    maxScore: 30,
    perTaskMaxScore: 1,
    extractScore: (r) => (r.correct ? 1 : 0),
  },
  {
    evalName: "model-showdown-instruction",
    label: "Instruction",
    maxScore: 30,
    perTaskMaxScore: 5,
    extractScore: (r) => r.score ?? 0,
  },
  {
    evalName: "model-showdown-coding",
    label: "Coding",
    maxScore: 126,
    perTaskMaxScore: 7,
    extractScore: (r) => r.totalScore ?? r.score ?? 0,
    hasResultsSubdir: true,
  },
  {
    evalName: "model-showdown-mcp",
    label: "MCP Tool Use",
    maxScore: 16,
    perTaskMaxScore: 11,
    extractScore: (r) => (r.toolUsage?.tool_score ?? 0) + (r.judge?.overall_score ?? 0),
    hasResultsSubdir: true,
  },
];
