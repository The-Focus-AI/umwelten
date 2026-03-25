#!/usr/bin/env node
/**
 * Generate a 4-dimension report (without MCP) to include all 45 models.
 */
import { loadSuite, buildNarrativeReport } from '../../src/evaluation/combine/index.js';
import { buildSuiteReport } from '../../src/evaluation/combine/index.js';
import { Reporter } from '../../src/reporting/reporter.js';
import type { EvalDimension } from '../../src/evaluation/combine/index.js';
import fs from 'fs';
import path from 'path';

const FOUR_DIM_SUITE: EvalDimension[] = [
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
];

const args = process.argv.slice(2);
const formatIdx = args.indexOf('--format');
const format = formatIdx >= 0 ? args[formatIdx + 1] : 'narrative';

const outputIdx = args.indexOf('--output');
const outputFile = outputIdx >= 0 ? args[outputIdx + 1] : undefined;

const result = loadSuite(FOUR_DIM_SUITE);
console.error(`Models with 4-dim results: ${result.scorecards.length}`);

let output: string;

if (format === 'narrative') {
  output = buildNarrativeReport(result, {
    title: 'Model Showdown — 4-Dimension Results (All Models)',
  });
} else {
  const report = buildSuiteReport(result, {
    title: 'Model Showdown — 4-Dimension Results (All Models)',
  });
  const reporter = new Reporter();
  output = format === 'json' ? reporter.toJson(report) : reporter.toMarkdown(report);
}

if (outputFile) {
  const resolved = path.resolve(outputFile);
  fs.writeFileSync(resolved, output, 'utf8');
  console.error(`Report saved to: ${resolved}`);
} else {
  console.log(output);
}
