#!/usr/bin/env node
/**
 * Local-Providers Catalog
 *
 * Enumerates models available on ollama / lmstudio / llamabarn / llamaswap,
 * prints which models overlap, and generates a llama-swap YAML config
 * that you can point `llama-swap --config` at.
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/local-providers/catalog.ts
 *   dotenvx run -- pnpm tsx examples/local-providers/catalog.ts --yaml > config.yaml
 */

import fs from 'fs';
import path from 'path';
import { createOllamaProvider } from '../../src/providers/ollama.js';
import { createLMStudioProvider } from '../../src/providers/lmstudio.js';
import { createLlamaBarnProvider } from '../../src/providers/llamabarn.js';
import { createLlamaSwapProvider } from '../../src/providers/llamaswap.js';
import { generateLlamaSwapConfig, normalizeModelName } from '../../src/providers/llamaswap-config.js';
import type { ModelDetails } from '../../src/cognition/types.js';

interface RuntimeProbe {
  id: string;
  label: string;
  host: string;
  list: () => Promise<ModelDetails[]>;
}

const RUNTIMES: RuntimeProbe[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    host: process.env.OLLAMA_HOST || 'http://localhost:11434',
    list: async () => createOllamaProvider(process.env.OLLAMA_HOST).listModels(),
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    host: process.env.LMSTUDIO_HOST || 'http://localhost:1234/v1',
    list: async () => createLMStudioProvider(process.env.LMSTUDIO_HOST).listModels(),
  },
  {
    id: 'llamabarn',
    label: 'LlamaBarn',
    host: process.env.LLAMABARN_HOST || 'http://localhost:2276/v1',
    list: async () => createLlamaBarnProvider(process.env.LLAMABARN_HOST).listModels(),
  },
  {
    id: 'llamaswap',
    label: 'llama-swap',
    host: process.env.LLAMASWAP_HOST || 'http://localhost:8080/v1',
    list: async () => createLlamaSwapProvider(process.env.LLAMASWAP_HOST).listModels(),
  },
];

// ── Name normalization ───────────────────────────────────────────────────────
// Different runtimes tag the same weights differently. We collapse them to a
// stable family key so intersections are meaningful.
//
//   ollama:      gemma4:26b
//   lmstudio:    unsloth/gemma-4-26b-a4b-it-gguf
//   llamabarn:   gemma-4-26b
//
// → normalized key: "gemma-4-26b"

function normalize(name: string): string {
  // Ollama-specific: "model:latest" → "model", "model:tag" → "model-tag"
  const ollamaStripped = name.replace(':latest', '').replace(/:/g, '-');
  return normalizeModelName(ollamaStripped);
}

// ── Collect ──────────────────────────────────────────────────────────────────

interface RuntimeResult {
  runtime: RuntimeProbe;
  available: boolean;
  models: ModelDetails[];
  error?: string;
}

async function probe(r: RuntimeProbe): Promise<RuntimeResult> {
  try {
    const models = await r.list();
    return { runtime: r, available: true, models };
  } catch (err: any) {
    return { runtime: r, available: false, models: [], error: err?.message ?? String(err) };
  }
}

// ── Output ───────────────────────────────────────────────────────────────────

function printTable(results: RuntimeResult[]) {
  console.log('\nRUNTIMES\n');
  for (const r of results) {
    const mark = r.available ? '✅' : '❌';
    const count = r.available ? `${r.models.length} models` : r.error ?? 'offline';
    console.log(`  ${mark}  ${r.runtime.label.padEnd(12)} ${r.runtime.host.padEnd(36)} ${count}`);
  }

  // Build normalized key -> {runtimeId -> model name}
  const index = new Map<string, Record<string, string>>();
  for (const r of results) {
    if (!r.available) continue;
    for (const m of r.models) {
      const key = normalize(m.name);
      if (!index.has(key)) index.set(key, {});
      index.get(key)![r.runtime.id] = m.name;
    }
  }

  // Sort: multi-runtime first, then by name
  const runtimeIds = results.filter(r => r.available).map(r => r.runtime.id);
  const rows = Array.from(index.entries())
    .map(([key, perRuntime]) => ({ key, perRuntime, count: Object.keys(perRuntime).length }))
    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));

  console.log('\nMODEL CATALOG (by normalized family)\n');
  const header = ['Family'.padEnd(32), ...runtimeIds.map(id => id.padEnd(14))].join(' ');
  console.log('  ' + header);
  console.log('  ' + '─'.repeat(header.length));
  for (const row of rows) {
    const cells = [row.key.padEnd(32), ...runtimeIds.map(id => (row.perRuntime[id] ?? '—').padEnd(14))];
    console.log('  ' + cells.join(' '));
  }

  const shared = rows.filter(r => r.count >= 2);
  console.log(`\nShared across ≥2 runtimes: ${shared.length} families`);
  const onAll = rows.filter(r => r.count === runtimeIds.length && runtimeIds.length > 1);
  if (onAll.length > 0) {
    console.log(`Available on ALL ${runtimeIds.length} runtimes:`);
    onAll.forEach(r => console.log(`  • ${r.key}`));
  }
}

// llama-swap YAML generation is delegated to the library:
//   src/providers/llamaswap-config.ts
// Or via CLI:
//   umwelten models llamaswap-config [--output file.yaml]

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const wantYaml = process.argv.includes('--yaml');

  if (!wantYaml) {
    console.log('🔬 Local-Providers Catalog');
    console.log('═'.repeat(70));
  }

  const results = await Promise.all(RUNTIMES.map(probe));

  if (wantYaml) {
    const { yaml, models } = generateLlamaSwapConfig();
    process.stdout.write(yaml);
    process.stderr.write(`\n# Found ${models.length} GGUF models in cache paths\n`);
    return;
  }

  printTable(results);

  const { models } = generateLlamaSwapConfig();
  console.log(`\nGGUF models found in cache paths: ${models.length}`);
  if (models.length > 0) {
    console.log('To generate llama-swap config:');
    console.log('  pnpm run cli models llamaswap-config --output examples/local-providers/llama-swap.yaml');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
