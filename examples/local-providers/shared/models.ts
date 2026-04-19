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
  // Gemma 4 26B A4B — 3-way comparison
  { family: 'gemma-4-26b-a4b', model: { name: 'gemma4:26b', provider: 'ollama' } },
  { family: 'gemma-4-26b-a4b', model: { name: 'gemma-4-26b-a4b', provider: 'llamabarn' } },
  { family: 'gemma-4-26b-a4b', model: { name: 'gemma-4-26b-a4b', provider: 'llamaswap' } },

  // GLM 4.7 Flash — 3-way comparison
  { family: 'glm-4-7-flash', model: { name: 'glm-4.7-flash:latest', provider: 'ollama' } },
  { family: 'glm-4-7-flash', model: { name: 'glm-4.7-flash', provider: 'llamabarn' } },
  { family: 'glm-4-7-flash', model: { name: 'glm-4-7-flash', provider: 'llamaswap' } },

  // GPT-OSS 20B — 3-way comparison
  { family: 'gpt-oss-20b', model: { name: 'gpt-oss:latest', provider: 'ollama' } },
  { family: 'gpt-oss-20b', model: { name: 'gpt-oss-20b', provider: 'llamabarn' } },
  { family: 'gpt-oss-20b', model: { name: 'gpt-oss-20b', provider: 'llamaswap' } },

  // NVIDIA Nemotron-3-Nano-4B — 3-way small-model baseline
  { family: 'nvidia-nemotron-3-nano-4b', model: { name: 'nemotron-3-nano:4b', provider: 'ollama' } },
  { family: 'nvidia-nemotron-3-nano-4b', model: { name: 'unsloth/NVIDIA-Nemotron-3-Nano-4B-GGUF:Q8_0', provider: 'llamabarn' } },
  { family: 'nvidia-nemotron-3-nano-4b', model: { name: 'nvidia-nemotron-3-nano-4b', provider: 'llamaswap' } },
];

/**
 * No-thinking variants — same weights + same runtime, but with
 * `chat_template_kwargs.enable_thinking=false` injected into every request.
 * Disables the model's hidden reasoning tokens (GLM, Gemma's `<think>`
 * blocks, etc.). Answers the question: "how much of the time cost on
 * llamaswap/llamabarn is thinking-mode overhead, and does turning it off
 * hurt scores?"
 *
 * Ollama models have no "-nothink" entries because Ollama's defaults
 * already behave this way for these models (no --jinja, no <think> blocks).
 */
export const LOCAL_MATRIX_NOTHINK: LocalEntry[] = [
  { family: 'gemma-4-26b-a4b', model: { name: 'gemma-4-26b-a4b', provider: 'llamabarn-nothink' } },
  { family: 'gemma-4-26b-a4b', model: { name: 'gemma-4-26b-a4b', provider: 'llamaswap-nothink' } },

  { family: 'glm-4-7-flash', model: { name: 'glm-4.7-flash', provider: 'llamabarn-nothink' } },
  { family: 'glm-4-7-flash', model: { name: 'glm-4-7-flash', provider: 'llamaswap-nothink' } },

  { family: 'gpt-oss-20b', model: { name: 'gpt-oss-20b', provider: 'llamabarn-nothink' } },
  { family: 'gpt-oss-20b', model: { name: 'gpt-oss-20b', provider: 'llamaswap-nothink' } },

  { family: 'nvidia-nemotron-3-nano-4b', model: { name: 'unsloth/NVIDIA-Nemotron-3-Nano-4B-GGUF:Q8_0', provider: 'llamabarn-nothink' } },
  { family: 'nvidia-nemotron-3-nano-4b', model: { name: 'nvidia-nemotron-3-nano-4b', provider: 'llamaswap-nothink' } },
];

/** Thinking matrix + no-thinking matrix. Used when the caller wants to
 *  run the full cross-product (20 entries total). */
export const LOCAL_MATRIX_ALL: LocalEntry[] = [
  ...LOCAL_MATRIX,
  ...LOCAL_MATRIX_NOTHINK,
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
