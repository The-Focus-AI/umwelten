#!/usr/bin/env node
/**
 * Model Showdown — Combined Report Generator
 *
 * Loads results from all 4 evaluation suites and produces
 * a unified leaderboard with cost/speed analysis.
 *
 * Usage:
 *   pnpm tsx examples/model-showdown/generate-report.ts                    # console tables
 *   pnpm tsx examples/model-showdown/generate-report.ts --format md        # structured markdown
 *   pnpm tsx examples/model-showdown/generate-report.ts --format narrative # full writeup
 *   pnpm tsx examples/model-showdown/generate-report.ts --format narrative --output report.md
 *   pnpm tsx examples/model-showdown/generate-report.ts --focus nemotron
 *   pnpm tsx examples/model-showdown/generate-report.ts --exclude mcp  # 4-dim report (no MCP)
 */

import { loadSuite, buildSuiteReport, buildNarrativeReport } from '../../src/evaluation/combine/index.js';
import { Reporter } from '../../src/reporting/reporter.js';
import { SHOWDOWN_SUITE } from './suite-config.js';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const formatIdx = args.indexOf('--format');
const format = formatIdx >= 0 ? args[formatIdx + 1] : 'console';

const outputIdx = args.indexOf('--output');
const outputFile = outputIdx >= 0 ? args[outputIdx + 1] : undefined;

const focusIdx = args.indexOf('--focus');
const focusModels = focusIdx >= 0 ? args.slice(focusIdx + 1).filter(a => !a.startsWith('--')) : undefined;

const excludeIdx = args.indexOf('--exclude');
const excludeDims = excludeIdx >= 0 ? args.slice(excludeIdx + 1).filter(a => !a.startsWith('--')) : [];

const suite = excludeDims.length > 0
  ? SHOWDOWN_SUITE.filter(d => !excludeDims.some(ex => d.label.toLowerCase().includes(ex.toLowerCase())))
  : SHOWDOWN_SUITE;

const result = loadSuite(suite);

if (result.scorecards.length === 0) {
  console.error('No models found in all evaluation dimensions.');
  console.error('Make sure all 4 evals have been run:');
  console.error('  model-showdown-reasoning, model-showdown-knowledge,');
  console.error('  model-showdown-instruction, model-showdown-coding');
  process.exit(1);
}

let output: string;

if (format === 'narrative' || format === 'full' || format === 'writeup') {
  output = buildNarrativeReport(result, {
    title: 'Model Showdown — Full Evaluation Report',
  });
} else if (format === 'md' || format === 'markdown') {
  const report = buildSuiteReport(result, {
    title: 'Model Showdown — Combined Results',
    focusModels,
  });
  const reporter = new Reporter();
  output = reporter.toMarkdown(report);
} else if (format === 'json') {
  const report = buildSuiteReport(result, {
    title: 'Model Showdown — Combined Results',
    focusModels,
  });
  const reporter = new Reporter();
  output = reporter.toJson(report);
} else {
  // Console — use structured report with toConsole
  const report = buildSuiteReport(result, {
    title: 'Model Showdown — Combined Results',
    focusModels,
  });
  const reporter = new Reporter();
  reporter.toConsole(report);
  output = '';
}

if (outputFile && output) {
  const resolved = path.resolve(outputFile);
  fs.writeFileSync(resolved, output, 'utf8');
  console.error(`Report saved to: ${resolved}`);
} else if (output) {
  console.log(output);
}
