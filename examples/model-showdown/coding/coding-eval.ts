#!/usr/bin/env node
/**
 * Coding Eval — Multi-language code generation + Dagger execution + deterministic verification
 *
 * Tests 6 challenges × 3 languages (TypeScript, Python, Go) = 18 tasks per model.
 * Code is extracted from model responses, executed in Dagger containers,
 * and stdout is verified deterministically.
 *
 * Scoring: compile(1) + runs(1) + output correctness(0-5) = /7 per task
 * Max score per model: 18 × 7 = /126
 *
 * Usage:
 *   pnpm tsx examples/model-showdown/coding/coding-eval.ts               # quick (3 models)
 *   pnpm tsx examples/model-showdown/coding/coding-eval.ts --all          # full showdown
 *   pnpm tsx examples/model-showdown/coding/coding-eval.ts --all --new    # fresh run
 *   pnpm tsx examples/model-showdown/coding/coding-eval.ts --lang ts      # TypeScript only
 *   pnpm tsx examples/model-showdown/coding/coding-eval.ts --lang py      # Python only
 *   pnpm tsx examples/model-showdown/coding/coding-eval.ts --lang go      # Go only
 *   pnpm tsx examples/model-showdown/coding/coding-eval.ts --no-dagger    # use local exec (no containers)
 */

import '../shared/env.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { Stimulus } from '../../../src/stimulus/stimulus.js';
import { SimpleEvaluation } from '../../../src/evaluation/strategies/simple-evaluation.js';
import { EvaluationCache } from '../../../src/evaluation/caching/cache-service.js';
import type { ModelDetails } from '../../../src/cognition/types.js';
import { SHOWDOWN_MODELS, LOCAL_TEST_MODELS, modelLabel, modelKey } from '../shared/models.js';
import { resolveRun, isFullRun } from '../shared/runner-utils.js';
import { ALL_CHALLENGES, ALL_LANGUAGES, type Language, type CodingChallenge } from './challenges.js';

// ── Configuration ───────────────────────────────────────────────────────────

const useDagger = !process.argv.includes('--no-dagger');
const langFilter = (() => {
  const idx = process.argv.indexOf('--lang');
  if (idx === -1) return null;
  const val = process.argv[idx + 1];
  const map: Record<string, Language> = { ts: 'typescript', py: 'python', go: 'go', typescript: 'typescript', python: 'python' };
  return map[val] || null;
})();
const languages = langFilter ? [langFilter] : ALL_LANGUAGES;

// ── Code extraction ─────────────────────────────────────────────────────────

const LANG_FENCE_NAMES: Record<Language, string[]> = {
  typescript: ['typescript', 'ts'],
  python: ['python', 'py'],
  go: ['go', 'golang'],
};

function extractCode(response: string, lang: Language): string | null {
  // Try language-specific fence first
  for (const fence of LANG_FENCE_NAMES[lang]) {
    const match = response.match(new RegExp(`\`\`\`${fence}\\s*\\n([\\s\\S]*?)\`\`\``));
    if (match) return match[1].trim();
  }
  // Try generic code block
  const generic = response.match(/```\s*\n([\s\S]*?)```/);
  if (generic) return generic[1].trim();
  // Try raw code detection
  const markers: Record<Language, string[]> = {
    typescript: ['console.log', 'function '],
    python: ['print(', 'def '],
    go: ['package main', 'func main'],
  };
  if (markers[lang].some(m => response.includes(m))) return response.trim();
  return null;
}

// ── Execution backends ──────────────────────────────────────────────────────

