#!/usr/bin/env node
/**
 * Local-Providers — single-model runner.
 *
 * Convenience entry point for re-running one cell after the fact —
 * e.g. when a previous matrix run contaminated a single (provider,
 * model) pair and you want to re-test it without re-running the
 * whole matrix.
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/local-providers/run-one.ts ollama:gemma4:26b
 *   dotenvx run -- pnpm tsx examples/local-providers/run-one.ts llamaswap:gemma-4-26b-a4b
 *   dotenvx run -- pnpm tsx examples/local-providers/run-one.ts llamaswap:gemma-4-26b-a4b --only tool-calling
 *
 * The model spec is `provider:name`. We look it up in `LOCAL_MATRIX`
 * to pick up the family label (used for grouping in reports), but
 * fall back to a synthesized entry if the spec isn't in the matrix.
 */

import '../model-showdown/shared/env.js';
import { LOCAL_MATRIX_ALL } from './shared/models.js';
import { runHarness, type MatrixEntry } from './harness/index.js';
import type { LlmEvalSuiteName } from '../../src/evaluation/llm-eval/index.js';

const argv = process.argv.slice(2);

const spec = argv.find((s) => !s.startsWith('--') && s.includes(':'));
if (!spec) {
  console.error('Usage: run-one.ts <provider:model> [--only suite,suite] [--skip-evict] [--require-ac]');
  process.exit(1);
}

const colon = spec.indexOf(':');
const provider = spec.slice(0, colon);
const name = spec.slice(colon + 1);

function readArg(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= argv.length) return undefined;
  return argv[idx + 1];
}

const VALID_SUITES: LlmEvalSuiteName[] = ['language', 'coding', 'tool-calling'];
const onlyArg = readArg('--only');
const only = onlyArg
  ? (onlyArg
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is LlmEvalSuiteName =>
        (VALID_SUITES as string[]).includes(s),
      ) as LlmEvalSuiteName[])
  : undefined;

if (onlyArg && (!only || only.length === 0)) {
  console.error(`--only: none of "${onlyArg}" are valid. Known: ${VALID_SUITES.join(', ')}`);
  process.exit(1);
}

const skipEvict = argv.includes('--skip-evict');
const requireAC = argv.includes('--require-ac');

function parseMin(flag: string): number | undefined {
  const v = readArg(flag);
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`${flag}: expected a positive number, got "${v}"`);
    process.exit(1);
  }
  return n * 60_000;
}
const perTaskTimeoutMs = parseMin('--task-timeout-min');
const perCellTimeoutMs = parseMin('--cell-timeout-min');

const matrixHit = LOCAL_MATRIX_ALL.find(
  (e) => e.model.provider === provider && e.model.name === name,
);

const entry: MatrixEntry = matrixHit
  ? { family: matrixHit.family, model: matrixHit.model }
  : { model: { provider, name } };

if (!matrixHit) {
  console.warn(
    `⚠ ${spec} not in LOCAL_MATRIX_ALL — running anyway, no family grouping.`,
  );
}

async function main() {
  const reports = await runHarness([entry], {
    skipEvict,
    skipEvictIfAlreadyLoaded: true,
    perCellTimeoutMs,
    preflight: {
      requireAC,
      minBatteryLevel: 0.5,
    },
    fullEvalOptions: {
      ...(only ? { only } : {}),
      ...(perTaskTimeoutMs ? { perTaskTimeoutMs } : {}),
    },
  });

  const r = reports[0];
  if (r.outcome.kind !== 'ok') {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
