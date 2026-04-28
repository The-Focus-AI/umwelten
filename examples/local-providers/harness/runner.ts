/**
 * Local-providers harness loop.
 *
 * Layer 2 of the architecture: orchestrates `runFullEval` (Layer 1)
 * across a matrix of (provider, model) pairs running on local
 * hardware, with eviction, preflight, and AbortController-backed
 * watchdog cancellation.
 *
 * The bug this design fixes: the previous `Promise.race` watchdog
 * rejected the await but didn't cancel the in-flight HTTP request, so
 * a hung model kept generating in the background — pinning memory and
 * (because llama-swap retried the queued request) re-loading the
 * "evicted" model long after we'd moved on.
 *
 * Now: we spawn an `AbortController`, schedule a timer that calls
 * `controller.abort()`, and pass the signal all the way down to the AI
 * SDK call. When the timer fires, the SDK actually aborts the HTTP
 * request, llama-swap stops retrying, and `evictAll()` afterwards
 * cleanly tears down any straggler.
 */

import type { ModelDetails } from '../../../src/cognition/types.js';
import {
  runFullEval,
  type FullEvalOptions,
  type FullEvalResult,
} from '../../../src/evaluation/llm-eval/index.js';
import {
  evictAll,
  evictAndWait,
  fmtBytes,
  getModelMemoryBytes,
  skipIfAlreadyLoaded,
} from './eviction.js';
import { getLoadedModels } from './system-state.js';
import { runWithWatchdog } from './cancellation.js';
import {
  assertCanRun,
  formatPreflight,
  PreflightError,
  type PreflightOptions,
} from './preflight.js';
import { collectTimeoutDiagnostic, saveDiagnostic } from './diagnostics.js';

// ── Config / types ──────────────────────────────────────────────────────────

const IDLE_BYTES = 500 * 1024 * 1024;
const EVICT_MAX_MS = 60_000;
const DEFAULT_PER_CELL_TIMEOUT_MS = 20 * 60_000; // 20 min per (model, full-eval) cell

export interface MatrixEntry {
  /**
   * Family label for grouping "same weights, different runtime" cells
   * in reports. Optional — falls back to provider:name.
   */
  family?: string;
  model: ModelDetails;
}

export type CellOutcome =
  | { kind: 'ok'; result: FullEvalResult; elapsedMs: number }
  | { kind: 'timeout'; elapsedMs: number }
  | { kind: 'error'; error: unknown; elapsedMs: number }
  | { kind: 'preflight-failed'; reason: string }
  | { kind: 'aborted' };

export interface CellReport {
  entry: MatrixEntry;
  outcome: CellOutcome;
  /** Memory snapshot taken just after the cell finished. */
  peakBytes: number;
}

export interface HarnessOptions {
  /**
   * Wall-clock cap per cell. If exceeded, the AbortController fires
   * and the cell is reported as timeout. Default 20 min.
   */
  perCellTimeoutMs?: number;
  /** Skip the eviction step entirely (debug only). Default false. */
  skipEvict?: boolean;
  /**
   * Skip eviction if the only loaded model already matches the next
   * cell's target. Default true. Set false to force a clean reload.
   */
  skipEvictIfAlreadyLoaded?: boolean;
  /** Preflight options applied once at startup, and (if `perCellPreflight`) before each cell. */
  preflight?: PreflightOptions;
  /** Re-run preflight before every cell. Default false (once at startup). */
  perCellPreflight?: boolean;
  /** Pass-through options for `runFullEval`. */
  fullEvalOptions?: Omit<FullEvalOptions, 'signal'>;
  /** External cancellation. If aborted, the loop exits between cells. */
  signal?: AbortSignal;
  /** Logger sink. Defaults to console. */
  log?: (line: string) => void;
}

// ── Loop ─────────────────────────────────────────────────────────────────────

function lbl(m: ModelDetails): string {
  return `${m.provider}:${m.name}`;
}

function detectRuntime(m: ModelDetails): 'ollama' | 'llamaswap' | null {
  if (m.provider === 'ollama') return 'ollama';
  if (m.provider === 'llamaswap' || m.provider === 'llamaswap-nothink') return 'llamaswap';
  return null;
}

/**
 * Run `runFullEval` for every entry in `matrix`, one at a time, with
 * eviction between cells. Returns a report for each cell.
 */
