import type { EvalDimension } from '../../src/evaluation/combine/types.js';

export const SHOWDOWN_SUITE: EvalDimension[] = [
  {
    evalName: 'model-showdown-reasoning',
    label: 'Reasoning',
    maxScore: 20,
    extractScore: (r) => r.judge?.reasoning_quality ?? r.reasoningQuality ?? r.score ?? 0,
    hasResultsSubdir: true,
  },
  {
    evalName: 'model-showdown-knowledge',
    label: 'Knowledge',
    maxScore: 30,
    extractScore: (r) => r.correct ? 1 : 0,
  },
  {
    evalName: 'model-showdown-instruction',
    label: 'Instruction',
    maxScore: 30,
    extractScore: (r) => r.score ?? 0,
  },
  {
    evalName: 'model-showdown-coding',
    label: 'Coding',
    maxScore: 126,
    extractScore: (r) => r.totalScore ?? r.score ?? 0,
    hasResultsSubdir: true,
  },
  {
    evalName: 'model-showdown-mcp',
    label: 'MCP Tool Use',
    maxScore: 16,
    extractScore: (r) => (r.toolUsage?.tool_score ?? 0) + (r.judge?.overall_score ?? 0),
    hasResultsSubdir: true,
  },
];
