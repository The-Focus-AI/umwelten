#!/usr/bin/env node
/**
 * Local-Providers Speed Benchmark
 *
 * Measures TTFT (time to first token), tokens/sec, and cold-start latency
 * across all local runtimes for a chosen set of (provider, model) pairs.
 *
 * The pairs are configured at the top of this file — edit MATRIX to match
 * what `catalog.ts` showed is available on your machine.
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/local-providers/speed.ts
 *   dotenvx run -- pnpm tsx examples/local-providers/speed.ts --new
 *   dotenvx run -- pnpm tsx examples/local-providers/speed.ts --prompt long
 */

import fs from 'fs';
import path from 'path';
import { streamText } from 'ai';
import { getModel } from '../../src/providers/index.js';
import type { ModelDetails } from '../../src/cognition/types.js';

// ── Matrix ───────────────────────────────────────────────────────────────────
// Edit this to reflect models actually loadable on each runtime.
// Use the exact `id` from each runtime's /v1/models (or /api/tags for Ollama).

interface Entry {
  label: string;
  family: string; // "gemma-4-26b" etc. — groups across runtimes
  model: ModelDetails;
}

import { LOCAL_MATRIX } from './shared/models.js';

const MATRIX: Entry[] = LOCAL_MATRIX.map(e => ({
  label: `${e.family} / ${e.model.provider}`,
  family: e.family,
  model: e.model,
}));

// ── Prompts ──────────────────────────────────────────────────────────────────

const SHORT_PROMPT = 'Count from 1 to 20, separated by spaces.';

const LONG_PREFIX = `
Read the following document carefully, then summarize its three main points in exactly three sentences.

DOCUMENT:
`.trim();

function buildLongPrompt(): string {
  // ~8k tokens of filler so prefill-speed differences become visible.
  // (Still small enough that every runtime can handle it at default ctx.)
  const para = `The quick brown fox jumps over the lazy dog. In the small town of Millfield, residents gathered at dawn to watch the annual hot-air balloon launch. Marcus had been restoring the 1962 convertible for three years, polishing every bolt by hand. The library's east wing housed maps from the 1800s, their paper thin as butterfly wings. Coffee shops on Fifth Avenue buzzed with students preparing for exams, their laptops open, their headphones on. `;
  // ~500 chars per para. 40 copies ≈ 20k chars ≈ ~5k tokens. Double it.
  const body = para.repeat(80);
  return `${LONG_PREFIX}\n${body}`;
}

// ── Bench ────────────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'local-providers', 'speed');
const forceNew = process.argv.includes('--new');
const promptMode = process.argv.includes('--prompt') && process.argv[process.argv.indexOf('--prompt') + 1] === 'long' ? 'long' : 'short';

interface SpeedResult {
  label: string;
  family: string;
  provider: string;
  model: string;
  promptMode: 'short' | 'long';
  promptChars: number;
  ttftMs: number | null;
  totalMs: number;
  outputChars: number;
  tokensEstimate: number;
  tokensPerSec: number | null;
  error?: string;
}

function estTokens(text: string): number {
  return Math.round(text.length / 4);
}

async function measure(entry: Entry, prompt: string): Promise<SpeedResult> {
  const start = Date.now();
  const result: SpeedResult = {
    label: entry.label,
    family: entry.family,
    provider: entry.model.provider,
    model: entry.model.name,
    promptMode,
    promptChars: prompt.length,
    ttftMs: null,
    totalMs: 0,
    outputChars: 0,
    tokensEstimate: 0,
    tokensPerSec: null,
  };

  try {
    const model = await getModel(entry.model);
    if (!model) throw new Error('could not resolve model');

    const res = streamText({ model, prompt });

    let firstTokenAt: number | null = null;
    let out = '';
    for await (const chunk of res.textStream) {
      if (firstTokenAt === null) firstTokenAt = Date.now();
      out += chunk;
    }
    // Drain to finalize
    await res.finishReason;

    const end = Date.now();
    result.ttftMs = firstTokenAt ? firstTokenAt - start : null;
    result.totalMs = end - start;
    result.outputChars = out.length;
    result.tokensEstimate = estTokens(out);
    const genMs = firstTokenAt ? end - firstTokenAt : result.totalMs;
    result.tokensPerSec = genMs > 0 ? +(result.tokensEstimate / (genMs / 1000)).toFixed(2) : null;
  } catch (err: any) {
    result.error = err?.message ?? String(err);
    result.totalMs = Date.now() - start;
  }
  return result;
}

