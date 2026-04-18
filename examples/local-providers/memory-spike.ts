#!/usr/bin/env node
/**
 * Memory spike: baseline → single call → watch memory until it drops.
 *
 * Walks through each runtime in turn:
 *   1. Read baseline (llama-server / ollama runner RSS sums, plus total OS wired+active)
 *   2. Fire a single smoke prompt
 *   3. Poll memory every 2s, log the trajectory, stop when either
 *      (a) it drops back to baseline ± tolerance, or
 *      (b) MAX_WATCH_SEC elapses.
 *
 * Goal: find out what TTL the runtimes are *actually* honoring and how much
 * RSS each model load costs, so we can pick a sane smoke-test budget.
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/local-providers/memory-spike.ts
 *   dotenvx run -- pnpm tsx examples/local-providers/memory-spike.ts --runtime ollama
 *   dotenvx run -- pnpm tsx examples/local-providers/memory-spike.ts --max-watch 600
 */

import '../model-showdown/shared/env.js';
import { execSync } from 'child_process';
import { streamText } from 'ai';
import { getModel } from '../../src/providers/index.js';
import { createOllamaProvider } from '../../src/providers/ollama.js';
import { createLMStudioProvider } from '../../src/providers/lmstudio.js';
import { createLlamaBarnProvider } from '../../src/providers/llamabarn.js';
import { createLlamaSwapProvider } from '../../src/providers/llamaswap.js';
import type { ModelDetails } from '../../src/cognition/types.js';

// ── Memory sampling ──────────────────────────────────────────────────────────

interface ProcSample {
  pid: number;
  rssBytes: number;
  command: string;
}

interface MemSnapshot {
  totalBytes: number;
  procs: ProcSample[];
}

/**
 * On macOS, `ps` RSS understates actual memory use once the OS pages things
 * out. `vmmap --summary <pid>` exposes the "Physical footprint" which is
 * what the user perceives as memory pressure. We fall back to ps RSS on
 * non-Darwin platforms.
 */
function physicalFootprintBytes(pid: number): number {
  if (process.platform !== 'darwin') return 0;
  try {
    const out = execSync(`vmmap --summary ${pid}`, { encoding: 'utf8', timeout: 2000 });
    const m = out.match(/Physical footprint:\s+([\d.]+)([KMGT])?/);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const unit = m[2] ?? '';
    const mult = unit === 'G' ? 1024 ** 3 : unit === 'M' ? 1024 ** 2 : unit === 'K' ? 1024 : 1;
    return Math.round(n * mult);
  } catch {
    return 0;
  }
}

