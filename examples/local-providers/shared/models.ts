import type { ModelDetails } from '@umwelten/core/cognition/types.js';

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
 *
 * All weights are Q4_K_M across runtimes (apples-to-apples), except gpt-oss
 * which ships natively as MXFP4. This eliminates the Q4-vs-Q8 confound from
 * earlier runs where llamabarn/llamaswap served Q8_0 while ollama served Q4.
 *
 * Runtimes: ollama + llamaswap only. LlamaBarn is dropped because its
 * `LlamaBarn.app` rewrites `~/.llamabarn/models.ini` at every launch,
 * stripping custom ctx-size settings down to 4096 — that silently truncates
 * long generations and violates the "context as high as the provider allows"
 * rule. llamaswap uses llama-server directly, so we control ctx-size (0 =
 * model max).
 *
 * GGUF sources (llamaswap):
 *   gemma-4-e2b      → unsloth/gemma-4-E2B-it-GGUF:Q4_K_M
 *   gemma-4-e4b      → ggml-org/gemma-4-E4B-it-GGUF:Q4_K_M
 *   gemma-4-26b-a4b  → ggml-org/gemma-4-26B-A4B-it-GGUF:Q4_K_M
 *   gemma-4-31b      → ggml-org/gemma-4-31B-it-GGUF:Q4_K_M
 *   glm-4.7-flash    → unsloth/GLM-4.7-Flash-GGUF:Q4_K_M (ggml-org has no Q4)
 *   gpt-oss-20b      → ggml-org/gpt-oss-20b-GGUF (MXFP4 native)
 *   nemotron-3-nano  → unsloth/NVIDIA-Nemotron-3-Nano-4B-GGUF:Q4_K_M
 *   qwen3.6-27b      → unsloth/Qwen3.6-27B-GGUF:Q4_K_M
 */
export const LOCAL_MATRIX: LocalEntry[] = [
  // Gemma 4 E2B
  { family: 'gemma-4-e2b', model: { name: 'gemma4:e2b', provider: 'ollama' } },
  { family: 'gemma-4-e2b', model: { name: 'gemma-4-e2b', provider: 'llamaswap' } },

  // Gemma 4 E4B / 8B class (pin copied from gemma4:latest)
  { family: 'gemma-4-e4b', model: { name: 'gemma4:e4b', provider: 'ollama' } },
  { family: 'gemma-4-e4b', model: { name: 'gemma-4-e4b', provider: 'llamaswap' } },

  // Gemma 4 26B A4B
  { family: 'gemma-4-26b-a4b', model: { name: 'gemma4:26b', provider: 'ollama' } },
  { family: 'gemma-4-26b-a4b', model: { name: 'gemma-4-26b-a4b', provider: 'llamaswap' } },

  // Gemma 4 31B
  { family: 'gemma-4-31b', model: { name: 'gemma4:31b', provider: 'ollama' } },
  { family: 'gemma-4-31b', model: { name: 'gemma-4-31b', provider: 'llamaswap' } },

  // GLM 4.7 Flash
  { family: 'glm-4-7-flash', model: { name: 'glm-4.7-flash:latest', provider: 'ollama' } },
  { family: 'glm-4-7-flash', model: { name: 'glm-4-7-flash', provider: 'llamaswap' } },

  // GPT-OSS 20B (MXFP4 native, not quantized)
  { family: 'gpt-oss-20b', model: { name: 'gpt-oss:latest', provider: 'ollama' } },
  { family: 'gpt-oss-20b', model: { name: 'gpt-oss-20b', provider: 'llamaswap' } },

  // NVIDIA Nemotron-3-Nano-4B — small-model baseline
  { family: 'nvidia-nemotron-3-nano-4b', model: { name: 'nemotron-3-nano:4b', provider: 'ollama' } },
  { family: 'nvidia-nemotron-3-nano-4b', model: { name: 'nvidia-nemotron-3-nano-4b', provider: 'llamaswap' } },

  // Qwen3.6 27B — dense, released 2026-04-22
  { family: 'qwen3-6-27b', model: { name: 'qwen3.6:27b', provider: 'ollama' } },
  { family: 'qwen3-6-27b', model: { name: 'qwen3-6-27b', provider: 'llamaswap' } },
];

/**
 * No-thinking variants — same weights + same runtime, but with
 * `chat_template_kwargs.enable_thinking=false` injected into every request.
 * Disables the model's hidden reasoning tokens (GLM, Gemma's `<think>`
 * blocks, etc.). Answers the question: "how much of the time cost on
 * llamaswap is thinking-mode overhead, and does turning it off hurt scores?"
 *
 * Ollama models have no "-nothink" entries because Ollama's defaults
 * already behave this way for these models (no --jinja, no <think> blocks).
 */
export const LOCAL_MATRIX_NOTHINK: LocalEntry[] = [
  { family: 'gemma-4-e2b', model: { name: 'gemma-4-e2b', provider: 'llamaswap-nothink' } },
  { family: 'gemma-4-e4b', model: { name: 'gemma-4-e4b', provider: 'llamaswap-nothink' } },
  { family: 'gemma-4-26b-a4b', model: { name: 'gemma-4-26b-a4b', provider: 'llamaswap-nothink' } },
  { family: 'gemma-4-31b', model: { name: 'gemma-4-31b', provider: 'llamaswap-nothink' } },
  { family: 'glm-4-7-flash', model: { name: 'glm-4-7-flash', provider: 'llamaswap-nothink' } },
  { family: 'gpt-oss-20b', model: { name: 'gpt-oss-20b', provider: 'llamaswap-nothink' } },
  { family: 'nvidia-nemotron-3-nano-4b', model: { name: 'nvidia-nemotron-3-nano-4b', provider: 'llamaswap-nothink' } },
  { family: 'qwen3-6-27b', model: { name: 'qwen3-6-27b', provider: 'llamaswap-nothink' } },
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
