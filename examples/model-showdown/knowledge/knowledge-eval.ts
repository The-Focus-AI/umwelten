#!/usr/bin/env node
/**
 * World Knowledge Eval — Factual recall with LLM judge scoring
 *
 * Tests 30 questions across 6 categories. Uses Claude Haiku as judge
 * to evaluate correctness — handles format variations, alternative names,
 * and different notations that regex can't.
 *
 * Scoring: 1 point per correct answer, /30 total per model.
 *
 * Usage:
 *   pnpm tsx examples/model-showdown/knowledge/knowledge-eval.ts               # quick (3 models)
 *   pnpm tsx examples/model-showdown/knowledge/knowledge-eval.ts --all          # full showdown
 *   pnpm tsx examples/model-showdown/knowledge/knowledge-eval.ts --all --new    # fresh run
 */

import '../shared/env.js';
import fs from 'fs';
import path from 'path';
import { Stimulus } from '../../../src/stimulus/stimulus.js';
import { SimpleEvaluation } from '../../../src/evaluation/strategies/simple-evaluation.js';
import { EvaluationCache } from '../../../src/evaluation/caching/cache-service.js';
import { clearAllRateLimitStates } from '../../../src/rate-limit/rate-limit.js';
import type { ModelDetails } from '../../../src/cognition/types.js';
import { SHOWDOWN_MODELS, LOCAL_TEST_MODELS, modelLabel, modelKey } from '../shared/models.js';
import { resolveRun, isFullRun } from '../shared/runner-utils.js';
import { JUDGE_MODEL, judgeResponse } from '../shared/judge.js';
import { ALL_QUESTIONS, CATEGORIES, knowledgeJudgeSchema, knowledgeJudgeInstructions } from './questions.js';

// ── Types ───────────────────────────────────────────────────────────────────

interface KnowledgeResult {
  questionId: string;
  category: string;
  difficulty: number;
  model: string;
  provider: string;
  responseText: string;
  correct: boolean;
  correctAnswer: string;
  judgeExplanation: string;
  judgeScore: number;
  durationMs: number;
  cost: number;
  error?: string;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const models = isFullRun() ? SHOWDOWN_MODELS : LOCAL_TEST_MODELS;
  const { runId, runDir, isResume } = resolveRun('model-showdown-knowledge');

  console.log('🧠 World Knowledge Eval — Model Showdown');
  console.log('═'.repeat(70));
  console.log(`Questions:  ${ALL_QUESTIONS.length} across ${CATEGORIES.length} categories`);
  console.log(`Categories: ${CATEGORIES.join(', ')}`);
  console.log(`Models:     ${models.length}`);
  console.log(`Judge:      ${modelLabel(JUDGE_MODEL)}`);
  console.log(`Run:        #${runId}${isResume ? ' (resuming)' : ''}`);
  console.log('═'.repeat(70));
  console.log();

  const allResults: KnowledgeResult[] = [];

