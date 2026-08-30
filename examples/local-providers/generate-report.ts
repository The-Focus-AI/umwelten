#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  Reporter,
  buildNarrativeReport,
  buildSuiteReport,
  loadSuite,
} from '@umwelten/evaluation';
import { LOCAL_PROVIDERS_CORE } from './suite-config.js';
import { LOCAL_PROVIDERS_SUITE as LLM_EVAL_SUITE } from './suite-config-llm-eval.js';

const args = process.argv.slice(2);
const valueAfter = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const format = valueAfter('--format') ?? 'console';
const outputFile = valueAfter('--output');
const dimensions = args.includes('--llm-eval')
  ? LLM_EVAL_SUITE
  : LOCAL_PROVIDERS_CORE;
const result = loadSuite(dimensions);

if (result.scorecards.length === 0) {
  console.error('No models have results in every selected dimension.');
  process.exit(1);
}

const reporter = new Reporter();
let output = '';

if (format === 'narrative') {
  output = buildNarrativeReport(result, { title: 'Local Providers Report' });
} else {
  const report = buildSuiteReport(result, { title: 'Local Providers Results' });
  if (format === 'md' || format === 'markdown') {
    output = reporter.toMarkdown(report);
  } else if (format === 'json') {
    output = reporter.toJson(report);
  } else {
    reporter.toConsole(report);
  }
}

if (outputFile && output) {
  const resolved = path.resolve(outputFile);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, output, 'utf8');
  console.error(`Report saved to: ${resolved}`);
} else if (output) {
  console.log(output);
}
