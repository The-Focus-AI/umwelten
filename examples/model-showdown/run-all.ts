#!/usr/bin/env node
/**
 * Model Showdown — Run all evaluation suites
 *
 * Runs reasoning, knowledge, instruction, coding, and MCP tool-use evals,
 * then prints a combined leaderboard (MCP needs TezLab MCP server).
 *
 * Usage:
 *   pnpm tsx examples/model-showdown/run-all.ts               # quick (5 suites, 3 models each)
 *   pnpm tsx examples/model-showdown/run-all.ts --all          # full showdown
 *   pnpm tsx examples/model-showdown/run-all.ts --all --new    # fresh run
 *
 * Run individual suites:
 *   pnpm tsx examples/model-showdown/reasoning/reasoning-eval.ts --all
 *   pnpm tsx examples/model-showdown/coding/coding-eval.ts --all
 *   pnpm tsx examples/model-showdown/knowledge/knowledge-eval.ts --all
 *   pnpm tsx examples/model-showdown/instruction/instruction-eval.ts --all
 *   pnpm tsx examples/model-showdown/mcp-tool-use/mcp-eval.ts --all
 */

import './shared/env.js';
import { execSync } from 'child_process';

const args = process.argv.slice(2).join(' ');
const tsxArgs = args.replace(/--with-mcp\b/g, '').trim();

console.log('🏟️  MODEL SHOWDOWN — Comprehensive Evaluation Suite');
console.log('═'.repeat(70));
console.log();

function runSuite(name: string, script: string) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🚀 Starting: ${name}`);
  console.log(`${'═'.repeat(70)}\n`);

  try {
    execSync(`npx tsx ${script} ${tsxArgs}`, {
      stdio: 'inherit',
      cwd: process.cwd(),
      timeout: 600_000, // 10 minute timeout per suite
    });
  } catch (err) {
    console.error(`\n❌ ${name} failed — continuing with next suite\n`);
  }
}

// Core evals + MCP (TezLab); MCP failure does not stop the rest (see runSuite catch)
runSuite('Reasoning Eval', 'examples/model-showdown/reasoning/reasoning-eval.ts');
runSuite('Knowledge Eval', 'examples/model-showdown/knowledge/knowledge-eval.ts');
runSuite('Instruction Following Eval', 'examples/model-showdown/instruction/instruction-eval.ts');
runSuite('Coding Eval', 'examples/model-showdown/coding/coding-eval.ts --no-dagger');
runSuite('MCP Tool-Use Eval', 'examples/model-showdown/mcp-tool-use/mcp-eval.ts');

// Generate combined report
console.log(`\n${'═'.repeat(70)}`);
console.log('📊 Generating Combined Report');
console.log(`${'═'.repeat(70)}\n`);

try {
  execSync('npx tsx examples/model-showdown/generate-report.ts', {
    stdio: 'inherit',
    cwd: process.cwd(),
    timeout: 30_000,
  });
} catch (err) {
  console.error('\n❌ Combined report generation failed\n');
}

console.log('\n\n🏟️  MODEL SHOWDOWN COMPLETE');
console.log('═'.repeat(70));
console.log('Individual results are in output/evaluations/model-showdown-*/');
console.log('\n🎉 Done!');
