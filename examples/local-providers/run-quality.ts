#!/usr/bin/env node
/**
 * Local-Providers — Model-Major Quality Runner
 *
 * Runs all four quality suites (instruction, reasoning, coding, coding-bugfix)
 * over the LOCAL_MATRIX, but ordered MODEL-MAJOR:
 *
 *   for each (runtime, model) in LOCAL_MATRIX:
 *     evict everything, wait for memory to drop to near-idle
 *     for each suite in [instruction, reasoning, coding, coding-bugfix]:
 *       EvalSuite.run with models = [this one]
 *
 * Why: local runtimes can only host one 20-30GB model at a time on this
 * hardware. EvalSuite's default iteration is task-major (all models on task 1,
 * then all models on task 2), which causes concurrent model residency and
 * swap thrashing. Model-major keeps one model hot across all its tasks.
 *
 * Resume-safe: each sub-suite checks disk for cached responses/results and
 * skips (task, model) pairs that are already done.
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/local-providers/run-quality.ts
 *   dotenvx run -- pnpm tsx examples/local-providers/run-quality.ts --only reasoning
 *   dotenvx run -- pnpm tsx examples/local-providers/run-quality.ts --only instruction,coding
 *   dotenvx run -- pnpm tsx examples/local-providers/run-quality.ts --new        # bust all caches
 *   dotenvx run -- pnpm tsx examples/local-providers/run-quality.ts --skip-evict # debug only
 */

import './shared/models.js'; // ensure models export is registered
import '../model-showdown/shared/env.js';
import type { ModelDetails } from '../../src/cognition/types.js';
import { LOCAL_MATRIX } from './shared/models.js';
import {
  evictAll,
  waitForMemoryBelow,
  sampleModelRssBytes,
  fmtBytes,
} from './shared/evict.js';

import { makeSuite as makeInstruction } from './quality/instruction.js';
import { makeSuite as makeReasoning } from './quality/reasoning.js';
import { makeSuite as makeCoding } from './quality/coding.js';
import { makeSuite as makeBugfix } from './quality/coding-bugfix.js';

// ── Config ───────────────────────────────────────────────────────────────────

/** RSS threshold below which we consider "no model loaded". 500 MB covers
 *  idle llama-server / ollama serve overhead. */
const IDLE_BYTES = 500 * 1024 * 1024;

/** Max seconds to wait for memory to drop after eviction before giving up. */
const EVICT_MAX_MS = 60_000;

/** Max wall-clock per sub-suite per model. Thinking-mode coding suites can
 *  legitimately take an hour, but a single hung task (model stuck in
 *  reasoning loop) will eat arbitrary time otherwise. Cap so one bad task
 *  doesn't block the other 6+ models. */
const SUITE_WATCHDOG_MS = 90 * 60 * 1000; // 90 minutes

const suites = {
  instruction: makeInstruction,
  reasoning: makeReasoning,
  coding: makeCoding,
  'coding-bugfix': makeBugfix,
} as const;

type SuiteName = keyof typeof suites;
const ALL_SUITE_NAMES: SuiteName[] = ['instruction', 'reasoning', 'coding', 'coding-bugfix'];

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseOnly(): SuiteName[] {
  const idx = process.argv.indexOf('--only');
  if (idx === -1 || idx + 1 >= process.argv.length) return ALL_SUITE_NAMES;
  const raw = process.argv[idx + 1].split(',').map(s => s.trim());
  const picked = raw.filter((s): s is SuiteName => s in suites);
  if (picked.length === 0) {
    console.error(`--only: none of [${raw.join(',')}] are valid suite names. Known: ${ALL_SUITE_NAMES.join(', ')}`);
    process.exit(1);
  }
  return picked;
}

function parseModelFilter(): ((m: ModelDetails) => boolean) {
  const idx = process.argv.indexOf('--model');
  if (idx === -1 || idx + 1 >= process.argv.length) return () => true;
  const needle = process.argv[idx + 1];
  return m => `${m.provider}:${m.name}`.includes(needle);
}

const skipEvict = process.argv.includes('--skip-evict');

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const selectedSuites = parseOnly();
  const modelFilter = parseModelFilter();
  const targets = LOCAL_MATRIX.filter(e => modelFilter(e.model));

  console.log('🎯 Local-Providers Quality Runner (model-major)');
  console.log('═'.repeat(78));
  console.log(`Models:    ${targets.length} / ${LOCAL_MATRIX.length}`);
  console.log(`Suites:    ${selectedSuites.join(', ')}`);
  console.log(`Total jobs: ${targets.length} × ${selectedSuites.length} = ${targets.length * selectedSuites.length} suite runs`);
  console.log(`Eviction:  ${skipEvict ? 'DISABLED' : `enabled (wait until <${fmtBytes(IDLE_BYTES)})`}`);
  console.log('═'.repeat(78));

  let idx = 0;
  for (const entry of targets) {
    idx++;
    const label = `${entry.model.provider}:${entry.model.name}`;
    console.log(`\n\n[${idx}/${targets.length}] ▶ ${label}  (family: ${entry.family})`);
    console.log('─'.repeat(78));

    // ── Evict everything, wait for memory to clear ─────────────────────
    if (!skipEvict) {
      process.stdout.write('🧹 evicting all runtimes... ');
      await evictAll();
      const released = await waitForMemoryBelow(IDLE_BYTES, EVICT_MAX_MS);
      if (released.ok) {
        console.log(`✓ idle (${fmtBytes(released.finalBytes)}) after ${(released.elapsedMs / 1000).toFixed(1)}s`);
      } else {
        console.log(`⚠️  timeout — ${fmtBytes(released.finalBytes)} still resident after ${(released.elapsedMs / 1000).toFixed(1)}s; proceeding anyway`);
      }
    }

    // ── Run each selected suite against this one model ─────────────────
    for (const suiteName of selectedSuites) {
      const t0 = Date.now();
      console.log(`\n  ▸ ${suiteName}`);
      try {
        const suite = suites[suiteName]([entry.model]);
        // Watchdog: hard cap wall time per suite. A hung task (model stuck
        // in thinking loop with no response) can otherwise block forever.
        // Throwing here lets us move on — partial results stay cached.
        await Promise.race([
          suite.run(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`watchdog: suite exceeded ${SUITE_WATCHDOG_MS / 60_000}min`)),
              SUITE_WATCHDOG_MS,
            ),
          ),
        ]);
        console.log(`    ✓ ${suiteName} complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      } catch (err: any) {
        console.error(`    ❌ ${suiteName} failed: ${err?.message ?? String(err)}`);
        // Keep going — next suite might still work. Results are disk-cached.
      }
    }

    // Show peak memory at end of this model's run
    const peak = sampleModelRssBytes();
    console.log(`\n  📊 peak model RSS: ${fmtBytes(peak)}`);
  }

  console.log('\n\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('ALL DONE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('\nNext: generate the combined report:');
  console.log('  dotenvx run -- pnpm run cli eval combine \\');
  console.log('    --config examples/local-providers/suite-config.ts \\');
  console.log('    --format md --output output/local-providers-report.md\n');
}

main().catch(err => { console.error(err); process.exit(1); });
