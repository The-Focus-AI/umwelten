/**
 * Re-run the biggest per-task time outliers to see if they're reproducible
 * or transient. Critically, evicts all runtimes between each test so only
 * one model is resident in memory at a time — never two llama-servers at once.
 */

import { getModel } from '@umwelten/core/providers/index.js';
import { streamText } from 'ai';
import { evictAll, waitForMemoryBelow, sampleModelRssBytes, fmtBytes } from './shared/evict.js';

type Outlier = {
  label: string;
  provider: string;
  model: string;
  prompt: string;
  originalSec: number;
  medianSec: number;
};

const outliers: Outlier[] = [
  {
    label: 'glm-4.7-flash/llamaswap — flatten-depth (bugfix)',
    provider: 'llamaswap',
    model: 'glm-4-7-flash',
    prompt: `Fix this function so flatten respects the depth argument:\n\nfunction flatten(arr: any[], depth: number = 1): any[] {\n  return arr.reduce((acc, val) => acc.concat(Array.isArray(val) ? flatten(val) : val), []);\n}\n\nOnly output the corrected function, no commentary.`,
    originalSec: 373.7,
    medianSec: 1.5,
  },
  {
    label: 'glm-4.7-flash/llamabarn — constrained-list (thinking ON)',
    provider: 'llamabarn',
    model: 'glm-4.7-flash',
    prompt: `List 5 animals, numbered 1-5, max 8 characters each, in alphabetical order. No extra text.`,
    originalSec: 332.3,
    medianSec: 1.7,
  },
  {
    label: 'gemma-4-26b-a4b/llamabarn — grid-paths go',
    provider: 'llamabarn',
    model: 'gemma-4-26b-a4b',
    prompt: `Write a Go program that counts the number of unique paths from the top-left to the bottom-right of a grid, where some cells are blocked. The grid is given as a 2D array of 0s (empty) and 1s (blocked). Output only the complete Go program.`,
    originalSec: 901.1,
    medianSec: 13.3,
  },
  {
    label: 'gemma-4-26b-a4b/llamaswap — business-days typescript',
    provider: 'llamaswap',
    model: 'gemma-4-26b-a4b',
    prompt: `Write a TypeScript function businessDaysBetween(start: Date, end: Date): number that returns the number of business days (Mon-Fri, excluding weekends) between two dates, exclusive of the end date. Output only the complete TypeScript code.`,
    originalSec: 600.3,
    medianSec: 9.8,
  },
  {
    label: 'gemma-4-26b-a4b/llamaswap — custom-cipher python',
    provider: 'llamaswap',
    model: 'gemma-4-26b-a4b',
    prompt: `Write a Python function zigzag_encode(text: str, rails: int) -> str that encodes text using the Rail Fence cipher with the given number of rails. Output only the complete Python code.`,
    originalSec: 880.6,
    medianSec: 16.3,
  },
];

const IDLE_BYTES = 500 * 1024 * 1024; // 500MB — matches run-quality.ts
const EVICT_MAX_MS = 60_000;

async function evictAndWait(label: string): Promise<void> {
  process.stdout.write(`  🧹 evicting (before ${label})... `);
  await evictAll();
  const released = await waitForMemoryBelow(IDLE_BYTES, EVICT_MAX_MS);
  if (released.ok) {
    console.log(`✓ idle (${fmtBytes(released.finalBytes)}) after ${(released.elapsedMs / 1000).toFixed(1)}s`);
  } else {
    console.log(`⚠ still ${fmtBytes(released.finalBytes)} after ${(released.elapsedMs / 1000).toFixed(1)}s — aborting`);
    throw new Error(`eviction failed — refusing to load another model on top`);
  }
}

async function runOnce(o: Outlier, run: number): Promise<number> {
  const lm = await getModel({ provider: o.provider as any, name: o.model });
  if (!lm) throw new Error(`null model for ${o.provider}:${o.model}`);
  const start = Date.now();
  const res = streamText({ model: lm, prompt: o.prompt });
  let text = '';
  for await (const chunk of res.textStream) text += chunk;
  await res.finishReason;
  const elapsed = (Date.now() - start) / 1000;
  const rss = sampleModelRssBytes();
  console.log(`  run ${run}: ${elapsed.toFixed(1)}s, ${text.length} chars, RSS ${fmtBytes(rss)}`);
  return elapsed;
}

for (const o of outliers) {
  console.log(`\n=== ${o.label}`);
  console.log(`    original: ${o.originalSec}s, median: ${o.medianSec}s, ratio: ${(o.originalSec/o.medianSec).toFixed(1)}×`);
  await evictAndWait(o.label);
  const times: number[] = [];
  for (let i = 1; i <= 3; i++) {
    try {
      times.push(await runOnce(o, i));
    } catch (e: any) {
      console.log(`  run ${i}: ERROR ${e.message}`);
    }
  }
  if (times.length) {
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);
    const verdict = max < o.originalSec * 0.25
      ? '✅ transient (rerun << original)'
      : max > o.originalSec * 0.5
      ? '❌ reproducible'
      : '⚠️  partial match';
    console.log(`  mean ${mean.toFixed(1)}s, max ${max.toFixed(1)}s → ${verdict}`);
  }
}

// Final eviction so we leave a clean state.
console.log();
await evictAndWait('cleanup');
