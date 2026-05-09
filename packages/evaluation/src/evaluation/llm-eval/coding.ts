/**
 * Coding eval — write-from-spec (3 langs) + bugfix, against a single model.
 *
 * Composes the model-showdown coding challenges (TypeScript / Python /
 * Go, each scored compile+runs+correctness) and the JS bugfix tasks
 * (off-by-one, emoji reverse, depth-limited flatten, date-parse,
 * debounce). Each task is tagged with `section: 'coding-generation' |
 * 'coding-bugfix'` so reports can compute sub-scores.
 *
 * Provider-agnostic: takes a single ModelDetails. The execution
 * helpers (running TS/PY/GO/JS in subprocess) are unchanged from the
 * local-providers version — they only run the model's *output*, not
 * the model itself, so they're safe in the provider-agnostic layer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { EvalSuite, type EvalTask } from '../suite.js';
import type { ModelDetails } from '@umwelten/core/cognition/types.js';
import {
  ALL_CHALLENGES,
  ALL_LANGUAGES,
  type Language,
} from './data/coding-challenges.js';

const SECTION_GENERATION = 'coding-generation';
const SECTION_BUGFIX = 'coding-bugfix';

// ── Generation: extract code, run it, score stdout ──────────────────────────

const LANG_FENCE_NAMES: Record<Language, string[]> = {
  typescript: ['typescript', 'ts'],
  python: ['python', 'py'],
  go: ['go', 'golang'],
};

function extractCode(response: string, lang: Language): string | null {
  for (const fence of LANG_FENCE_NAMES[lang]) {
    const match = response.match(
      new RegExp(`\`\`\`${fence}\\s*\\n([\\s\\S]*?)\`\`\``),
    );
    if (match) return match[1].trim();
  }
  const generic = response.match(/```\s*\n([\s\S]*?)```/);
  if (generic) return generic[1].trim();
  return null;
}

/**
 * Augment PATH and resolve GOROOT for runtimes we need. Some
 * environments (Claude Code's bash sandbox, Docker, CI) start without
 * mise's shim path, so `go` / `tsx` / `python3` aren't found despite
 * being installed. mise-installed Go binaries also expect GOROOT to
 * be set explicitly — the binary's baked-in GOROOT can be stale across
 * upgrades. We probe known locations, pick the highest installed go
 * version, and produce both an augmented PATH and the matching GOROOT.
 */
function pickLatestMiseDir(parent: string): string | undefined {
  try {
    const versions = fs
      .readdirSync(parent)
      .filter((d) => /^\d/.test(d) && /^[\d.]+$/.test(d))
      .filter((d) => {
        try {
          return fs.statSync(path.join(parent, d)).isDirectory();
        } catch {
          return false;
        }
      })
      // Sort by version components so 1.26.2 wins over 1.26
      .sort((a, b) => {
        const av = a.split('.').map(Number);
        const bv = b.split('.').map(Number);
        for (let i = 0; i < Math.max(av.length, bv.length); i++) {
          const d = (bv[i] ?? 0) - (av[i] ?? 0);
          if (d !== 0) return d;
        }
        return 0;
      });
    return versions[0];
  } catch {
    return undefined;
  }
}

function buildExecEnv(): { PATH: string; GOROOT?: string } {
  const home = process.env.HOME ?? '';
  const goParent = `${home}/.local/share/mise/installs/go`;
  const goVersion = pickLatestMiseDir(goParent);
  const goRoot = goVersion ? path.join(goParent, goVersion) : undefined;
  const goBin = goRoot ? path.join(goRoot, 'bin') : undefined;

  const candidates = [
    goBin,
    `${home}/.local/share/mise/shims`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ].filter((p): p is string => Boolean(p));

  const existing = (process.env.PATH ?? '').split(path.delimiter);
  const additions = candidates.filter(
    (p) => !existing.includes(p) && fs.existsSync(p),
  );
  return {
    PATH: [...additions, ...existing].join(path.delimiter),
    ...(goRoot && fs.existsSync(goRoot) ? { GOROOT: goRoot } : {}),
  };
}

const EXEC_ENV = buildExecEnv();

/**
 * Run a code blob through the appropriate interpreter/compiler.
 * Exported so 2-pass / replay drivers can re-execute a saved
 * round-1 response and capture the exact error to feed back into
 * round-2 generation.
 */
