#!/usr/bin/env node
/**
 * Instruction Following Eval — Tests format compliance and constraint adherence
 *
 * Critical for base model evaluation: a model that can't follow exact
 * instructions won't fine-tune well.
 *
 * 6 tasks, each scored /5, total /30 per model.
 *
 * Usage:
 *   pnpm tsx examples/model-showdown/instruction/instruction-eval.ts               # quick (3 models)
 *   pnpm tsx examples/model-showdown/instruction/instruction-eval.ts --all          # full showdown
 *   pnpm tsx examples/model-showdown/instruction/instruction-eval.ts --all --new    # fresh run
 */

import '../shared/env.js';
import fs from 'fs';
import path from 'path';
import { Stimulus } from '../../../src/stimulus/stimulus.js';
import { SimpleEvaluation } from '../../../src/evaluation/strategies/simple-evaluation.js';
import { EvaluationCache } from '../../../src/evaluation/caching/cache-service.js';
import type { ModelDetails } from '../../../src/cognition/types.js';
import { SHOWDOWN_MODELS, LOCAL_TEST_MODELS, modelLabel, modelKey } from '../shared/models.js';
import { resolveRun, isFullRun } from '../shared/runner-utils.js';
import { ALL_TASKS, type InstructionTask } from './tasks.js';

// ── Types ───────────────────────────────────────────────────────────────────

interface InstructionResult {
  taskId: string;
  taskName: string;
  model: string;
  provider: string;
  responseText: string;
  score: number;
  details: string;
  durationMs: number;
  cost: number;
  error?: string;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const models = isFullRun() ? SHOWDOWN_MODELS : LOCAL_TEST_MODELS;
  const { runId, runDir, isResume } = resolveRun('model-showdown-instruction');

  console.log('📋 Instruction Following Eval — Model Showdown');
  console.log('═'.repeat(70));
  console.log(`Tasks:   ${ALL_TASKS.length} (${ALL_TASKS.map(t => t.name).join(', ')})`);
  console.log(`Models:  ${models.length}`);
  console.log(`Max:     ${ALL_TASKS.length * 5} per model`);
  console.log(`Run:     #${runId}${isResume ? ' (resuming)' : ''}`);
  console.log('═'.repeat(70));
  console.log();

  const allResults: InstructionResult[] = [];

  for (const task of ALL_TASKS) {
    console.log(`\n📋 ${task.name}`);
    console.log(`   "${task.prompt.slice(0, 70)}..."\n`);

    const stimulus = new Stimulus({
      role: 'precise assistant that follows instructions exactly',
      objective: 'follow the given instructions with exact format compliance',
      instructions: [
        'Follow the instructions EXACTLY as given',
        'Pay close attention to format requirements',
        'Do not add extra text, explanations, or commentary unless asked',
        'Output ONLY what is requested',
      ],
      temperature: 0.0,
      maxTokens: 500,
      runnerType: 'base',
    });

    const cache = new EvaluationCache(
      `model-showdown-instruction/runs/${runId}/${task.id}`,
      { verbose: false }
    );

    const evaluation = new SimpleEvaluation(
      stimulus,
      models,
      task.prompt,
      cache,
      {
        evaluationId: `instruction-${task.id}-${runId}`,
        useCache: true,
        concurrent: true,
        maxConcurrency: 10,
        showProgress: false,
      },
    );

    const evalResults = await evaluation.run();

    const resultsDir = path.join(runDir, task.id);
    fs.mkdirSync(resultsDir, { recursive: true });

    for (const result of evalResults) {
      const label = modelLabel(result.model);
      const mk = modelKey(result.model);
      const resultPath = path.join(resultsDir, `${mk}.json`);

      // Cache hit
      if (fs.existsSync(resultPath) && !process.argv.includes('--new')) {
        const cached = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as InstructionResult;
        allResults.push(cached);
        const icon = cached.score >= 4 ? '✅' : cached.score >= 2 ? '⚠️' : '❌';
        console.log(`   ${icon} ${label} → ${cached.score}/5 (cached) ${cached.details.slice(0, 50)}`);
        continue;
      }

      const responseText = typeof result.response.content === 'string'
        ? result.response.content
        : JSON.stringify(result.response.content);

      let verification = { pass: false, score: 0, details: 'empty response' };
      if (responseText && !result.metadata.error) {
        verification = task.verify(responseText);
      }

      const r: InstructionResult = {
        taskId: task.id,
        taskName: task.name,
        model: result.model.name,
        provider: result.model.provider,
        responseText: (responseText || '').slice(0, 1000),
        score: verification.score,
        details: verification.details,
        durationMs: result.metadata.duration,
        cost: result.response.metadata.cost?.totalCost || 0,
        error: result.metadata.error,
      };
      allResults.push(r);
      fs.writeFileSync(resultPath, JSON.stringify(r, null, 2));

      const icon = r.score >= 4 ? '✅' : r.score >= 2 ? '⚠️' : '❌';
      console.log(`   ${icon} ${label} → ${r.score}/5 ${r.details.slice(0, 60)}`);
    }
  }

