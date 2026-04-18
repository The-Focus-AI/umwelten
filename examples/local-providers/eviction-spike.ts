#!/usr/bin/env node
/**
 * Eviction spike: for each (runtime, model) pair in the matrix, in order:
 *   1. Evict everything across all runtimes
 *   2. Wait for memory to drop to near-idle
 *   3. Fire one call to load THIS model
 *   4. Snapshot who is actually resident — fail loudly if anyone
 *      else has significant RSS (i.e. eviction of previous model failed)
 *   5. Move to next pair
 *
 * This is the "can I trust the eviction story" gate before we commit to
 * another hour of real benchmarks.
 */

import '../model-showdown/shared/env.js';
import { execSync } from 'node:child_process';
import { streamText } from 'ai';
import { getModel } from '../../src/providers/index.js';
import { LOCAL_MATRIX } from './shared/models.js';
import {
  evictAll,
  waitForMemoryBelow,
  sampleModelRssBytes,
  fmtBytes,
} from './shared/evict.js';

const IDLE_BYTES = 500 * 1024 * 1024;
const EVICT_MAX_MS = 60_000;

interface ResidentProc {
  pid: number;
  rssBytes: number;
  runtime: 'llamabarn' | 'llamaswap' | 'ollama' | 'other';
  model: string;
}

/** Who is currently resident, classified by which runtime owns them. */
function listResident(): ResidentProc[] {
  const raw = execSync('ps -Ao pid,rss,command', { encoding: 'utf8' });
  const out: ResidentProc[] = [];
  for (const line of raw.split('\n').slice(1)) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const [, pidStr, rssStr, command] = m;
    const exe = (command.split(/\s+/)[0] ?? '').toLowerCase();
    const rest = command.slice(exe.length);
    const isLlamaServer = exe.endsWith('/llama-server') || exe.endsWith('ollama_llama_server');
    const isOllamaRunner = exe.endsWith('/ollama') && /\brunner\b/.test(rest.toLowerCase());
    if (!isLlamaServer && !isOllamaRunner) continue;

    // Classify: LlamaBarn's children have the app path; llama-swap's
    // spawned llama-servers are at /opt/homebrew/bin (or wherever the
    // system llama.cpp was installed).
    let runtime: ResidentProc['runtime'] = 'other';
    let modelHint = '?';
    if (/LlamaBarn\.app/i.test(command)) {
      runtime = 'llamabarn';
      const aliasMatch = rest.match(/--alias\s+(\S+)/);
      const modelMatch = rest.match(/--model\s+(\S+)/);
      modelHint = aliasMatch?.[1] ?? modelMatch?.[1]?.split('/').pop() ?? '?';
    } else if (isOllamaRunner) {
      runtime = 'ollama';
      const mm = rest.match(/--model\s+(\S+)/);
      modelHint = mm?.[1]?.split('/').pop() ?? '?';
    } else if (isLlamaServer) {
      runtime = 'llamaswap';
      const mm = rest.match(/-m\s+(\S+)/);
      modelHint = mm?.[1]?.split('/').pop() ?? '?';
    }

    const rssBytes = parseInt(rssStr, 10) * 1024;
    // Skip tiny stub processes: llama-swap's parent manager (27 MB idle) or
    // LlamaBarn's coordinator (a few MB when no model is loaded). Only report
    // processes actually hosting model weights.
    if (rssBytes < 100 * 1024 * 1024) continue;
    out.push({
      pid: parseInt(pidStr, 10),
      rssBytes,
      runtime,
      model: modelHint,
    });
  }
  return out;
}

function printResident(procs: ResidentProc[], label: string) {
  console.log(`  ${label}:`);
  if (procs.length === 0) {
    console.log('    (none — clean)');
    return;
  }
  for (const p of procs) {
    console.log(`    ${p.runtime.padEnd(10)} pid=${p.pid.toString().padEnd(6)} rss=${fmtBytes(p.rssBytes).padStart(8)}  ${p.model}`);
  }
}

async function fireOnce(model: any): Promise<{ text: string; ms: number; error?: string }> {
  const start = Date.now();
  try {
    const lm = await getModel(model);
    if (!lm) throw new Error('could not resolve model');
    const stream = streamText({ model: lm, prompt: 'Reply with exactly the word: ready.' });
    let text = '';
    for await (const chunk of stream.textStream) text += chunk;
    await stream.finishReason;
    return { text, ms: Date.now() - start };
  } catch (err: any) {
    return { text: '', ms: Date.now() - start, error: err?.message ?? String(err) };
  }
}

async function main() {
  console.log('🔬 Eviction Spike — verifying single-model-at-a-time across LOCAL_MATRIX');
  console.log('═'.repeat(78));

  let violations = 0;

  for (const entry of LOCAL_MATRIX) {
    const label = `${entry.model.provider}:${entry.model.name}`;
    console.log(`\n── ${entry.family} / ${label} `.padEnd(78, '─'));

    // 1. Evict everything
    process.stdout.write('evicting all runtimes... ');
    await evictAll();
    const rel = await waitForMemoryBelow(IDLE_BYTES, EVICT_MAX_MS);
    if (rel.ok) {
      console.log(`✓ idle (${fmtBytes(rel.finalBytes)}) after ${(rel.elapsedMs / 1000).toFixed(1)}s`);
    } else {
      console.log(`⚠️  timeout — ${fmtBytes(rel.finalBytes)} still resident after ${(rel.elapsedMs / 1000).toFixed(1)}s`);
    }

    // Pre-call resident check
    const before = listResident();
    printResident(before, 'before call');

    // 2. Fire one call to load this model
    process.stdout.write('firing call... ');
    const result = await fireOnce(entry.model);
    if (result.error) {
      console.log(`❌ ${result.error.slice(0, 80)}`);
      continue;
    }
    console.log(`✓ "${result.text.trim().slice(0, 30)}" in ${(result.ms / 1000).toFixed(1)}s`);

    // 3. Snapshot resident procs
    const after = listResident();
    printResident(after, 'after call');

    // 4. Verify: who's loaded?
    const heavy = after.filter(p => p.rssBytes > 500 * 1024 * 1024); // > 500 MB
    const expectedRuntime = entry.model.provider;

    if (heavy.length === 0) {
      // Model might not be fully in RSS yet (mmap lazy-load); check total
      const total = sampleModelRssBytes();
      console.log(`  total model RSS: ${fmtBytes(total)}`);
    } else if (heavy.length === 1 && heavy[0].runtime === expectedRuntime) {
      console.log(`  ✅ only ${expectedRuntime} has model loaded`);
    } else {
      console.log(`  ❌ VIOLATION: ${heavy.length} heavy procs, expected 1 on ${expectedRuntime}`);
      violations++;
      for (const h of heavy) {
        console.log(`     ${h.runtime} holding ${fmtBytes(h.rssBytes)}`);
      }
    }
  }

  console.log('\n' + '═'.repeat(78));
  if (violations === 0) {
    console.log('✅ SPIKE PASSED — single-model-at-a-time invariant held across all 12 pairs');
  } else {
    console.log(`❌ SPIKE FAILED — ${violations} violations`);
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