export function executeLocal(
  code: string,
  lang: Language,
  timeoutMs = 15000,
): { stdout: string; stderr: string; exitCode: number } {
  const tmpDir = path.join(process.cwd(), 'output', '.tmp-code');
  fs.mkdirSync(tmpDir, { recursive: true });
  const ext = { typescript: '.ts', python: '.py', go: '.go' }[lang];
  const tmpFile = path.join(
    tmpDir,
    `code-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`,
  );
  fs.writeFileSync(tmpFile, code);

  const cmd = {
    typescript: `npx --yes -p typescript -p tsx tsx "${tmpFile}"`,
    python: `python3 "${tmpFile}"`,
    go: `go run "${tmpFile}"`,
  }[lang];

  try {
    const stdout = execSync(cmd, {
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...EXEC_ENV },
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? err.message ?? '',
      exitCode: err.status ?? 1,
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* tmp file cleanup is best-effort */ }
  }
}

/**
 * Score one generation-task response. Pure function over (challenge,
 * lang, response) — used both inline by the suite and by 2-pass drivers
 * that re-score after a follow-up turn. Returns the verify result
 * plus the captured exec output so callers can build error-feedback
 * messages without having to extract+run the code a second time.
 */
export function verifyGenerationResponse(
  challenge: (typeof ALL_CHALLENGES)[number],
  lang: Language,
  response: string,
): {
  score: number;
  details: string;
  code: string | null;
  exec?: { stdout: string; stderr: string; exitCode: number };
} {
  const code = extractCode(response, lang);
  if (!code) {
    return { score: 0, details: 'no code block extracted', code: null };
  }
  const exec = executeLocal(code, lang);
  if (exec.exitCode !== 0) {
    return {
      score: 1,
      details: `runtime error: ${exec.stderr.slice(0, 120)}`,
      code,
      exec,
    };
  }
  const v = challenge.verify(exec.stdout);
  return { score: 1 + 1 + v.score, details: v.details, code, exec };
}

/**
 * Resolve a generation task id (e.g. `gen-fizzbuzz-boom-go`) to its
 * (challenge, language) pair. Returns null if the id doesn't match a
 * known generation task. Used by 2-pass drivers that operate on saved
 * task records and need to re-score them.
 */
export function lookupGenerationTask(
  taskId: string,
): { challenge: (typeof ALL_CHALLENGES)[number]; lang: Language } | null {
  const m = taskId.match(/^gen-(.+)-(typescript|python|go)$/);
  if (!m) return null;
  const [, challengeId, lang] = m;
  const challenge = ALL_CHALLENGES.find((c) => c.id === challengeId);
  if (!challenge) return null;
  return { challenge, lang: lang as Language };
}

function buildGenerationTasks(languages: Language[]): EvalTask[] {
  const tasks: EvalTask[] = [];
  for (const lang of languages) {
    for (const challenge of ALL_CHALLENGES) {
      tasks.push({
        id: `gen-${challenge.id}-${lang}`,
        name: `${challenge.name} (${lang})`,
        prompt: challenge.prompt(lang),
        maxScore: 7,
        section: SECTION_GENERATION,
        verify: (response: string) => {
          const r = verifyGenerationResponse(challenge, lang, response);
          return { score: r.score, details: r.details };
        },
      });
    }
  }
  return tasks;
}

// ── Bugfix: model returns a fixed JS function, we run a hidden harness ──────

interface BugFix {
  id: string;
  name: string;
  buggy: string;
  spec: string;
  harness: string;
  totalTests: number;
}