  // Process questions in batches by category for cleaner output
  for (const category of CATEGORIES) {
    const categoryQuestions = ALL_QUESTIONS.filter(q => q.category === category);
    console.log(`\n📂 ${category} (${categoryQuestions.length} questions)`);

    for (const question of categoryQuestions) {
      console.log(`\n   ❓ ${question.question.slice(0, 70)}...`);

      const stimulus = new Stimulus({
        role: 'knowledgeable assistant',
        objective: 'answer factual questions accurately and concisely',
        instructions: [
          'Give a direct, concise answer to the question',
          'Follow the format instructions in the question exactly',
          'Do not add explanations, caveats, or extra text unless specifically asked',
          'If unsure, give your best answer — do not say "I don\'t know"',
        ],
        temperature: 0.0,
        maxTokens: 300,
        runnerType: 'base',
      });

      const cache = new EvaluationCache(
        `model-showdown-knowledge/runs/${runId}/${question.id}`,
        { verbose: false }
      );

      const evaluation = new SimpleEvaluation(
        stimulus,
        models,
        question.question,
        cache,
        {
          evaluationId: `knowledge-${question.id}-${runId}`,
          useCache: true,
          concurrent: true,
          maxConcurrency: 10,
          showProgress: false,
        },
      );

      console.log('   📡 Getting model responses...');
      const evalResults = await evaluation.run();

      // ── Judge each response ─────────────────────────────────────────────
      clearAllRateLimitStates();
      console.log(`   ⚖️  Judging with ${modelLabel(JUDGE_MODEL)}...`);

      const resultsDir = path.join(runDir, question.id);
      fs.mkdirSync(resultsDir, { recursive: true });

      for (const result of evalResults) {
        const label = modelLabel(result.model);
        const mk = modelKey(result.model);
        const resultPath = path.join(resultsDir, `${mk}.json`);

        // Cache hit — check for judged results
        if (fs.existsSync(resultPath) && !process.argv.includes('--new')) {
          const cached = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as KnowledgeResult;
          // Only use cache if it has judge data (not old regex results)
          if (cached.judgeExplanation !== undefined) {
            allResults.push(cached);
            const icon = cached.correct ? '✅' : '❌';
            console.log(`   ${icon} ${label} → ${cached.correct ? 'correct' : 'wrong'} (cached)`);
            continue;
          }
        }

        const responseText = typeof result.response.content === 'string'
          ? result.response.content
          : JSON.stringify(result.response.content);

        let correct = false;
        let judgeExplanation = 'empty response';
        let judgeScore = 0;

        if (responseText && !result.metadata.error) {
          try {
            const judgeInstructions = knowledgeJudgeInstructions(question);
            const judgeResult = await judgeResponse(
              JUDGE_MODEL,
              judgeInstructions,
              responseText,
              knowledgeJudgeSchema,
            );
            correct = judgeResult.correct || judgeResult.score >= 0.75;
            judgeExplanation = judgeResult.explanation;
            judgeScore = judgeResult.score;
          } catch (err) {
            judgeExplanation = `Judge error: ${(err as Error).message.slice(0, 100)}`;
            judgeScore = 0;
          }
        }

        const r: KnowledgeResult = {
          questionId: question.id,
          category: question.category,
          difficulty: question.difficulty,
          model: result.model.name,
          provider: result.model.provider,
          responseText: (responseText || '').slice(0, 500),
          correct,
          correctAnswer: question.correctAnswer,
          judgeExplanation,
          judgeScore,
          durationMs: result.metadata.duration,
          cost: result.response.metadata.cost?.totalCost || 0,
          error: result.metadata.error,
        };
        allResults.push(r);
        fs.writeFileSync(resultPath, JSON.stringify(r, null, 2));

        const icon = correct ? '✅' : '❌';
        console.log(`   ${icon} ${label} → ${correct ? 'correct' : 'wrong'} — ${judgeExplanation.slice(0, 60)}`);
      }

      // Print summary for this question
      const qResults = allResults.filter(r => r.questionId === question.id);
      const correctCount = qResults.filter(r => r.correct).length;
      const icon = correctCount === qResults.length ? '✅' : correctCount > qResults.length / 2 ? '⚠️' : '❌';
      console.log(`   ${icon} ${correctCount}/${qResults.length} models correct (answer: ${question.correctAnswer})`);
    }
  }

  // ── Print results ───────────────────────────────────────────────────────

  printResults(allResults, models);
}

