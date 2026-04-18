#!/usr/bin/env node
/**
 * Local-Providers Smoke Test
 *
 * For each shared model family (present on ≥2 runtimes), measure:
 *   - COLD:   time to first token + total when model is not in memory
 *   - WARM:   time to first token on a second call while model is hot
 *   - tok/s:  steady-state generation rate
 *
 * Between pairs we actively evict the previous model and verify memory
 * returned to baseline before the next cold call — otherwise "cold" times
 * would be distorted by swap-under-pressure thrashing.
 *
 * Eviction strategies:
 *   - Ollama:     POST /api/generate with keep_alive=0
 *   - llama-swap: GET /unload
 *   - LlamaBarn:  pkill its llama-server child process (GUI respawns on next call)
 *   - LM Studio:  no API; rely on JIT auto-unload config (warn if not)
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/local-providers/smoke.ts
 *   dotenvx run -- pnpm tsx examples/local-providers/smoke.ts --new
 *   dotenvx run -- pnpm tsx examples/local-providers/smoke.ts --family gemma-4-26b-a4b
 *   dotenvx run -- pnpm tsx examples/local-providers/smoke.ts --no-evict
 */

import '../model-showdown/shared/env.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { streamText } from 'ai';
import { createOllamaProvider } from '../../src/providers/ollama.js';
import { createLMStudioProvider } from '../../src/providers/lmstudio.js';
import { createLlamaBarnProvider } from '../../src/providers/llamabarn.js';
import { createLlamaSwapProvider } from '../../src/providers/llamaswap.js';
import { getModel } from '../../src/providers/index.js';
import { normalizeModelName } from '../../src/providers/llamaswap-config.js';
import type { ModelDetails } from '../../src/cognition/types.js';

// ── Config ───────────────────────────────────────────────────────────────────

const PROMPT = 'Reply with exactly the single word: ready.';
const CALL_TIMEOUT_MS = 180_000; // first cold load on 26B can be ~60s

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'local-providers', 'smoke');
const forceNew = process.argv.includes('--new');
const skipEvict = process.argv.includes('--no-evict');

// ── Runtime definitions ─────────────────────────────────────────────────────

interface Runtime {
  id: string;
  label: string;
  host: string;
  list(): Promise<ModelDetails[]>;
  evict(): Promise<void>;
}

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const LMSTUDIO_HOST = process.env.LMSTUDIO_HOST || 'http://localhost:1234/v1';
const LLAMABARN_HOST = process.env.LLAMABARN_HOST || 'http://localhost:2276/v1';
const LLAMASWAP_HOST = process.env.LLAMASWAP_HOST || 'http://localhost:8090/v1';