const BUGFIXES: BugFix[] = [
  {
    id: 'off-by-one',
    name: 'Off-by-one in range sum',
    buggy: `
function sumRange(start, end) {
  let total = 0;
  for (let i = start; i < end; i++) total += i;
  return total;
}
`.trim(),
    spec: `The function should return the sum of all integers from start through end INCLUSIVE.
Visible failing test:
  sumRange(1, 5) === 15   // currently returns 10
Return the corrected sumRange function. Nothing else.`,
    harness: `
const tests = [
  [[1, 5], 15],
  [[0, 10], 55],
  [[5, 5], 5],
  [[-3, 3], 0],
  [[1, 1], 1],
];
let passed = 0;
for (const [args, expected] of tests) {
  try {
    const got = sumRange(...args);
    if (got === expected) passed++;
    else console.error('fail', args, 'expected', expected, 'got', got);
  } catch (e) { console.error('err', args, e.message); }
}
console.log(JSON.stringify({ passed }));
`.trim(),
    totalTests: 5,
  },
  {
    id: 'string-reverse',
    name: 'Reverse emoji string',
    buggy: `
function reverseString(s) {
  return s.split('').reverse().join('');
}
`.trim(),
    spec: `The function should reverse a string while keeping multi-codepoint graphemes (like emoji) intact.
Visible failing test:
  reverseString('a👍b') === 'b👍a'   // currently returns 'b\\uDC4D\\uD83Dа' (broken surrogate pairs)
Hint: Array.from() or [...s] iterates by code point, not code unit.
Return the corrected reverseString function.`,
    harness: `
const tests = [
  ['a👍b', 'b👍a'],
  ['hello', 'olleh'],
  ['', ''],
  ['🎉🎊🎈', '🎈🎊🎉'],
  ['abc123', '321cba'],
];
let passed = 0;
for (const [input, expected] of tests) {
  try {
    const got = reverseString(input);
    if (got === expected) passed++;
    else console.error('fail', JSON.stringify(input), 'got', JSON.stringify(got));
  } catch (e) { console.error('err', input, e.message); }
}
console.log(JSON.stringify({ passed }));
`.trim(),
    totalTests: 5,
  },
  {
    id: 'flatten-depth',
    name: 'Flatten respects depth',
    buggy: `
function flatten(arr, depth) {
  if (depth === 0) return arr;
  return arr.flat(Infinity);
}
`.trim(),
    spec: `The function should flatten an array to at most the given depth (default: 1).
Visible failing test:
  flatten([1, [2, [3, [4]]]], 2)  // should be [1, 2, 3, [4]], is currently [1, 2, 3, 4]
Return the corrected flatten function.`,
    harness: `
const tests = [
  [[[1, [2, [3, [4]]]], 2], [1, 2, 3, [4]]],
  [[[1, [2, [3, [4]]]], 1], [1, 2, [3, [4]]]],
  [[[1, [2, [3]]], 0], [1, [2, [3]]]],
  [[[[[1]]], Infinity], [1]],
  [[[1, 2, 3], 5], [1, 2, 3]],
];
let passed = 0;
for (const [args, expected] of tests) {
  try {
    const got = flatten(...args);
    if (JSON.stringify(got) === JSON.stringify(expected)) passed++;
    else console.error('fail', JSON.stringify(args), 'got', JSON.stringify(got));
  } catch (e) { console.error('err', args, e.message); }
}
console.log(JSON.stringify({ passed }));
`.trim(),
    totalTests: 5,
  },
  {
    id: 'date-parse',
    name: 'Parse YYYY-MM-DD without timezone drift',
    buggy: `
function parseLocalDate(s) {
  return new Date(s);
}
`.trim(),
    spec: `The function should parse 'YYYY-MM-DD' as a local-timezone date (midnight local), not UTC.
Visible failing test:
  parseLocalDate('2024-03-15').getDate() === 15   // currently returns 14 in western timezones
Hint: 'YYYY-MM-DD' is parsed as UTC by the Date constructor; split the string instead.
Return the corrected parseLocalDate function.`,
    harness: `
const tests = [
  ['2024-03-15', { y: 2024, m: 2, d: 15 }],
  ['2024-01-01', { y: 2024, m: 0, d: 1 }],
  ['2024-12-31', { y: 2024, m: 11, d: 31 }],
  ['1999-06-10', { y: 1999, m: 5, d: 10 }],
  ['2020-02-29', { y: 2020, m: 1, d: 29 }],
];
let passed = 0;
for (const [input, expected] of tests) {
  try {
    const d = parseLocalDate(input);
    if (d.getFullYear() === expected.y && d.getMonth() === expected.m && d.getDate() === expected.d) passed++;
    else console.error('fail', input, 'got', d.getFullYear(), d.getMonth(), d.getDate());
  } catch (e) { console.error('err', input, e.message); }
}
console.log(JSON.stringify({ passed }));
`.trim(),
    totalTests: 5,
  },
  {
    id: 'debounce',
    name: 'Debounce preserves latest args',
    buggy: `
function debounce(fn, ms) {
  let timer = null;
  return function() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}
`.trim(),
    spec: `The function should debounce calls so that fn is invoked once after ms with the LATEST arguments, preserving 'this' context.
Visible failing test:
  const d = debounce((x) => console.log(x), 10);
  d('a'); d('b'); d('c');   // should log 'c' once; currently logs undefined
Return the corrected debounce function.`,
    harness: `
const calls = [];
const d = debounce(function(x) { calls.push([this?.tag, x]); }, 20);
const ctx = { tag: 'T', run() { d.call(this, 'a'); d.call(this, 'b'); d.call(this, 'c'); } };
ctx.run();
setTimeout(() => {
  const passes = [
    calls.length === 1 ? 1 : 0,
    calls[0]?.[1] === 'c' ? 1 : 0,
    calls[0]?.[0] === 'T' ? 1 : 0,
  ];
  d.call(ctx, 'x');
  setTimeout(() => {
    passes.push(calls.length === 2 ? 1 : 0);
    passes.push(calls[1]?.[1] === 'x' ? 1 : 0);
    console.log(JSON.stringify({ passed: passes.reduce((a,b) => a+b, 0) }));
  }, 40);
}, 40);
`.trim(),
    totalTests: 5,
  },
];

