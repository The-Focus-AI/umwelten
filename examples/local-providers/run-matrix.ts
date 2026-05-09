#!/usr/bin/env node
/**
 * Local-Providers — matrix runner (replacement for run-quality.ts).
 *
 * Thin entry point: imports `LOCAL_MATRIX`, parses a few CLI flags,
 * and hands everything to `runHarness`. All the eviction/watchdog/
 * preflight complexity lives in the harness module; all the eval
 * scoring lives in `src/evaluation/llm-eval/`.
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/local-providers/run-matrix.ts
 *   dotenvx run -- pnpm tsx examples/local-providers/run-matrix.ts --matrix nothink
 *   dotenvx run -- pnpm tsx examples/local-providers/run-matrix.ts --model gemma
 *   dotenvx run -- pnpm tsx examples/local-providers/run-matrix.ts --only language
 *   dotenvx run -- pnpm tsx examples/local-providers/run-matrix.ts --skip-evict
 *   dotenvx run -- pnpm tsx examples/local-providers/run-matrix.ts --require-ac
 */

import '../model-showdown/shared/env.js';
import type { ModelDetails } from '@umwelten/core/cognition/types.js';
import {
  LOCAL_MATRIX,
  LOCAL_MATRIX_NOTHINK,
  LOCAL_MATRIX_ALL,
  type LocalEntry,
} from './shared/models.js';
import { runHarness, type MatrixEntry } from './harness/index.js';
import type { LlmEvalSuiteName } from '@umwelten/evaluation/evaluation/llm-eval/index.js';

// ── CLI ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

function readArg(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= argv.length) return undefined;
  return argv[idx + 1];
}

function parseMatrix(): LocalEntry[] {
  const val = readArg('--matrix');
  if (!val || val === 'think') return LOCAL_MATRIX;
  if (val === 'nothink') return LOCAL_MATRIX_NOTHINK;
  if (val === 'all') return LOCAL_MATRIX_ALL;
  console.error(`--matrix: unknown "${val}". Use one of: think, nothink, all`);
  process.exit(1);
}

function parseModelFilter(): (m: ModelDetails) => boolean {
  const needle = readArg('--model');
  if (!needle) return () => true;
  return (m) => `${m.provider}:${m.name}`.includes(needle);
}

const VALID_SUITES: LlmEvalSuiteName[] = ['language', 'coding', 'tool-calling'];

function parseOnly(): LlmEvalSuiteName[] | undefined {
  const val = readArg('--only');
  if (!val) return undefined;
  const picked = val
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is LlmEvalSuiteName => (VALID_SUITES as string[]).includes(s));
  if (picked.length === 0) {
    console.error(`--only: none of "${val}" are valid. Known: ${VALID_SUITES.join(', ')}`);
    process.exit(1);
  }
  return picked;
}

const skipEvict = argv.includes('--skip-evict');
const requireAC = argv.includes('--require-ac');
const skipEvictIfAlreadyLoaded = !argv.includes('--always-evict');

function parseTimeout(): number | undefined {
  const v = readArg('--timeout-min');
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`--timeout-min: expected a positive number, got "${v}"`);
    process.exit(1);
  }
  return n * 60_000;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const matrix = parseMatrix();
  const filter = parseModelFilter();
  const targets: MatrixEntry[] = matrix
    .filter((e) => filter(e.model))
    .map((e) => ({ family: e.family, model: e.model }));
  const only = parseOnly();
  const perCellTimeoutMs = parseTimeout();

  console.log('🎯 Local-Providers matrix runner');
  console.log(`   matrix=${matrix === LOCAL_MATRIX ? 'think' : matrix === LOCAL_MATRIX_NOTHINK ? 'nothink' : 'all'} cells=${targets.length}/${matrix.length}`);
  if (only) console.log(`   only=${only.join(',')}`);

  const reports = await runHarness(targets, {
    skipEvict,
    skipEvictIfAlreadyLoaded,
    perCellTimeoutMs,
    preflight: {
      requireAC,
      // On battery, refuse to start if <50% — long matrix runs eat
      // ~30Wh easily and we don't want the laptop to die mid-cell.
      minBatteryLevel: 0.5,
    },
    // Re-check battery/AC before EVERY cell, not just at startup.
    // Otherwise a multi-hour sweep that started at 65% drains down
    // through the threshold and keeps running until the laptop sleeps.
    // Per-cell check costs ~10ms; cell duration is minutes — basically
    // free. If a cell would run with <50% battery on power, it gets
    // skipped (cached results stay; the harness moves on or exits).
    perCellPreflight: true,
    fullEvalOptions: only ? { only } : {},
  });

  const failed = reports.filter(
    (r) => r.outcome.kind === 'timeout' || r.outcome.kind === 'error',
  );
  if (failed.length > 0) {
    console.log('\n⚠ failed cells:');
    for (const r of failed) {
      console.log(`   - ${r.entry.model.provider}:${r.entry.model.name} → ${r.outcome.kind}`);
    }
  }

  console.log('\nNext: generate the combined report');
  console.log('  dotenvx run -- pnpm run cli eval combine \\');
  console.log('    --config examples/local-providers/suite-config.ts \\');
  console.log('    --format md --output output/local-providers-report.md');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