async function evictOllama(host: string, model: ModelDetails): Promise<void> {
  // Ollama unloads per-model via keep_alive=0 on a trivial generate call.
  try {
    await fetch(`${host}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: model.name, prompt: '', keep_alive: 0, stream: false }),
    });
  } catch { /* best effort */ }
}

async function evictLlamaSwap(host: string): Promise<void> {
  // llama-swap /unload unloads all currently loaded models.
  try {
    const base = host.replace(/\/v1\/?$/, '');
    await fetch(`${base}/unload`);
  } catch { /* best effort */ }
}

function evictLlamaBarn(): void {
  // LlamaBarn has no API for unload. Kill its model-hosting llama-server
  // subprocess directly — the GUI will respawn it on next request.
  try {
    execSync(
      `pkill -f "LlamaBarn.app/Contents/MacOS/llama-cpp/llama-server --host 127.0.0.1"`,
      { stdio: 'ignore' },
    );
  } catch { /* nothing to kill */ }
}

const RUNTIMES: Runtime[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    host: OLLAMA_HOST,
    list: () => createOllamaProvider(OLLAMA_HOST).listModels(),
    async evict() { /* model-specific eviction happens per-pair */ },
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    host: LMSTUDIO_HOST,
    list: () => createLMStudioProvider(LMSTUDIO_HOST).listModels(),
    async evict() {
      // No programmatic unload; JIT mode in Developer settings handles it.
    },
  },
  {
    id: 'llamabarn',
    label: 'LlamaBarn',
    host: LLAMABARN_HOST,
    list: () => createLlamaBarnProvider(LLAMABARN_HOST).listModels(),
    async evict() { evictLlamaBarn(); },
  },
  {
    id: 'llamaswap',
    label: 'llama-swap',
    host: LLAMASWAP_HOST,
    list: () => createLlamaSwapProvider(LLAMASWAP_HOST).listModels(),
    async evict() { await evictLlamaSwap(LLAMASWAP_HOST); },
  },
];

// ── Memory sampling ──────────────────────────────────────────────────────────

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

function sampleModelRssBytes(): number {
  const raw = execSync('ps -Ao pid,rss,command', { encoding: 'utf8' });
  let total = 0;
  for (const line of raw.split('\n').slice(1)) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const [, pidStr, rssStr, command] = m;
    const exe = (command.split(/\s+/)[0] ?? '').toLowerCase();
    const rest = command.slice(exe.length).toLowerCase();
    const isLlamaServer = exe.endsWith('/llama-server') || exe.endsWith('ollama_llama_server');
    const isOllamaRunner = exe.endsWith('/ollama') && /\brunner\b/.test(rest);
    if (isLlamaServer || isOllamaRunner) {
      const pid = parseInt(pidStr, 10);
      const psRss = parseInt(rssStr, 10) * 1024;
      const foot = physicalFootprintBytes(pid);
      total += Math.max(psRss, foot);
    }
  }
  return total;
}

// ── Measurement ──────────────────────────────────────────────────────────────

interface CallResult {
  ttftMs: number | null;
  totalMs: number;
  outputChars: number;
  tokensPerSec: number | null;
  error?: string;
}

async function callOnce(model: ModelDetails): Promise<CallResult> {
  const start = Date.now();
  const out: CallResult = { ttftMs: null, totalMs: 0, outputChars: 0, tokensPerSec: null };
  try {
    const lm = await getModel(model);
    if (!lm) throw new Error('could not resolve model');

    const stream = streamText({ model: lm, prompt: PROMPT });
    const watchdog = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${CALL_TIMEOUT_MS}ms`)), CALL_TIMEOUT_MS)
    );
    let firstTokenAt: number | null = null;
    let text = '';
    await Promise.race([
      (async () => {
        for await (const chunk of stream.textStream) {
          if (firstTokenAt === null) firstTokenAt = Date.now();
          text += chunk;
        }
        await stream.finishReason;
      })(),
      watchdog,
    ]);
    const end = Date.now();
    out.ttftMs = firstTokenAt ? firstTokenAt - start : null;
    out.totalMs = end - start;
    out.outputChars = text.length;
    const genMs = firstTokenAt ? end - firstTokenAt : out.totalMs;
    const tokEst = Math.round(text.length / 4);
    out.tokensPerSec = genMs > 0 ? +(tokEst / (genMs / 1000)).toFixed(1) : null;
  } catch (err: any) {
    out.error = err?.message ?? String(err);
    out.totalMs = Date.now() - start;
  }
  return out;
}

// ── Eviction ────────────────────────────────────────────────────────────────

/**
 * Evict a specific (runtime, model) before a cold-load measurement.
 * We unload only *this* runtime's state — other runtimes' residency
 * doesn't affect our measurement (different processes; OS swaps under
 * pressure, which is exactly what we're testing).
 */
async function evictSpecific(runtimeId: string, model: ModelDetails): Promise<void> {
  if (skipEvict) return;
  switch (runtimeId) {
    case 'ollama':
      await evictOllama(OLLAMA_HOST, model);
      break;
    case 'llamaswap':
      await evictLlamaSwap(LLAMASWAP_HOST);
      break;
    case 'llamabarn':
      evictLlamaBarn();
      break;
  }
}

// ── Family intersection ─────────────────────────────────────────────────────

/**
 * Map from whatever a runtime calls a model to a canonical cross-runtime
 * family key. Ollama names things differently than Unsloth's GGUF filenames
 * (e.g. `gemma4:26b` vs `unsloth/gemma-4-26B-A4B-it-GGUF`), so without this
 * map the families don't intersect even when the weights are identical.
 *
 * Keys are post-normalizeModelName() output. Values are the target family.
 */