function resultPath(entry: Entry, kind: 'warm' | 'cold', mode: string): string {
  const key = entry.label.replace(/[\/\s]+/g, '-').toLowerCase();
  return path.join(OUTPUT_DIR, mode, `${key}-${kind}.json`);
}

async function runEntry(entry: Entry, prompt: string): Promise<{ cold: SpeedResult; warm: SpeedResult }> {
  const coldFp = resultPath(entry, 'cold', promptMode);
  const warmFp = resultPath(entry, 'warm', promptMode);

  if (!forceNew && fs.existsSync(coldFp) && fs.existsSync(warmFp)) {
    return {
      cold: JSON.parse(fs.readFileSync(coldFp, 'utf8')),
      warm: JSON.parse(fs.readFileSync(warmFp, 'utf8')),
    };
  }

  // Cold: first run after model likely unloaded. We can't force unload
  // portably, but if llama-swap / llamabarn TTL is short this captures it.
  const cold = await measure(entry, prompt);
  fs.mkdirSync(path.dirname(coldFp), { recursive: true });
  fs.writeFileSync(coldFp, JSON.stringify(cold, null, 2));

  // Warm: second run, model already loaded.
  const warm = await measure(entry, prompt);
  fs.writeFileSync(warmFp, JSON.stringify(warm, null, 2));

  return { cold, warm };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const prompt = promptMode === 'long' ? buildLongPrompt() : SHORT_PROMPT;

  console.log('🏎  Local-Providers Speed Benchmark');
  console.log('═'.repeat(70));
  console.log(`Prompt mode:  ${promptMode} (${prompt.length} chars ≈ ${estTokens(prompt)} tokens)`);
  console.log(`Entries:      ${MATRIX.length}`);
  console.log(`Output:       ${OUTPUT_DIR}/${promptMode}`);
  console.log('═'.repeat(70));
  console.log();

  const results: { entry: Entry; cold: SpeedResult; warm: SpeedResult }[] = [];

  for (const entry of MATRIX) {
    process.stdout.write(`  🔄 ${entry.label.padEnd(34)}`);
    const { cold, warm } = await runEntry(entry, prompt);
    if (warm.error) {
      console.log(`  ❌ ${warm.error.slice(0, 60)}`);
    } else {
      const t = (n: number | null) => n === null ? '—' : `${n}ms`;
      console.log(`  cold ttft=${t(cold.ttftMs)} total=${t(cold.totalMs)}  |  warm ttft=${t(warm.ttftMs)} ${warm.tokensPerSec ?? '—'} tok/s`);
    }
    results.push({ entry, cold, warm });
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log('\n\n═══════════════════════════════════════════════════════════════════');
  console.log(`SUMMARY (${promptMode} prompt)`);
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Group by family
  const families = new Map<string, typeof results>();
  for (const r of results) {
    if (!families.has(r.entry.family)) families.set(r.entry.family, []);
    families.get(r.entry.family)!.push(r);
  }

  for (const [family, rows] of families) {
    console.log(`\n  ${family}\n`);
    const header = `  ${'Runtime'.padEnd(14)} ${'cold TTFT'.padEnd(10)} ${'cold tot'.padEnd(10)} ${'warm TTFT'.padEnd(10)} ${'warm tok/s'.padEnd(12)}`;
    console.log(header);
    console.log('  ' + '─'.repeat(header.length - 2));
    for (const r of rows) {
      const t = (n: number | null) => n === null ? '—' : `${n}`;
      const runtime = r.entry.label.split(' / ')[1];
      const cells = [
        runtime.padEnd(14),
        t(r.cold.ttftMs).padEnd(10),
        t(r.cold.totalMs).padEnd(10),
        t(r.warm.ttftMs).padEnd(10),
        (r.warm.tokensPerSec?.toString() ?? '—').padEnd(12),
      ];
      console.log('  ' + cells.join(' '));
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
