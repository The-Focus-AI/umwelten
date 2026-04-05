#!/usr/bin/env node
/**
 * Generate a 4-dimension report (without MCP) to include all 45 models.
 */
import { loadSuite, buildNarrativeReport } from '../../src/evaluation/combine/index.js';
import { buildSuiteReport } from '../../src/evaluation/combine/index.js';
import { Reporter } from '../../src/reporting/reporter.js';
import fs from 'fs';
import path from 'path';
import { SHOWDOWN_SUITE } from './suite-config.js';

/** Same dimensions as full showdown but without MCP (more models qualify for combined rows). */
const FOUR_DIM_SUITE = SHOWDOWN_SUITE.filter(
  (d) => d.evalName !== 'model-showdown-mcp'
);

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