function sampleMemory(): MemSnapshot {
  // `command` (not `comm`) gives full argv — we need it to see that
  // `/path/to/ollama runner ...` is a model runner, since `comm` truncates
  // to just the executable path.
  const raw = execSync('ps -Ao pid,rss,command', { encoding: 'utf8' });
  const procs: ProcSample[] = [];
  for (const line of raw.split('\n').slice(1)) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const [, pidStr, rssStr, command] = m;

    // Filter by the executable (first argv token) only — matching on full argv
    // produces false positives (shell wrappers whose command-lines quote the
    // name of the thing they're polling for).
    const exe = (command.split(/\s+/)[0] ?? '').toLowerCase();
    const rest = command.slice(exe.length).toLowerCase();

    const isLlamaServer = exe.endsWith('/llama-server') || exe.endsWith('ollama_llama_server');
    // Ollama's runner subprocess is invoked as `.../ollama runner --ollama-engine ...`.
    // The exe is `.../ollama`; we confirm with the `runner` subcommand in argv.
    const isOllamaRunner = exe.endsWith('/ollama') && /\brunner\b/.test(rest);

    if (isLlamaServer || isOllamaRunner) {
      const pid = parseInt(pidStr, 10);
      const psRss = parseInt(rssStr, 10) * 1024;
      // On macOS, physical footprint > resident is common after paging
      const footprint = physicalFootprintBytes(pid);
      procs.push({
        pid,
        rssBytes: Math.max(psRss, footprint),
        command: command.trim(),
      });
    }
  }
  const totalBytes = procs.reduce((s, p) => s + p.rssBytes, 0);
  return { totalBytes, procs };
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  const mb = b / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(0)}MB`;
  return `${(mb / 1024).toFixed(2)}GB`;
}

function shortCommand(cmd: string): string {
  // Keep just the binary name (last path component of first token)
  const first = cmd.split(/\s+/)[0];
  const parts = first.split('/');
  return parts[parts.length - 1];
}

function printSnapshot(prefix: string, snap: MemSnapshot) {
  console.log(`${prefix} total: ${fmtBytes(snap.totalBytes)}`);
  for (const p of snap.procs) {
    console.log(`  pid=${p.pid.toString().padEnd(6)} ${fmtBytes(p.rssBytes).padEnd(8)} ${shortCommand(p.command)}`);
  }
}

// ── Runtime definitions ──────────────────────────────────────────────────────

interface Runtime {
  id: string;
  label: string;
  /** Pick the first available model; returns undefined if none / runtime offline */
  pickModel(): Promise<ModelDetails | undefined>;
}

const RUNTIMES: Runtime[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    async pickModel() {
      const models = await createOllamaProvider(process.env.OLLAMA_HOST).listModels().catch(() => []);
      // Prefer a smaller model for fast cycles; fall back to first
      const pref = models.find(m => /nemotron.*4b|gemma4:latest|gemma4:e2b/i.test(m.name));
      return pref ?? models[0];
    },
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    async pickModel() {
      const models = await createLMStudioProvider(process.env.LMSTUDIO_HOST).listModels().catch(() => []);
      return models[0];
    },
  },
  {
    id: 'llamabarn',
    label: 'LlamaBarn',
    async pickModel() {
      const models = await createLlamaBarnProvider(process.env.LLAMABARN_HOST).listModels().catch(() => []);
      const pref = models.find(m => /nemotron.*4b/i.test(m.name));
      return pref ?? models[0];
    },
  },
  {
    id: 'llamaswap',
    label: 'llama-swap',
    async pickModel() {
      const models = await createLlamaSwapProvider(process.env.LLAMASWAP_HOST).listModels().catch(() => []);
      const pref = models.find(m => /nemotron.*4b/i.test(m.name));
      return pref ?? models[0];
    },
  },
];

// ── Single-call driver ───────────────────────────────────────────────────────

const PROMPT = 'Reply with exactly the single word: ready.';

async function fireOnce(model: ModelDetails): Promise<{ text: string; ms: number; error?: string }> {
  const start = Date.now();
  try {
    const lm = await getModel(model);
    if (!lm) throw new Error('could not resolve model');
    const stream = streamText({ model: lm, prompt: PROMPT });
    let text = '';
    for await (const chunk of stream.textStream) text += chunk;
    await stream.finishReason;
    return { text, ms: Date.now() - start };
  } catch (err: any) {
    return { text: '', ms: Date.now() - start, error: err?.message ?? String(err) };
  }
}

// ── Wait loop ────────────────────────────────────────────────────────────────

async function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

interface Trajectory {
  samples: { atSec: number; totalBytes: number }[];
  returnedToBaselineAtSec: number | null;
  peakBytes: number;
}

async function watchUntilRelease(
  baselineBytes: number,
  maxSec: number,
  toleranceMb: number = 200,
): Promise<Trajectory> {
  const samples: { atSec: number; totalBytes: number }[] = [];
  const start = Date.now();
  let peakBytes = baselineBytes;
  let returnedToBaselineAtSec: number | null = null;
  const toleranceBytes = toleranceMb * 1024 * 1024;

  const INTERVAL_MS = 2000;
  // Print header
  console.log(`\nsec   delta        total        notes`);
  console.log('─────────────────────────────────────────────────────');

  for (let elapsed = 0; elapsed < maxSec; elapsed += INTERVAL_MS / 1000) {
    const snap = sampleMemory();
    const atSec = (Date.now() - start) / 1000;
    samples.push({ atSec, totalBytes: snap.totalBytes });
    if (snap.totalBytes > peakBytes) peakBytes = snap.totalBytes;

    const delta = snap.totalBytes - baselineBytes;
    const deltaStr = (delta >= 0 ? '+' : '') + fmtBytes(delta);
    const note =
      returnedToBaselineAtSec !== null ? 'released' :
      Math.abs(delta) < toleranceBytes ? '← within tolerance' : '';
    console.log(
      `${atSec.toFixed(1).padStart(4)}  ${deltaStr.padEnd(10)}  ${fmtBytes(snap.totalBytes).padEnd(10)}  ${note}`
    );

    if (returnedToBaselineAtSec === null && Math.abs(delta) < toleranceBytes && atSec > 1) {
      returnedToBaselineAtSec = atSec;
      // keep watching a bit more to confirm — but cap it
      if (atSec > 5) break;
    }

    await sleep(INTERVAL_MS);
  }

  return { samples, returnedToBaselineAtSec, peakBytes };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function parseMaxWatch(): number {
  const idx = process.argv.indexOf('--max-watch');
  if (idx === -1 || idx + 1 >= process.argv.length) return 420; // 7 minutes default (beyond the 5-min TTL)
  return parseInt(process.argv[idx + 1], 10) || 420;
}

function runtimeFilter(): string | null {
  const idx = process.argv.indexOf('--runtime');
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

async function main() {
  const maxWatch = parseMaxWatch();
  const want = runtimeFilter();

  console.log('🧪 Memory Spike: one call, watch until release');
  console.log(`Max watch: ${maxWatch}s (beyond the 5-min TTL default)`);
  console.log('═'.repeat(70));

  const targets = want ? RUNTIMES.filter(r => r.id === want) : RUNTIMES;

  for (const runtime of targets) {
    console.log(`\n\n▶▶▶ ${runtime.label} (${runtime.id})`);
    console.log('━'.repeat(70));

    const model = await runtime.pickModel();
    if (!model) {
      console.log(`  ⏭  runtime unavailable or no models`);
      continue;
    }
    console.log(`  model: ${model.name}`);

    // Baseline
    const baseline = sampleMemory();
    printSnapshot('\n● BASELINE (before call)', baseline);

    // Fire
    console.log('\n● FIRING CALL…');
    const result = await fireOnce(model);
    if (result.error) {
      console.log(`  ❌ ${result.error}`);
      continue;
    }
    console.log(`  ✅ "${result.text.trim().slice(0, 40)}" in ${result.ms}ms`);

    // Immediate post-call snapshot
    const afterCall = sampleMemory();
    printSnapshot('\n● IMMEDIATELY AFTER CALL', afterCall);

    // Watch
    const traj = await watchUntilRelease(baseline.totalBytes, maxWatch);

    // Summary
    const peakDelta = traj.peakBytes - baseline.totalBytes;
    console.log(`\n● SUMMARY`);
    console.log(`  Peak delta: +${fmtBytes(peakDelta)}`);
    console.log(`  Returned to baseline: ${traj.returnedToBaselineAtSec === null ? `NO (still held at ${maxWatch}s)` : `after ${traj.returnedToBaselineAtSec.toFixed(1)}s`}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
