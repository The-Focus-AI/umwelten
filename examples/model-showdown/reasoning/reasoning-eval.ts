#!/usr/bin/env node
/**
 * Reasoning Eval — Classic logic puzzles scored by LLM judge
 *
 * Tests: surgeon riddle, bat & ball, lily pad, counterfeit coin
 * Optionally tests each model at multiple reasoning effort levels.
 *
 * Usage:
 *   pnpm tsx examples/model-showdown/reasoning/reasoning-eval.ts                # quick (3 models)
 *   pnpm tsx examples/model-showdown/reasoning/reasoning-eval.ts --all          # full showdown
 *   pnpm tsx examples/model-showdown/reasoning/reasoning-eval.ts --all --new    # fresh run
 *   pnpm tsx examples/model-showdown/reasoning/reasoning-eval.ts --all --with-reasoning-levels
 */

import '../shared/env.js';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { Stimulus } from '../../../src/stimulus/stimulus.js';
import { SimpleEvaluation } from '../../../src/evaluation/strategies/simple-evaluation.js';
import { EvaluationCache } from '../../../src/evaluation/caching/cache-service.js';
import { clearAllRateLimitStates } from '../../../src/rate-limit/rate-limit.js';
import type { ModelDetails, ModelResponse } from '../../../src/cognition/types.js';
import { SHOWDOWN_MODELS, LOCAL_TEST_MODELS, expandWithReasoningEfforts, modelLabel, modelKey } from '../shared/models.js';
import { resolveRun, isFullRun, withReasoningLevels, delay } from '../shared/runner-utils.js';
import { JUDGE_MODEL, judgeResponse } from '../shared/judge.js';
import { ALL_PUZZLES, type Puzzle } from './puzzles.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface PuzzleResult {
  puzzleId: string;
  model: string;
  provider: string;
  reasoningEffort?: string;
  responseText: string;
  durationMs: number;
  cost: number;
  judge: any | null;
  judgeError?: string;
  correct: boolean;
  reasoningQuality: number;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let models = isFullRun() ? SHOWDOWN_MODELS : LOCAL_TEST_MODELS;

  if (withReasoningLevels()) {
    models = expandWithReasoningEfforts(models, ['low', 'medium', 'high']);
  }

  const { runId, runDir, runNumber, isResume } = resolveRun('model-showdown-reasoning');

  console.log('🧠 Reasoning Eval — Model Showdown');
  console.log('═'.repeat(70));
  console.log(`Puzzles:  ${ALL_PUZZLES.length} (${ALL_PUZZLES.map(p => p.name).join(', ')})`);
  console.log(`Models:   ${models.length}`);
  console.log(`Run:      #${runId}${isResume ? ' (resuming)' : ''}`);
  console.log('═'.repeat(70));
  console.log();

  const allResults: PuzzleResult[] = [];

  for (const puzzle of ALL_PUZZLES) {
    console.log(`\n📝 Puzzle: ${puzzle.name}`);
    console.log(`   "${puzzle.prompt.slice(0, 80)}..."`);
    console.log(`   Correct: ${puzzle.correctAnswer}\n`);

    // ── Step 1: Get responses from all models ─────────────────────────────

    const stimulus = new Stimulus({
      role: 'helpful assistant',
      objective: 'answer the question clearly and concisely',
      instructions: [
        'Think through the question carefully',
        'Give a clear, definitive answer',
        'Explain your reasoning briefly',
      ],
      temperature: 0.3,
      maxTokens: 500,
      runnerType: 'base',
    });

    const puzzleDir = path.join(runDir, puzzle.id);
    const responsesDir = path.join(puzzleDir, 'responses');
    const resultsDir = path.join(puzzleDir, 'results');
    fs.mkdirSync(responsesDir, { recursive: true });
    fs.mkdirSync(resultsDir, { recursive: true });

    // Use SimpleEvaluation with caching
    const cache = new EvaluationCache(
      `model-showdown-reasoning/runs/${runId}/${puzzle.id}`,
      { verbose: false }
    );

    const evaluation = new SimpleEvaluation(
      stimulus,
      models,
      puzzle.prompt,
      cache,
      {
        evaluationId: `reasoning-${puzzle.id}-${runId}`,
        useCache: true,
        concurrent: true,
        maxConcurrency: 5,
        showProgress: true,
      },
      (progress) => {
        if (progress.status === 'completed') {
          console.log(`  ✅ ${progress.modelName}`);
        } else if (progress.status === 'error') {
          console.log(`  ❌ ${progress.modelName}: ${progress.error}`);
        }
      }
    );

    console.log('   📡 Getting model responses...\n');
    const evalResults = await evaluation.run();
    console.log(`\n   ✅ Got ${evalResults.length} responses\n`);

    // ── Step 2: Judge each response ───────────────────────────────────────

    clearAllRateLimitStates();
    console.log(`   ⚖️  Judging with ${modelLabel(JUDGE_MODEL)}...\n`);

    for (const result of evalResults) {
      const label = modelLabel(result.model);
      const mk = modelKey(result.model);
      const resultPath = path.join(resultsDir, `${mk}.json`);

      // Cache hit
      if (fs.existsSync(resultPath)) {
        const cached = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as PuzzleResult;
        if (cached.judge !== null) {
          allResults.push(cached);
          continue;
        }
      }

      const responseText = typeof result.response.content === 'string'
        ? result.response.content
        : JSON.stringify(result.response.content);

      if (!responseText || result.metadata.error) {
        const r: PuzzleResult = {
          puzzleId: puzzle.id,
          model: result.model.name,
          provider: result.model.provider,
          reasoningEffort: result.model.reasoningEffort,
          responseText: '',
          durationMs: result.metadata.duration,
          cost: result.response.metadata.cost?.totalCost || 0,
          judge: null,
          judgeError: result.metadata.error || 'empty response',
          correct: false,
          reasoningQuality: 0,
        };
        allResults.push(r);
        fs.writeFileSync(resultPath, JSON.stringify(r, null, 2));
        continue;
      }

      try {
        const judgeResult = await judgeResponse(
          JUDGE_MODEL,
          puzzle.judgeInstructions,
          responseText,
          puzzle.judgeSchema
        );

        const rq = judgeResult.reasoning_quality ?? 0;
        const r: PuzzleResult = {
          puzzleId: puzzle.id,
          model: result.model.name,
          provider: result.model.provider,
          reasoningEffort: result.model.reasoningEffort,
          responseText,
          durationMs: result.metadata.duration,
          cost: result.response.metadata.cost?.totalCost || 0,
          judge: judgeResult,
          correct: rq >= 4,
          reasoningQuality: rq,
        };
        allResults.push(r);
        fs.writeFileSync(resultPath, JSON.stringify(r, null, 2));

        const icon = rq >= 4 ? '✅' : rq >= 3 ? '⚠️' : '❌';
        console.log(`   ${icon} ${label} → ${rq}/5 — ${judgeResult.explanation?.slice(0, 60) || ''}`);
      } catch (err) {
        const r: PuzzleResult = {
          puzzleId: puzzle.id,
          model: result.model.name,
          provider: result.model.provider,
          reasoningEffort: result.model.reasoningEffort,
          responseText,
          durationMs: result.metadata.duration,
          cost: result.response.metadata.cost?.totalCost || 0,
          judge: null,
          judgeError: err instanceof Error ? err.message : String(err),
          correct: false,
          reasoningQuality: 0,
        };
        allResults.push(r);
        fs.writeFileSync(resultPath, JSON.stringify(r, null, 2));
        console.log(`   ⚠️  ${label} → judge error: ${r.judgeError?.slice(0, 60)}`);
      }

      await delay(500);
    }
  }

  // ── Step 3: Print combined results ───────────────────────────────────────

  // Aggregate per model: average reasoning quality across puzzles
  const modelScores = new Map<string, { total: number; count: number; correct: number; cost: number; time: number }>();

  for (const r of allResults) {
    const key = `${r.provider}:${r.model}${r.reasoningEffort ? `[${r.reasoningEffort}]` : ''}`;
    const existing = modelScores.get(key) || { total: 0, count: 0, correct: 0, cost: 0, time: 0 };
    existing.total += r.reasoningQuality;
    existing.count += 1;
    existing.correct += r.correct ? 1 : 0;
    existing.cost += r.cost;
    existing.time += r.durationMs;
    modelScores.set(key, existing);
  }

  const ranked = [...modelScores.entries()]
    .map(([label, s]) => ({
      label,
      avg: s.total / s.count,
      correct: s.correct,
      total: s.count,
      cost: s.cost,
      time: s.time,
    }))
    .sort((a, b) => b.avg - a.avg || b.correct - a.correct);

  const mw = Math.max(50, ...ranked.map(r => r.label.length + 2));

  console.log('\n\n🏁 REASONING EVAL — FINAL RANKINGS');
  console.log('═'.repeat(120));
  console.log(
    `${'Model'.padEnd(mw)} ${'Avg Q'.padEnd(8)} ${'Correct'.padEnd(10)} ${'Cost'.padEnd(12)} ${'Time'.padEnd(10)}`
  );
  console.log('─'.repeat(120));

  for (const r of ranked) {
    const icon = r.avg >= 4 ? '🥇' : r.avg >= 3 ? '🥈' : r.avg >= 2 ? '🥉' : '💀';
    console.log(
      `${icon} ${r.label.padEnd(mw - 2)} ${r.avg.toFixed(1).padEnd(8)} ${`${r.correct}/${r.total}`.padEnd(10)} ${`$${r.cost.toFixed(4)}`.padEnd(12)} ${`${(r.time / 1000).toFixed(1)}s`.padEnd(10)}`
    );
  }

  // Per-puzzle breakdown
  console.log('\n\n📊 PER-PUZZLE BREAKDOWN');
  for (const puzzle of ALL_PUZZLES) {
    const puzzleResults = allResults.filter(r => r.puzzleId === puzzle.id);
    const passed = puzzleResults.filter(r => r.correct).length;
    console.log(`\n  ${puzzle.name}: ${passed}/${puzzleResults.length} passed`);
    for (const r of puzzleResults.sort((a, b) => b.reasoningQuality - a.reasoningQuality)) {
      const label = `${r.provider}:${r.model}${r.reasoningEffort ? `[${r.reasoningEffort}]` : ''}`;
      const icon = r.reasoningQuality >= 4 ? '✅' : r.reasoningQuality >= 3 ? '⚠️' : '❌';
      console.log(`    ${icon} ${label.padEnd(mw - 4)} ${r.reasoningQuality}/5`);
    }
  }

  const totalCost = allResults.reduce((s, r) => s + r.cost, 0);
  console.log(`\n💰 Total cost: $${totalCost.toFixed(4)}`);
  console.log(`📁 Results: ${runDir}`);
  console.log('\n🎉 Reasoning eval complete!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
