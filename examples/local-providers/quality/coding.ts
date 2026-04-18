#!/usr/bin/env node
/**
 * Local-Providers Coding (Tier 1: Write from Spec)
 *
 * Reuses model-showdown's 6 coding challenges × 3 languages. Code is
 * extracted, executed locally or in Dagger, stdout is verified.
 *
 * The separate coding-bugfix.ts and coding-repo.ts files test the other
 * two tiers (fix-the-bug and edit-the-repo with file tools).
 *
 * Scoring: compile(1) + runs(1) + output correctness(0-5) = /7 per task
 * 6 challenges × 3 languages = 18 tasks per model × 7 = 126 max
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/local-providers/quality/coding.ts
 *   dotenvx run -- pnpm tsx examples/local-providers/quality/coding.ts --frontier --lang ts
 */

import '../../model-showdown/shared/env.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { EvalSuite } from '../../../src/evaluation/suite.ts';
import { ALL_CHALLENGES, ALL_LANGUAGES, type Language } from '../../model-showdown/coding/challenges.js';
import { LOCAL_MODELS, ALL_MODELS, includeFrontier } from '../shared/models.js';

// ── Lang filter ──────────────────────────────────────────────────────────────

const langFilter: Language | null = (() => {
  const idx = process.argv.indexOf('--lang');
  if (idx === -1) return null;
  const val = process.argv[idx + 1];
  const map: Record<string, Language> = { ts: 'typescript', py: 'python', go: 'go', typescript: 'typescript', python: 'python' };
  return map[val] ?? null;
})();
const languages: Language[] = langFilter ? [langFilter] : ALL_LANGUAGES;

// ── Code extraction ──────────────────────────────────────────────────────────

const LANG_FENCE_NAMES: Record<Language, string[]> = {
  typescript: ['typescript', 'ts'],
  python: ['python', 'py'],
  go: ['go', 'golang'],
};

function extractCode(response: string, lang: Language): string | null {
  for (const fence of LANG_FENCE_NAMES[lang]) {
    const match = response.match(new RegExp(`\`\`\`${fence}\\s*\\n([\\s\\S]*?)\`\`\``));
    if (match) return match[1].trim();
  }
  const generic = response.match(/```\s*\n([\s\S]*?)```/);
  if (generic) return generic[1].trim();
  return null;
}

// ── Local execution (no Dagger, keeps local-providers self-contained) ───────

function executeLocal(code: string, lang: Language, timeoutMs = 15000): { stdout: string; stderr: string; exitCode: number } {
  const tmpDir = path.join(process.cwd(), 'output', '.tmp-code');
  fs.mkdirSync(tmpDir, { recursive: true });
  const ext = { typescript: '.ts', python: '.py', go: '.go' }[lang];
  const tmpFile = path.join(tmpDir, `code-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  fs.writeFileSync(tmpFile, code);

  const cmd = {
    typescript: `npx --yes -p typescript -p tsx tsx "${tmpFile}"`,
    python: `python3 "${tmpFile}"`,
    go: `go run "${tmpFile}"`,
  }[lang];

  try {
    const stdout = execSync(cmd, { timeout: timeoutMs, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? err.message ?? '',
      exitCode: err.status ?? 1,
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ── Build EvalSuite tasks ────────────────────────────────────────────────────

interface CodingTask {
  id: string;
  name: string;
  prompt: string;
  maxScore: number;
  verify: (response: string) => { score: number; details: string };
}

const tasks: CodingTask[] = [];
for (const lang of languages) {
  for (const challenge of ALL_CHALLENGES) {
    tasks.push({
      id: `${challenge.id}-${lang}`,
      name: `${challenge.name} (${lang})`,
      prompt: challenge.prompt(lang),
      maxScore: 7,
      verify: (response: string) => {
        const code = extractCode(response, lang);
        if (!code) return { score: 0, details: 'no code block extracted' };
        const exec = executeLocal(code, lang);
        if (exec.exitCode !== 0) {
          return { score: 1, details: `runtime error: ${exec.stderr.slice(0, 120)}` };
        }
        const v = challenge.verify(exec.stdout);
        // compile(1) + runs(1) + correctness(0-5)
        return { score: 1 + 1 + v.score, details: v.details };
      },
    });
  }
}

const models = includeFrontier() ? ALL_MODELS : LOCAL_MODELS;

const suite = new EvalSuite({
  name: 'local-providers-coding',
  stimulus: {
    role: 'expert programmer',
    objective: 'write correct, self-contained code that solves the problem',
    instructions: [
      'Write complete, working code',
      'No imports except the standard library',
      'Wrap code in a language-tagged markdown fence',
      'Do not include explanation outside the code block',
    ],
    temperature: 0.2,
    maxTokens: 2000,
    runnerType: 'base',
  },
  tasks,
  models,
  allModels: models,
  concurrency: 2, // local runtimes can only handle one prompt at a time usefully
});

suite.run().catch(err => { console.error(err); process.exit(1); });