/** Execute code locally (fast, no container) */
function executeLocal(code: string, lang: Language, timeoutMs = 15000): { stdout: string; stderr: string; exitCode: number } {
  const tmpDir = path.join(process.cwd(), 'output', '.tmp-code');
  fs.mkdirSync(tmpDir, { recursive: true });
  const ext = { typescript: '.ts', python: '.py', go: '.go' }[lang];
  const tmpFile = path.join(tmpDir, `code-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);

  try {
    fs.writeFileSync(tmpFile, code);
    const cmd = {
      typescript: `npx tsx "${tmpFile}"`,
      python: `python3 "${tmpFile}"`,
      go: `go run "${tmpFile}"`,
    }[lang];

    const stdout = execSync(cmd, {
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
    });
    return { stdout: stdout || '', stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || err.message || '',
      exitCode: err.status || 1,
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

/** Execute code in Dagger container */
async function executeDagger(code: string, lang: Language, timeout = 30): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { DaggerRunner } = await import('../../../src/evaluation/dagger-runner.js');
    const result = await DaggerRunner.runCode({
      code,
      language: lang,
      timeout,
    });
    return {
      stdout: result.output || '',
      stderr: result.error || '',
      exitCode: result.exitCode ?? (result.success ? 0 : 1),
    };
  } catch (err: any) {
    return {
      stdout: '',
      stderr: err.message || String(err),
      exitCode: 1,
    };
  }
}

async function executeCode(code: string, lang: Language): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (useDagger) {
    return executeDagger(code, lang);
  }
  return executeLocal(code, lang);
}

// ── Types ───────────────────────────────────────────────────────────────────

interface CodingResult {
  challengeId: string;
  language: Language;
  model: string;
  provider: string;
  responseText: string;
  extractedCode: string | null;
  compiled: boolean;
  ran: boolean;
  stdout: string;
  stderr: string;
  verifyScore: number;
  verifyDetails: string;
  totalScore: number;  // compile(1) + runs(1) + verify(0-5) = /7
  durationMs: number;
  cost: number;
  error?: string;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const models = isFullRun() ? SHOWDOWN_MODELS : LOCAL_TEST_MODELS;
  const { runId, runDir, isResume } = resolveRun('model-showdown-coding');

  const totalTasks = ALL_CHALLENGES.length * languages.length;
  const maxPerModel = totalTasks * 7;

  console.log('💻 Coding Eval — Model Showdown');
  console.log('═'.repeat(70));
  console.log(`Challenges: ${ALL_CHALLENGES.length} (${ALL_CHALLENGES.map(c => c.name).join(', ')})`);
  console.log(`Languages:  ${languages.join(', ')}`);
  console.log(`Tasks:      ${totalTasks} per model (${ALL_CHALLENGES.length} challenges × ${languages.length} languages)`);
  console.log(`Models:     ${models.length}`);
  console.log(`Execution:  ${useDagger ? 'Dagger containers' : 'Local (no containers)'}`);
  console.log(`Max score:  ${maxPerModel} per model`);
  console.log(`Run:        #${runId}${isResume ? ' (resuming)' : ''}`);
  console.log('═'.repeat(70));
  console.log();

  const allResults: CodingResult[] = [];

  for (const challenge of ALL_CHALLENGES) {
    for (const lang of languages) {
      const taskId = `${challenge.id}-${lang}`;
      console.log(`\n📝 ${challenge.name} [${lang.toUpperCase()}]`);

      // ── Step 1: Get model responses ─────────────────────────────────

      const stimulus = new Stimulus({
        role: `expert ${lang} programmer`,
        objective: `write correct, working ${lang} code that solves the given problem`,
        instructions: [
          `Write a complete, self-contained ${lang} program`,
          'Do NOT use any external dependencies — standard library only',
          `Wrap your code in a \`\`\`${lang} code block`,
          'The code must print output to stdout',
          'Make sure the code is correct and handles edge cases',
          'Print ONLY the requested output — no extra text, labels, or explanations in the output',
        ],
        temperature: 0.2,
        maxTokens: 3000,
        runnerType: 'base',
      });

      const cache = new EvaluationCache(
        `model-showdown-coding/runs/${runId}/${taskId}`,
        { verbose: false }
      );

      const evaluation = new SimpleEvaluation(
        stimulus,
        models,
        challenge.prompt(lang),
        cache,
        {
          evaluationId: `coding-${taskId}-${runId}`,
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

      // Per-model timeout (25 min) — run sequentially to avoid batch blocking
      const PER_MODEL_TIMEOUT_MS = 25 * 60 * 1000;
      const evalResults: Awaited<ReturnType<typeof evaluation.run>> = [];

      for (const model of models) {
        const mk = modelKey(model);
        const resultPath = path.join(runDir, taskId, 'results', `${mk}.json`);

        // Skip if we already have a valid (non-error) result
        if (fs.existsSync(resultPath) && !process.argv.includes('--new')) {
          try {
            const cached = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
            if (!cached.error && cached.totalScore > 0) {
              console.log(`   ⏭️  ${modelLabel(model)} → ${cached.totalScore}/7 (cached)`);
              continue;
            }
            // Has error or zero score — delete and retry
            fs.unlinkSync(resultPath);
            console.log(`   🔄 ${modelLabel(model)} — retrying (was: ${cached.error || 'score 0'})`);
          } catch {}
        }

        // Check if response is already cached (even without a result file)
        const singleCache = new EvaluationCache(
          `model-showdown-coding/runs/${runId}/${taskId}`,
          { verbose: false }
        );
        const singleEval = new SimpleEvaluation(
          stimulus,
          [model],
          challenge.prompt(lang),
          singleCache,
          {
            evaluationId: `coding-${taskId}-${runId}`,
            useCache: true,
            concurrent: false,
            showProgress: true,
          },
          (progress) => {
            if (progress.status === 'completed') {
              console.log(`   ✅ ${progress.modelName}`);
            } else if (progress.status === 'error') {
              console.log(`   ❌ ${progress.modelName}: ${progress.error}`);
            }
          }
        );

        try {
          const modelResults = await Promise.race([
            singleEval.run(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`${modelLabel(model)} timed out after 10 minutes`)), PER_MODEL_TIMEOUT_MS)
            ),
          ]);
          evalResults.push(...modelResults);
        } catch (err: any) {
          console.log(`   ⏱️  ${err.message}`);
        }
      }

      console.log(`\n   ✅ Got ${evalResults.length} responses\n`);

      // ── Step 2: Extract, execute, verify ────────────────────────────

      const resultsDir = path.join(runDir, taskId, 'results');
      fs.mkdirSync(resultsDir, { recursive: true });

      console.log(`   🔧 Extracting and executing ${lang} code...\n`);

      for (const result of evalResults) {
        const label = modelLabel(result.model);
        const mk = modelKey(result.model);
        const resultPath = path.join(resultsDir, `${mk}.json`);

        // Cache hit
        if (fs.existsSync(resultPath) && !process.argv.includes('--new')) {
          const cached = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as CodingResult;
          allResults.push(cached);
          const icon = cached.totalScore >= 5 ? '✅' : cached.totalScore >= 3 ? '⚠️' : '❌';
          console.log(`   ${icon} ${label} → ${cached.totalScore}/7 (cached)`);
          continue;
        }

        const responseText = typeof result.response.content === 'string'
          ? result.response.content
          : JSON.stringify(result.response.content);

        if (!responseText || result.metadata.error) {
          const r: CodingResult = {
            challengeId: challenge.id, language: lang,
            model: result.model.name, provider: result.model.provider,
            responseText: '', extractedCode: null,
            compiled: false, ran: false, stdout: '', stderr: '',
            verifyScore: 0, verifyDetails: result.metadata.error || 'empty response',
            totalScore: 0, durationMs: result.metadata.duration,
            cost: result.response.metadata.cost?.totalCost || 0,
            error: result.metadata.error,
          };
          allResults.push(r);
          fs.writeFileSync(resultPath, JSON.stringify(r, null, 2));
          console.log(`   ❌ ${label} → 0/7 (${r.verifyDetails})`);
          continue;
        }

        const code = extractCode(responseText, lang);
        if (!code) {
          const r: CodingResult = {
            challengeId: challenge.id, language: lang,
            model: result.model.name, provider: result.model.provider,
            responseText, extractedCode: null,
            compiled: false, ran: false, stdout: '', stderr: '',
            verifyScore: 0, verifyDetails: 'Could not extract code from response',
            totalScore: 0, durationMs: result.metadata.duration,
            cost: result.response.metadata.cost?.totalCost || 0,
          };
          allResults.push(r);
          fs.writeFileSync(resultPath, JSON.stringify(r, null, 2));
          console.log(`   ❌ ${label} → 0/7 (no code found)`);
          continue;
        }

        // Execute
        const { stdout, stderr, exitCode } = await executeCode(code, lang);
        const compiled = exitCode === 0 || stdout.length > 0;
        const ran = exitCode === 0;

        // Verify output
        const verification = ran
          ? challenge.verify(stdout)
          : { pass: false, score: 0, details: `Exit code ${exitCode}: ${stderr.slice(0, 100)}` };

        const totalScore = (compiled ? 1 : 0) + (ran ? 1 : 0) + verification.score;

        const r: CodingResult = {
          challengeId: challenge.id, language: lang,
          model: result.model.name, provider: result.model.provider,
          responseText, extractedCode: code,
          compiled, ran,
          stdout: stdout.slice(0, 2000), stderr: stderr.slice(0, 500),
          verifyScore: verification.score, verifyDetails: verification.details,
          totalScore, durationMs: result.metadata.duration,
          cost: result.response.metadata.cost?.totalCost || 0,
        };
        allResults.push(r);
        fs.writeFileSync(resultPath, JSON.stringify(r, null, 2));

        const icon = totalScore >= 5 ? '✅' : totalScore >= 3 ? '⚠️' : '❌';
        console.log(`   ${icon} ${label} → ${totalScore}/7 (compile:${compiled ? '✓' : '✗'} run:${ran ? '✓' : '✗'} output:${verification.score}/5) ${verification.details.slice(0, 60)}`);
      }
    }
  }

  // ── Step 3: Print combined results ──────────────────────────────────

  printResults(allResults, models.length);
}

