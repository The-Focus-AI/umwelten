#!/usr/bin/env node
/**
 * Local-Providers Coding — Tier 2: Fix the Bug
 *
 * Each task shows a buggy function + a test case that fails + (sometimes)
 * the expected behavior, and asks the model to return the corrected function.
 *
 * Scoring: we concatenate the model's function with a hidden test harness
 * and run it. Pass all tests → 5. Subset → partial. Parse error → 0.
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/local-providers/quality/coding-bugfix.ts
 *   dotenvx run -- pnpm tsx examples/local-providers/quality/coding-bugfix.ts --frontier
 */

import '../../model-showdown/shared/env.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { EvalSuite } from '../../../src/evaluation/suite.ts';
import { LOCAL_MODELS, ALL_MODELS, includeFrontier } from '../shared/models.js';

// ── Bugfix fixtures ──────────────────────────────────────────────────────────

interface BugFix {
  id: string;
  name: string;
  /** Buggy code shown to the model */
  buggy: string;
  /** Public description + visible failing test */
  spec: string;
  /** Hidden test harness run against the model's fix. Returns count of passes. */
  harness: string;
  /** Total test count for scoring */
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
  // run again after delay, ensure still works
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

// ── Execution ────────────────────────────────────────────────────────────────

function extractFunction(response: string): string | null {
  const fence = response.match(/```(?:javascript|js|ts|typescript)?\s*\n([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  // Fallback: take as-is if it starts with "function"
  if (/^function\s+\w/.test(response.trim())) return response.trim();
  return null;
}

function runJs(code: string, timeoutMs = 5000): { stdout: string; stderr: string; ok: boolean } {
  const tmpDir = path.join(process.cwd(), 'output', '.tmp-bugfix');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `fix-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(tmpFile, code);
  try {
    const stdout = execSync(`node "${tmpFile}"`, { timeout: timeoutMs, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { stdout, stderr: '', ok: true };
  } catch (err: any) {
    return { stdout: err.stdout?.toString() ?? '', stderr: err.stderr?.toString() ?? err.message ?? '', ok: false };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

function verifyFix(bug: BugFix, response: string): { score: number; details: string } {
  const fn = extractFunction(response);
  if (!fn) return { score: 0, details: 'no function extracted' };

  const fullProgram = `${fn}\n\n${bug.harness}`;
  const exec = runJs(fullProgram);

  // Parse { passed: N } from stdout's last JSON line
  const lines = exec.stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
  let passedTests = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (typeof obj.passed === 'number') { passedTests = obj.passed; break; }
    } catch {}
  }

  if (!exec.ok && passedTests === 0) {
    return { score: 0, details: `error: ${exec.stderr.slice(0, 120)}` };
  }

  // Scale 0-5 based on tests passed
  const pct = passedTests / bug.totalTests;
  const score = Math.round(pct * 5);
  return { score, details: `${passedTests}/${bug.totalTests} tests passed` };
}

// ── Build + run ──────────────────────────────────────────────────────────────

export function makeSuite(models: import('../../../src/cognition/types.js').ModelDetails[]): EvalSuite {
  return new EvalSuite({
    name: 'local-providers-coding-bugfix',
    stimulus: {
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
      runnerType: 'base',
    },
    tasks: BUGFIXES.map(bug => ({
      id: bug.id,
      name: bug.name,
      prompt: `Here is a buggy function:\n\n\`\`\`javascript\n${bug.buggy}\n\`\`\`\n\n${bug.spec}`,
      maxScore: 5,
      verify: (response: string) => verifyFix(bug, response),
    })),
    models,
    allModels: models,
    concurrency: 1,
  });
}

if (process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url)) {
  const models = includeFrontier() ? ALL_MODELS : LOCAL_MODELS;
  makeSuite(models).run().catch(err => { console.error(err); process.exit(1); });
}