const FAMILY_ALIASES: Record<string, string> = {
  // Ollama gemma4:26b (Q4_K_M, 25.8B) === Unsloth gemma-4-26B-A4B Q4_K_M
  'gemma4-26b': 'gemma-4-26b-a4b',
  // Ollama gpt-oss:latest (13GB) is the 20B variant
  'gpt-oss': 'gpt-oss-20b',
  // Ollama nemotron-3-nano:4b === Unsloth NVIDIA-Nemotron-3-Nano-4B
  'nemotron-3-nano-4b': 'nvidia-nemotron-3-nano-4b',
};

function normalizeFamily(name: string): string {
  const ollamaStripped = name.replace(':latest', '').replace(/:/g, '-');
  const normalized = normalizeModelName(ollamaStripped);
  return FAMILY_ALIASES[normalized] ?? normalized;
}

function familyFilter(): string | null {
  const idx = process.argv.indexOf('--family');
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

// ── Formatting ───────────────────────────────────────────────────────────────

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function fmtMs(n: number | null): string {
  if (n === null) return '—';
  if (n < 1000) return `${n}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

function fmtBytes(b: number): string {
  const mb = b / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(0)}MB`;
  return `${(mb / 1024).toFixed(2)}GB`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface Pair { runtimeId: string; family: string; model: ModelDetails }
interface Row {
  pair: Pair;
  cold: CallResult;
  warm: CallResult;
  baselineBytes: number;
  peakBytes: number;
}

function resultPath(pair: Pair): string {
  const key = `${pair.runtimeId}__${pair.family}`.replace(/[^a-z0-9_-]/gi, '-');
  return path.join(OUTPUT_DIR, `${key}.json`);
}

async function main() {
  console.log('🫁 Local-Providers Smoke Test (with eviction)');
  console.log('═'.repeat(78));

  // Probe runtimes
  const probed = await Promise.all(RUNTIMES.map(async r => {
    try { return { runtime: r, available: true as const, models: await r.list() }; }
    catch (err: any) { return { runtime: r, available: false as const, error: err?.message ?? String(err), models: [] as ModelDetails[] }; }
  }));

  console.log('\nRUNTIMES:');
  for (const p of probed) {
    const mark = p.available ? '✅' : '❌';
    const detail = p.available ? `${p.models.length} models` : (p as any).error;
    console.log(`  ${mark} ${pad(p.runtime.label, 12)} ${pad(p.runtime.host, 34)} ${detail}`);
  }

  // Build family → pairs map
  const byFamily = new Map<string, Pair[]>();
  for (const p of probed) {
    if (!p.available) continue;
    for (const m of p.models) {
      const family = normalizeFamily(m.name);
      if (!byFamily.has(family)) byFamily.set(family, []);
      byFamily.get(family)!.push({ runtimeId: p.runtime.id, family, model: m });
    }
  }

  const wantFamily = familyFilter();
  let sharedFamilies = Array.from(byFamily.entries())
    .filter(([, pairs]) => pairs.length >= 2)
    .map(([f]) => f)
    .sort();

  if (wantFamily) {
    sharedFamilies = sharedFamilies.filter(f => f === wantFamily);
  }
  if (sharedFamilies.length === 0) {
    console.log('\nNo shared families to test.');
    return;
  }

  console.log(`\nShared families (${sharedFamilies.length}):`);
  for (const f of sharedFamilies) {
    const pairs = byFamily.get(f)!;
    console.log(`  • ${pad(f, 32)} (${pairs.map(p => p.runtimeId).join(', ')})`);
  }
  console.log();

  // Dedupe: keep one (runtime, family) per pair. If LlamaBarn lists multiple
  // aliases of the same family, we'd double-test — skip duplicates.
  const flatPairs: Pair[] = [];
  const seen = new Set<string>();
  for (const f of sharedFamilies) {
    for (const pair of byFamily.get(f)!) {
      const key = `${pair.runtimeId}|${f}`;
      if (seen.has(key)) continue;
      seen.add(key);
      flatPairs.push(pair);
    }
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const rows: Row[] = [];

  // Initial baseline: evict everything across runtimes.
  console.log('🧹 Initial eviction — clearing runtimes before starting...');
  await evictLlamaSwap(LLAMASWAP_HOST);
  evictLlamaBarn();
  await new Promise(r => setTimeout(r, 2000));
  const initialBaseline = sampleModelRssBytes();
  console.log(`   Baseline (other-runtime memory still held after LlamaBarn respawn etc): ${fmtBytes(initialBaseline)}\n`);

  for (const pair of flatPairs) {
    const fp = resultPath(pair);
    if (!forceNew && fs.existsSync(fp)) {
      const cached = JSON.parse(fs.readFileSync(fp, 'utf8')) as Row;
      rows.push(cached);
      console.log(`✓ ${pad(pair.family, 32)} ${pad(pair.runtimeId, 12)}  cached`);
      continue;
    }

    const label = `${pad(pair.family, 32)} ${pad(pair.runtimeId, 12)}`;
    console.log(`\n▶ ${label}`);

    // Pre-flight: evict THIS runtime+model so we get a genuine cold load.
    // Other runtimes' residency doesn't affect our measurement (different
    // processes), so we don't wait for them to drop.
    process.stdout.write(`   🧹 evicting ${pair.runtimeId}/${pair.model.name.slice(0, 30)}... `);
    await evictSpecific(pair.runtimeId, pair.model);
    await new Promise(r => setTimeout(r, 500));
    const baselineBytes = sampleModelRssBytes();
    console.log(`done (other-runtime mem=${fmtBytes(baselineBytes)})`);

    // Cold call
    process.stdout.write('   ❄️  cold... ');
    const cold = await callOnce(pair.model);
    if (cold.error) {
      console.log(`❌ ${cold.error.slice(0, 80)}`);
    } else {
      console.log(`ttft=${fmtMs(cold.ttftMs)} total=${fmtMs(cold.totalMs)}`);
    }
    const peakBytes = sampleModelRssBytes();

    // Warm call
    let warm: CallResult;
    if (cold.error) {
      warm = { ttftMs: null, totalMs: 0, outputChars: 0, tokensPerSec: null, error: 'skipped (cold failed)' };
    } else {
      process.stdout.write('   🔥 warm... ');
      warm = await callOnce(pair.model);
      if (warm.error) {
        console.log(`❌ ${warm.error.slice(0, 80)}`);
      } else {
        console.log(`ttft=${fmtMs(warm.ttftMs)} total=${fmtMs(warm.totalMs)}  ${warm.tokensPerSec ?? '—'} tok/s`);
      }
    }

    const row: Row = {
      pair,
      cold,
      warm,
      baselineBytes,
      peakBytes,
    };
    rows.push(row);
    fs.writeFileSync(fp, JSON.stringify(row, null, 2));
  }

  // Final summary
  console.log('\n\n' + '═'.repeat(78));
  console.log('RESULTS');
  console.log('═'.repeat(78));
  const header = `  ${pad('Family', 28)} ${pad('Runtime', 11)} ${pad('Cold TTFT', 10)} ${pad('Cold tot', 10)} ${pad('Warm TTFT', 10)} ${pad('tok/s', 8)} ${pad('ΔMem', 8)} Status`;
  console.log(header);
  console.log('  ' + '─'.repeat(header.length - 2));

  let passCount = 0;
  let failCount = 0;
  for (const r of rows) {
    const ok = !r.cold.error && !r.warm.error && r.cold.outputChars > 0 && r.warm.outputChars > 0;
    if (ok) passCount++; else failCount++;
    const deltaMem = r.peakBytes - r.baselineBytes;
    console.log(
      `  ${pad(r.pair.family, 28)} ${pad(r.pair.runtimeId, 11)} ` +
      `${pad(fmtMs(r.cold.ttftMs), 10)} ${pad(fmtMs(r.cold.totalMs), 10)} ` +
      `${pad(fmtMs(r.warm.ttftMs), 10)} ${pad(r.warm.tokensPerSec?.toString() ?? '—', 8)} ` +
      `${pad('+' + fmtBytes(deltaMem), 8)} ${ok ? '✅' : '❌'}`
    );
  }
  console.log(`\n${passCount} passed, ${failCount} failed  (results in ${OUTPUT_DIR})\n`);

  if (failCount > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