function printResults(allResults: CodingResult[], modelCount: number) {
  const totalTasks = ALL_CHALLENGES.length * languages.length;
  const maxPerModel = totalTasks * 7;

  // Aggregate by model
  const modelScores = new Map<string, { total: number; max: number; cost: number; time: number; byLang: Map<string, number>; byChallenge: Map<string, number> }>();

  for (const r of allResults) {
    const key = `${r.provider}:${r.model}`;
    const existing = modelScores.get(key) || {
      total: 0, max: 0, cost: 0, time: 0,
      byLang: new Map<string, number>(),
      byChallenge: new Map<string, number>(),
    };
    existing.total += r.totalScore;
    existing.max += 7;
    existing.cost += r.cost;
    existing.time += r.durationMs;
    existing.byLang.set(r.language, (existing.byLang.get(r.language) || 0) + r.totalScore);
    existing.byChallenge.set(r.challengeId, (existing.byChallenge.get(r.challengeId) || 0) + r.totalScore);
    modelScores.set(key, existing);
  }

  const ranked = [...modelScores.entries()]
    .map(([label, s]) => ({ label, ...s }))
    .sort((a, b) => b.total - a.total || a.cost - b.cost);

  const mw = Math.max(50, ...ranked.map(r => r.label.length + 2));

  // ── Overall rankings ──────────────────────────────────────────────

  console.log('\n\n🏁 CODING EVAL — FINAL RANKINGS');
  console.log('═'.repeat(110));

  const langHeaders = languages.map(l => l.slice(0, 2).toUpperCase().padEnd(6)).join(' ');
  console.log(
    `${'Model'.padEnd(mw)} ${'Total'.padEnd(12)} ${langHeaders} ${'Cost'.padEnd(10)} ${'Time'.padEnd(8)}`
  );
  console.log('─'.repeat(110));

  const maxLangScore = ALL_CHALLENGES.length * 7;
  for (const r of ranked) {
    const pct = Math.round((r.total / r.max) * 100);
    const icon = pct >= 80 ? '🥇' : pct >= 60 ? '🥈' : pct >= 40 ? '🥉' : '💀';
    const langScores = languages.map(l => {
      const s = r.byLang.get(l) || 0;
      return `${s}/${maxLangScore}`.padEnd(6);
    }).join(' ');

    console.log(
      `${icon} ${r.label.padEnd(mw - 2)} ${`${r.total}/${r.max} (${pct}%)`.padEnd(12)} ${langScores} ${`$${r.cost.toFixed(4)}`.padEnd(10)} ${`${(r.time / 1000).toFixed(1)}s`.padEnd(8)}`
    );
  }

  // ── Per-language breakdown ────────────────────────────────────────

  console.log('\n\n📊 PER-LANGUAGE BREAKDOWN');
  for (const lang of languages) {
    const langResults = allResults.filter(r => r.language === lang);
    const perfect = langResults.filter(r => r.totalScore === 7).length;
    const total = langResults.length;
    console.log(`\n  ${lang.toUpperCase()}: ${perfect}/${total} perfect scores`);

    // Per-challenge within language
    for (const challenge of ALL_CHALLENGES) {
      const challengeResults = langResults.filter(r => r.challengeId === challenge.id);
      const cp = challengeResults.filter(r => r.totalScore === 7).length;
      console.log(`    ${challenge.name}: ${cp}/${challengeResults.length} perfect`);
      for (const r of challengeResults.sort((a, b) => b.totalScore - a.totalScore)) {
        const icon = r.totalScore >= 5 ? '✅' : r.totalScore >= 3 ? '⚠️' : '❌';
        console.log(`      ${icon} ${`${r.provider}:${r.model}`.padEnd(mw - 6)} ${r.totalScore}/7  ${r.verifyDetails.slice(0, 50)}`);
      }
    }
  }

  // ── Per-challenge breakdown (across all languages) ────────────────

  console.log('\n\n📊 PER-CHALLENGE BREAKDOWN (all languages)');
  for (const challenge of ALL_CHALLENGES) {
    const cr = allResults.filter(r => r.challengeId === challenge.id);
    const perfect = cr.filter(r => r.totalScore === 7).length;
    console.log(`\n  ${challenge.name}: ${perfect}/${cr.length} perfect`);
  }

  const totalCost = allResults.reduce((s, r) => s + r.cost, 0);
  console.log(`\n💰 Total cost: $${totalCost.toFixed(4)}`);
  console.log(`📁 Results: output/evaluations/model-showdown-coding/`);
  console.log('\n🎉 Coding eval complete!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