function printResults(allResults: KnowledgeResult[], models: ModelDetails[]) {
  const totalQ = ALL_QUESTIONS.length;

  // Aggregate by model
  const modelScores = new Map<string, {
    correct: number; total: number; cost: number; time: number;
    byCategory: Map<string, { correct: number; total: number }>;
    byDifficulty: Map<number, { correct: number; total: number }>;
  }>();

  for (const r of allResults) {
    const key = `${r.provider}:${r.model}`;
    const existing = modelScores.get(key) || {
      correct: 0, total: 0, cost: 0, time: 0,
      byCategory: new Map(), byDifficulty: new Map(),
    };
    existing.total++;
    if (r.correct) existing.correct++;
    existing.cost += r.cost;
    existing.time += r.durationMs;

    const cat = existing.byCategory.get(r.category) || { correct: 0, total: 0 };
    cat.total++;
    if (r.correct) cat.correct++;
    existing.byCategory.set(r.category, cat);

    const diff = existing.byDifficulty.get(r.difficulty) || { correct: 0, total: 0 };
    diff.total++;
    if (r.correct) diff.correct++;
    existing.byDifficulty.set(r.difficulty, diff);

    modelScores.set(key, existing);
  }

  const ranked = [...modelScores.entries()]
    .map(([label, s]) => ({ label, ...s }))
    .sort((a, b) => b.correct - a.correct || a.cost - b.cost);

  const mw = Math.max(50, ...ranked.map(r => r.label.length + 2));

  // ── Overall rankings ──────────────────────────────────────────────

  console.log('\n\n🏁 KNOWLEDGE EVAL — FINAL RANKINGS');
  console.log('═'.repeat(120));

  const catHeaders = CATEGORIES.map(c => c.slice(0, 5).padEnd(6)).join(' ');
  console.log(
    `${'Model'.padEnd(mw)} ${'Score'.padEnd(12)} ${catHeaders} ${'D1'.padEnd(4)} ${'D2'.padEnd(4)} ${'D3'.padEnd(4)} ${'Cost'.padEnd(10)} ${'Time'.padEnd(8)}`
  );
  console.log('─'.repeat(120));

  for (const r of ranked) {
    const pct = Math.round((r.correct / r.total) * 100);
    const icon = pct >= 90 ? '🥇' : pct >= 75 ? '🥈' : pct >= 60 ? '🥉' : '💀';

    const catScores = CATEGORIES.map(c => {
      const s = r.byCategory.get(c);
      return s ? `${s.correct}/${s.total}`.padEnd(6) : '—'.padEnd(6);
    }).join(' ');

    const diffScores = [1, 2, 3].map(d => {
      const s = r.byDifficulty.get(d);
      return s ? `${s.correct}/${s.total}`.padEnd(4) : '—'.padEnd(4);
    }).join(' ');

    console.log(
      `${icon} ${r.label.padEnd(mw - 2)} ${`${r.correct}/${r.total} (${pct}%)`.padEnd(12)} ${catScores} ${diffScores} ${`$${r.cost.toFixed(4)}`.padEnd(10)} ${`${(r.time / 1000).toFixed(1)}s`.padEnd(8)}`
    );
  }

  // ── Nemotron comparison ───────────────────────────────────────────

  console.log('\n\n🔬 NEMOTRON DEEP DIVE — Provider Comparison');
  console.log('─'.repeat(80));
  const nemotronModels = ranked.filter(r =>
    r.label.toLowerCase().includes('nemotron') || r.label.toLowerCase().includes('nvidia')
  );
  for (const r of nemotronModels) {
    const pct = Math.round((r.correct / r.total) * 100);
    console.log(`  ${r.label.padEnd(55)} ${r.correct}/${r.total} (${pct}%)`);
  }

  // ── Per-question difficulty analysis ──────────────────────────────

  console.log('\n\n📊 HARDEST QUESTIONS (most models wrong)');
  console.log('─'.repeat(80));
  const questionStats = ALL_QUESTIONS.map(q => {
    const qResults = allResults.filter(r => r.questionId === q.id);
    const correctCount = qResults.filter(r => r.correct).length;
    return { ...q, correctCount, total: qResults.length };
  }).sort((a, b) => a.correctCount - b.correctCount);

  for (const q of questionStats.slice(0, 10)) {
    const pct = Math.round((q.correctCount / q.total) * 100);
    console.log(`  ${pct}% correct — [${q.category}] ${q.question.slice(0, 60)}...`);
    console.log(`    Answer: ${q.correctAnswer}`);
  }

  const totalCost = allResults.reduce((s, r) => s + r.cost, 0);
  console.log(`\n💰 Total cost: $${totalCost.toFixed(4)}`);
  console.log('\n🎉 Knowledge eval complete!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