  // ── Print results ───────────────────────────────────────────────────────

  printResults(allResults);
}

function printResults(allResults: InstructionResult[]) {
  const maxScore = ALL_TASKS.length * 5;

  // Aggregate by model
  const modelScores = new Map<string, {
    total: number; max: number; cost: number; time: number;
    byTask: Map<string, number>;
  }>();

  for (const r of allResults) {
    const key = `${r.provider}:${r.model}`;
    const existing = modelScores.get(key) || {
      total: 0, max: 0, cost: 0, time: 0, byTask: new Map(),
    };
    existing.total += r.score;
    existing.max += 5;
    existing.cost += r.cost;
    existing.time += r.durationMs;
    existing.byTask.set(r.taskId, r.score);
    modelScores.set(key, existing);
  }

  const ranked = [...modelScores.entries()]
    .map(([label, s]) => ({ label, ...s }))
    .sort((a, b) => b.total - a.total || a.cost - b.cost);

  const mw = Math.max(50, ...ranked.map(r => r.label.length + 2));

  console.log('\n\n🏁 INSTRUCTION FOLLOWING EVAL — FINAL RANKINGS');
  console.log('═'.repeat(110));

  const taskHeaders = ALL_TASKS.map(t => t.name.slice(0, 8).padEnd(9)).join(' ');
  console.log(
    `${'Model'.padEnd(mw)} ${'Score'.padEnd(12)} ${taskHeaders} ${'Cost'.padEnd(10)}`
  );
  console.log('─'.repeat(110));

  for (const r of ranked) {
    const pct = Math.round((r.total / r.max) * 100);
    const icon = pct >= 90 ? '🥇' : pct >= 75 ? '🥈' : pct >= 60 ? '🥉' : '💀';

    const taskScores = ALL_TASKS.map(t => {
      const s = r.byTask.get(t.id) ?? 0;
      return `${s}/5`.padEnd(9);
    }).join(' ');

    console.log(
      `${icon} ${r.label.padEnd(mw - 2)} ${`${r.total}/${r.max} (${pct}%)`.padEnd(12)} ${taskScores} ${`$${r.cost.toFixed(4)}`.padEnd(10)}`
    );
  }

  // ── Nemotron Deep Dive ────────────────────────────────────────────

  console.log('\n\n🔬 NEMOTRON DEEP DIVE — Instruction Following');
  console.log('─'.repeat(80));
  const nemotronModels = ranked.filter(r =>
    r.label.toLowerCase().includes('nemotron') || r.label.toLowerCase().includes('nvidia')
  );
  for (const r of nemotronModels) {
    const pct = Math.round((r.total / r.max) * 100);
    console.log(`  ${r.label.padEnd(55)} ${r.total}/${r.max} (${pct}%)`);
    for (const t of ALL_TASKS) {
      const s = r.byTask.get(t.id) ?? 0;
      const icon = s >= 4 ? '✅' : s >= 2 ? '⚠️' : '❌';
      console.log(`    ${icon} ${t.name.padEnd(25)} ${s}/5`);
    }
  }

  const totalCost = allResults.reduce((s, r) => s + r.cost, 0);
  console.log(`\n💰 Total cost: $${totalCost.toFixed(4)}`);
  console.log('\n🎉 Instruction following eval complete!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
