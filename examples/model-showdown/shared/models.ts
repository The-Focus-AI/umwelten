import type { ModelDetails } from '../../../src/cognition/types.js';

// ── Quick local test (3 models) ──────────────────────────────────────────────
export const LOCAL_TEST_MODELS: ModelDetails[] = [
  { name: 'gemini-3-flash-preview', provider: 'google' },
  { name: 'nvidia/Nemotron-3-Nano-30B-A3B', provider: 'deepinfra' },
  { name: 'openai/gpt-oss-20b', provider: 'openrouter' },
];

// ── The Showdown Lineup ──────────────────────────────────────────────────────
// Latest of everything. Duplicates kept for cross-provider comparison.
// "Is it worth it?" — benchmark across price tiers to find out.
export const SHOWDOWN_MODELS: ModelDetails[] = [

  // ═══════════════════════════════════════════════════════════════════════════
  // PREMIUM TIER ($5+ per M output tokens)
  // ═══════════════════════════════════════════════════════════════════════════

  // Anthropic Claude Opus 4.6 — $5/$25, Feb 2026, closed
  { name: 'anthropic/claude-opus-4.6', provider: 'openrouter' },

  // ═══════════════════════════════════════════════════════════════════════════
  // HIGH TIER ($2-5 per M output tokens)
  // ═══════════════════════════════════════════════════════════════════════════

  // OpenAI GPT-5.4 — $2.5/$15, Mar 2026, closed
  { name: 'openai/gpt-5.4', provider: 'openrouter' },
  // Anthropic Claude Sonnet 4.6 — $3/$15, Feb 2026, closed
  { name: 'anthropic/claude-sonnet-4.6', provider: 'openrouter' },
  // Google Gemini 3.1 Pro — $2/$12, Feb 2026, closed (OpenRouter)
  { name: 'google/gemini-3.1-pro-preview', provider: 'openrouter' },
  // Google Gemini 3.1 Pro — direct API for cross-provider comparison
  { name: 'gemini-3.1-pro-preview', provider: 'google' },
  // xAI Grok 4.20 — $2/$6, Mar 2026, closed
  { name: 'x-ai/grok-4.20-beta', provider: 'openrouter' },

  // ═══════════════════════════════════════════════════════════════════════════
  // MID TIER ($0.50-2 per M output tokens)
  // ═══════════════════════════════════════════════════════════════════════════

  // OpenAI GPT-5.4 Mini — $0.75/$4.5, Mar 2026, closed
  { name: 'openai/gpt-5.4-mini', provider: 'openrouter' },
  // Anthropic Claude Haiku 4.5 — $1/$5, Oct 2025, closed (latest Haiku)
  { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' },
  // Google Gemini 3 Flash — direct API, Dec 2025, closed
  { name: 'gemini-3-flash-preview', provider: 'google' },
  // Moonshot Kimi K2.5 — $0.45/$2.2, Jan 2026, open
  { name: 'moonshotai/kimi-k2.5', provider: 'openrouter' },
  // Moonshot Kimi K2 — $0.47/$2, Jul 2025, open
  { name: 'moonshotai/kimi-k2', provider: 'openrouter' },

  // ═══════════════════════════════════════════════════════════════════════════
  // VALUE TIER ($0.05-0.50 per M output tokens)
  // ═══════════════════════════════════════════════════════════════════════════

  // OpenAI GPT-5.4 Nano — $0.2/$1.25, Mar 2026, closed
  { name: 'openai/gpt-5.4-nano', provider: 'openrouter' },
  // xAI Grok 4.1 Fast — $0.2/$0.5, Nov 2025, closed
  { name: 'x-ai/grok-4.1-fast', provider: 'openrouter' },
  // Qwen 3.5 397B MoE — $0.39/$2.34, Feb 2026, open
  { name: 'qwen/qwen3.5-397b-a17b', provider: 'openrouter' },
  // Qwen 3.5 122B MoE — $0.26/$2.08, Feb 2026, open
  { name: 'qwen/qwen3.5-122b-a10b', provider: 'openrouter' },
  // Qwen 3.5 35B MoE — $0.16/$1.30, Feb 2026, open
  { name: 'qwen/qwen3.5-35b-a3b', provider: 'openrouter' },
  // DeepSeek V3.2 685B MoE — $0.26/$0.38, Dec 2025, open
  { name: 'deepseek/deepseek-v3.2', provider: 'openrouter' },
  // MiniMax M2.7 — $0.30/$1.20, Mar 2026, closed
  { name: 'minimax/minimax-m2.7', provider: 'openrouter' },
  // Inception Mercury 2 — $0.25/$0.75, Mar 2026, closed (diffusion LLM)
  { name: 'inception/mercury-2', provider: 'openrouter' },
  // Inception Mercury Coder — $0.25/$0.75, Feb 2025, closed
  { name: 'inception/mercury-coder', provider: 'openrouter' },
  // Mistral Small 2603 — $0.15/$0.60, Mar 2026, open (latest small)
  { name: 'mistralai/mistral-small-2603', provider: 'openrouter' },

  // ═══════════════════════════════════════════════════════════════════════════
  // BUDGET TIER (<$0.05 per M output tokens)
  // ═══════════════════════════════════════════════════════════════════════════

  // OpenAI GPT-OSS 120B — $0.007, Mar 2026, open (Apache 2.0)
  { name: 'openai/gpt-oss-120b', provider: 'openrouter' },
  // OpenAI GPT-OSS 20B — $0.02, Mar 2026, open (Apache 2.0)
  { name: 'openai/gpt-oss-20b', provider: 'openrouter' },
  // Meta Llama 4 Maverick 400B MoE — $0.01, Apr 2025, open
  { name: 'meta-llama/llama-4-maverick', provider: 'openrouter' },
  // Meta Llama 4 Scout 109B MoE — $0.004, Apr 2025, open
  { name: 'meta-llama/llama-4-scout', provider: 'openrouter' },
  // Mistral Codestral — $0.01, Aug 2025, open
  { name: 'mistralai/codestral-2508', provider: 'openrouter' },
  // Mistral Ministral 8B — $0.005, Dec 2025, open
  { name: 'mistralai/ministral-8b-2512', provider: 'openrouter' },
  // Google Gemma 3 27B — $0.001, Mar 2025, open
  { name: 'google/gemma-3-27b-it', provider: 'openrouter' },

  // ═══════════════════════════════════════════════════════════════════════════
  // FREE TIER (cross-provider duplicates)
  // ═══════════════════════════════════════════════════════════════════════════

  // NVIDIA Nemotron 3 Super 120B (OpenRouter free) — Mar 2026, open
  { name: 'nvidia/nemotron-3-super-120b-a12b:free', provider: 'openrouter' },
  // NVIDIA Nemotron 3 Nano 30B (OpenRouter free) — Dec 2025, open
  { name: 'nvidia/nemotron-3-nano-30b-a3b:free', provider: 'openrouter' },

  // ═══════════════════════════════════════════════════════════════════════════
  // DEEPINFRA DUPLICATES (same weights, different host — compare inference)
  // ═══════════════════════════════════════════════════════════════════════════

  // NVIDIA Nemotron 3 Super 120B (DeepInfra) — Mar 2026, open
  { name: 'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B', provider: 'deepinfra' },
  // NVIDIA Nemotron 3 Nano 30B (DeepInfra) — Dec 2025, open
  { name: 'nvidia/Nemotron-3-Nano-30B-A3B', provider: 'deepinfra' },

  // ═══════════════════════════════════════════════════════════════════════════
  // LOCAL (Ollama — free, on-device, compare local vs hosted)
  // ═══════════════════════════════════════════════════════════════════════════

  { name: 'nemotron-3-nano:latest', provider: 'ollama' },
  { name: 'nemotron-3-nano:4b', provider: 'ollama' },
  { name: 'glm-4.7-flash:latest', provider: 'ollama' },
  { name: 'devstral:latest', provider: 'ollama' },
  { name: 'phi4:latest', provider: 'ollama' },
  { name: 'mistral-small:latest', provider: 'ollama' },
  { name: 'gemma3n:e4b', provider: 'ollama' },
  { name: 'deepseek-r1:latest', provider: 'ollama' },
  { name: 'qwen3:30b-a3b', provider: 'ollama' },
  { name: 'qwen3:32b', provider: 'ollama' },
  { name: 'deepseek-r1:14b', provider: 'ollama' },
  { name: 'deepseek-r1:32b', provider: 'ollama' },
  { name: 'gpt-oss:latest', provider: 'ollama' },
];

// ── Models that support reasoning effort levels ─────────────────────────────
// These get expanded into base + low/medium/high variants.
// "Is thinking worth it?" — same model, different reasoning budgets.
export const THINKING_MODELS: ModelDetails[] = [
  // Anthropic (thinking via budget_tokens)
  { name: 'anthropic/claude-opus-4.6', provider: 'openrouter' },
  { name: 'anthropic/claude-sonnet-4.6', provider: 'openrouter' },
  { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' },
  // OpenAI (reasoning via effort)
  { name: 'openai/gpt-5.4', provider: 'openrouter' },
  { name: 'openai/gpt-5.4-mini', provider: 'openrouter' },
  // Google (thinking via thinkingConfig budget)
  { name: 'gemini-3.1-pro-preview', provider: 'google' },
  { name: 'gemini-3-flash-preview', provider: 'google' },
  // xAI
  { name: 'x-ai/grok-4.20-beta', provider: 'openrouter' },
];

// ── Full lineup with reasoning variants ─────────────────────────────────────
// Base models run as-is. Thinking models also run at low/medium/high.
export function getFullShowdownLineup(): ModelDetails[] {
  const base = [...SHOWDOWN_MODELS];
  const thinkingExpanded = expandWithReasoningEfforts(THINKING_MODELS, ['low', 'medium', 'high']);
  // Merge: base models + thinking variants (skip base dupes already in SHOWDOWN_MODELS)
  const baseKeys = new Set(base.map(m => modelKey(m)));
  for (const m of thinkingExpanded) {
    const key = modelKey(m);
    if (!baseKeys.has(key)) {
      base.push(m);
      baseKeys.add(key);
    }
  }
  return base;
}

/** Expand models with reasoning effort variants */
export function expandWithReasoningEfforts(
  models: ModelDetails[],
  efforts: Array<'low' | 'medium' | 'high'>
): ModelDetails[] {
  const expanded: ModelDetails[] = [];
  for (const model of models) {
    expanded.push(model); // default (no effort set)
    for (const effort of efforts) {
      expanded.push({ ...model, reasoningEffort: effort });
    }
  }
  return expanded;
}

/** Get model label for display */
export function modelLabel(model: ModelDetails): string {
  const effort = model.reasoningEffort ? `[${model.reasoningEffort}]` : '';
  return `${model.provider}:${model.name}${effort}`;
}

/** Get model key for file caching (filesystem-safe) */
export function modelKey(model: ModelDetails): string {
  const effort = model.reasoningEffort ? `-effort-${model.reasoningEffort}` : '';
  return `${model.name.replace(/[\/:]/g, '-')}-${model.provider}${effort}`;
}
