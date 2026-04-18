import type { ModelDetails } from '../../../src/cognition/types.js';

/**
 * Local-Providers matrix.
 *
 * Each entry is a (runtime, model) pair. Models in the same `family` are
 * "the same weights on a different runtime" and will be compared head-to-head.
 *
 * Edit this file to match what's actually loaded on your machine.
 * Use `examples/local-providers/catalog.ts` to discover available models.
 */

export interface LocalEntry {
  family: string;
  model: ModelDetails;
}

/**
 * Primary matrix — quality + speed comparison.
 * Gemma 4 26B (~17 GB Q4) hits 4 runtimes.
 * Nemotron and GPT-OSS are included where available.
 */
export const LOCAL_MATRIX: LocalEntry[] = [
  // Gemma 4 26B A4B — the focal model
  { family: 'gemma-4-26b', model: { name: 'gemma4:26b', provider: 'ollama' } },
  { family: 'gemma-4-26b', model: { name: 'unsloth/gemma-4-26b-a4b-it-gguf', provider: 'lmstudio' } },
  { family: 'gemma-4-26b', model: { name: 'unsloth/gemma-4-26B-A4B-it-GGUF:Q4_K_M', provider: 'llamabarn' } },
  { family: 'gemma-4-26b', model: { name: 'gemma-4-26b-a4b', provider: 'llamaswap' } },

  // Nemotron Nano 4B (small baseline) — verify small model performance
  { family: 'nemotron-nano-4b', model: { name: 'unsloth/NVIDIA-Nemotron-3-Nano-4B-GGUF:Q8_0', provider: 'llamabarn' } },

  // GPT-OSS 20B (secondary) — where loaded
  { family: 'gpt-oss-20b', model: { name: 'gpt-oss-20b', provider: 'llamabarn' } },
];

/**
 * Frontier reference — what you'd use if you didn't have local.
 * Primary: Gemini 3 Flash (cheap, fast, frontier-ish).
 * Ceiling: Claude Opus 4.7 (expensive, best).
 */
export const FRONTIER_REFERENCE: ModelDetails[] = [
  { name: 'gemini-3-flash-preview', provider: 'google' },
  { name: 'anthropic/claude-opus-4.7', provider: 'openrouter' },
];

/**
 * Just the local models (for quality suite runs).
 * Frontier models are opt-in via `--frontier` flag.
 */
export const LOCAL_MODELS: ModelDetails[] = LOCAL_MATRIX.map(e => e.model);

export const ALL_MODELS: ModelDetails[] = [...LOCAL_MODELS, ...FRONTIER_REFERENCE];

export function includeFrontier(): boolean {
  return process.argv.includes('--frontier');
}

export function modelLabel(m: ModelDetails): string {
  return `${m.provider}:${m.name}`;
}

export function modelKey(m: ModelDetails): string {
  return `${m.name.replace(/[\/:]/g, '-')}-${m.provider}`;
}

/**
 * Look up the family for a model (for grouping "same weights" in reports).
 * Returns `provider:model` if not a local matrix entry.
 */
export function familyFor(m: ModelDetails): string {
  const entry = LOCAL_MATRIX.find(e =>
    e.model.provider === m.provider && e.model.name === m.name
  );
  if (entry) return entry.family;
  return `frontier:${m.provider}`;
}