export async function runHarness(
  matrix: MatrixEntry[],
  opts: HarnessOptions = {},
): Promise<CellReport[]> {
  const {
    perCellTimeoutMs = DEFAULT_PER_CELL_TIMEOUT_MS,
    skipEvict = false,
    skipEvictIfAlreadyLoaded = true,
    preflight = {},
    perCellPreflight = false,
    fullEvalOptions = {},
    signal,
    log = (line) => console.log(line),
  } = opts;

  // Startup preflight — fail fast if the machine can't sustain a long
  // run (low battery, disk full, etc.).
  try {
    const snap = await assertCanRun(preflight);
    log(`✓ preflight: ${formatPreflight(snap)}`);
  } catch (err) {
    if (err instanceof PreflightError) {
      log(`❌ preflight failed: ${err.message}`);
      throw err;
    }
    throw err;
  }

  const reports: CellReport[] = [];

  log('═'.repeat(78));
  log(`Harness: ${matrix.length} cells, per-cell timeout=${(perCellTimeoutMs / 60_000).toFixed(0)}min`);
  log(`Eviction: ${skipEvict ? 'DISABLED' : `enabled (target <${fmtBytes(IDLE_BYTES)})`}`);
  log('═'.repeat(78));

  for (let i = 0; i < matrix.length; i++) {
    if (signal?.aborted) {
      log(`\n⏹  external abort — stopping after ${i} cells`);
      reports.push({
        entry: matrix[i],
        outcome: { kind: 'aborted' },
        peakBytes: getModelMemoryBytes(),
      });
      // Mark all remaining cells as aborted too, for completeness.
      for (let j = i + 1; j < matrix.length; j++) {
        reports.push({
          entry: matrix[j],
          outcome: { kind: 'aborted' },
          peakBytes: 0,
        });
      }
      break;
    }

    const entry = matrix[i];
    const family = entry.family ?? lbl(entry.model);
    log(`\n[${i + 1}/${matrix.length}] ▶ ${lbl(entry.model)}  (family: ${family})`);
    log('─'.repeat(78));

    // Per-cell preflight (optional).
    if (perCellPreflight) {
      try {
        const snap = await assertCanRun(preflight);
        log(`  ✓ preflight: ${formatPreflight(snap)}`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log(`  ❌ preflight failed: ${reason} — skipping cell`);
        reports.push({
          entry,
          outcome: { kind: 'preflight-failed', reason },
          peakBytes: getModelMemoryBytes(),
        });
        continue;
      }
    }

    // Eviction step. Skip if requested OR if the right model is
    // already loaded and nothing else is.
    if (!skipEvict) {
      let canSkip = false;
      if (skipEvictIfAlreadyLoaded) {
        const runtime = detectRuntime(entry.model);
        if (runtime) {
          const loaded = await getLoadedModels();
          const match = skipIfAlreadyLoaded(loaded, entry.model.name, runtime);
          if (match) {
            canSkip = true;
            log(`  ✓ already loaded (${match.runtime}:${match.name}) — skipping evict`);
          }
        }
      }
      if (!canSkip) {
        process.stdout.write('  🧹 evicting all runtimes... ');
        const released = await evictAndWait({
          targetBytes: IDLE_BYTES,
          maxMs: EVICT_MAX_MS,
        });
        if (released.ok) {
          log(
            `✓ idle (${fmtBytes(released.finalBytes)}) after ${(released.elapsedMs / 1000).toFixed(1)}s`,
          );
        } else {
          log(
            `⚠️  timeout — ${fmtBytes(released.finalBytes)} still resident after ${(released.elapsedMs / 1000).toFixed(1)}s; proceeding`,
          );
        }
      }
    }

    // Run the suite under a watchdog that actually cancels the in-flight
    // request via AbortSignal — that's the deeper fix vs. the old
    // Promise.race-only watchdog.
    const cellStart = Date.now();
    const outcome = await runWithWatchdog({
      timeoutMs: perCellTimeoutMs,
      parentSignal: signal,
      task: (cellSignal) => runFullEval(entry.model, { ...fullEvalOptions, signal: cellSignal }),
    });

    const elapsedMs = Date.now() - cellStart;
    if (outcome.ok) {
      log(`  ✓ done in ${(elapsedMs / 1000).toFixed(1)}s`);
      reports.push({
        entry,
        outcome: { kind: 'ok', result: outcome.value, elapsedMs },
        peakBytes: getModelMemoryBytes(),
      });
    } else if (outcome.reason === 'timeout') {
      log(`  ⏱  timeout after ${(elapsedMs / 1000).toFixed(1)}s — collecting diagnostics...`);

      // Probe the runtime for in-flight generation state before evicting.
      // This tells us *why* it timed out (e.g. stuck generating 19K
      // thinking tokens).
      try {
        const diag = await collectTimeoutDiagnostic(
          entry.model.name,
          entry.model.provider,
          elapsedMs,
        );
        const diagPath = saveDiagnostic(diag);
        log(`  🩺 ${diag.summary}`);
        log(`  📄 diagnostic saved to ${diagPath}`);
      } catch (diagErr) {
        log(`  ⚠ diagnostic probe failed: ${diagErr instanceof Error ? diagErr.message : String(diagErr)}`);
      }

      // Even though the AbortSignal *should* cause the SDK to release
      // the HTTP socket, llama-swap may still hold the worker. Force
      // an evict pass to guarantee a clean slate for the next cell.
      log('  🧹 evicting...');
      await evictAll();
      reports.push({
        entry,
        outcome: { kind: 'timeout', elapsedMs },
        peakBytes: getModelMemoryBytes(),
      });
    } else {
      const msg = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      log(`  ❌ error after ${(elapsedMs / 1000).toFixed(1)}s: ${msg}`);
      reports.push({
        entry,
        outcome: { kind: 'error', error: outcome.error, elapsedMs },
        peakBytes: getModelMemoryBytes(),
      });
    }

    log(`  📊 peak model RSS: ${fmtBytes(getModelMemoryBytes())}`);
  }

  log('\n' + '═'.repeat(78));
  log('Harness complete');
  log('═'.repeat(78));
  const ok = reports.filter((r) => r.outcome.kind === 'ok').length;
  const tmo = reports.filter((r) => r.outcome.kind === 'timeout').length;
  const err = reports.filter((r) => r.outcome.kind === 'error').length;
  const pf = reports.filter((r) => r.outcome.kind === 'preflight-failed').length;
  const ab = reports.filter((r) => r.outcome.kind === 'aborted').length;
  log(`  ok=${ok}  timeout=${tmo}  error=${err}  preflight=${pf}  aborted=${ab}`);

  return reports;
}