function extractFunction(response: string): string | null {
  const fence = response.match(
    /```(?:javascript|js|ts|typescript)?\s*\n([\s\S]*?)```/,
  );
  if (fence) return fence[1].trim();
  if (/^function\s+\w/.test(response.trim())) return response.trim();
  return null;
}

function runJs(
  code: string,
  timeoutMs = 5000,
): { stdout: string; stderr: string; ok: boolean } {
  const tmpDir = path.join(process.cwd(), 'output', '.tmp-bugfix');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(
    tmpDir,
    `fix-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );
  fs.writeFileSync(tmpFile, code);
  try {
    const stdout = execSync(`node "${tmpFile}"`, {
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', ok: true };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? err.message ?? '',
      ok: false,
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* tmp file cleanup is best-effort */ }
  }
}

function verifyFix(
  bug: BugFix,
  response: string,
): { score: number; details: string } {
  const fn = extractFunction(response);
  if (!fn) return { score: 0, details: 'no function extracted' };

  const fullProgram = `${fn}\n\n${bug.harness}`;
  const exec = runJs(fullProgram);

  // Parse { passed: N } from stdout's last JSON line
  const lines = exec.stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  let passedTests = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (typeof obj.passed === 'number') {
        passedTests = obj.passed;
        break;
      }
    } catch {
      /* not a JSON line; keep scanning */
    }
  }

  if (!exec.ok && passedTests === 0) {
    return { score: 0, details: `error: ${exec.stderr.slice(0, 120)}` };
  }

  const pct = passedTests / bug.totalTests;
  const score = Math.round(pct * 5);
  return { score, details: `${passedTests}/${bug.totalTests} tests passed` };
}

function buildBugfixTasks(): EvalTask[] {
  return BUGFIXES.map((bug) => ({
    id: `bugfix-${bug.id}`,
    name: bug.name,
    prompt: `Here is a buggy function:\n\n\`\`\`javascript\n${bug.buggy}\n\`\`\`\n\n${bug.spec}`,
    maxScore: 5,
    section: SECTION_BUGFIX,
    verify: (response: string) => verifyFix(bug, response),
  }));
}

// ── Build suite ─────────────────────────────────────────────────────────────

export interface CodingSuiteOptions {
  name?: string;
  /** Restrict to a subset of languages. Default: all three. */
  languages?: Language[];
  /** Override per-task timeout (ms). Defaults to EvalSuite default (5 min). */
  perTaskTimeoutMs?: number;
}

export function makeCodingSuite(
  model: ModelDetails,
  opts: CodingSuiteOptions = {},
): EvalSuite {
  const languages = opts.languages ?? ALL_LANGUAGES;
  const tasks: EvalTask[] = [
    ...buildGenerationTasks(languages),
    ...buildBugfixTasks(),
  ];

  return new EvalSuite({
    name: opts.name ?? 'llm-eval-coding',
    stimulus: (task) => {
      if (task.section === SECTION_BUGFIX) {
        return {
          role: 'expert JavaScript engineer',
          objective: 'fix the bug in the given function',
          instructions: [
            'Return ONLY the corrected function inside a ```javascript code block',
            'No explanation, no preamble',
            'Keep the function signature identical',
            'The function must be named exactly as shown',
          ],
          temperature: 0.1,
          maxTokens: 800,
        };
      }
      return {
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
      };
    },
    tasks,
    models: [model],
    allModels: [model],
    concurrency: 1,
    perTaskTimeoutMs: opts.perTaskTimeoutMs,
  });
}
