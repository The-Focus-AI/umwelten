/**
 * Clean 2026 Fast Models Roster for Umwelten examples and Model Watch.
 *
 * Every cloud slug matches `@earendil-works/pi-ai` `builtinModels()` directly
 * (no custom provider wrappers; Gemini 3.x+ and Gemini 4 only — never Gemini 2).
 * Local entries target `llama-swap` (`llama-server -np 4`) for continuous batching
 * when run with `--live` on a developer workstation.
 */

import type { ModelSpec } from "@umwelten/pi";

export interface FastModelEntry extends ModelSpec {
  family: "gemini" | "frontier-fast" | "wafer-open" | "local";
  weights: "open" | "closed";
  tier: "cloud" | "local";
  tagline: string;
}

export const FAST_MODEL_ROSTER: FastModelEntry[] = [
  // ── Google Gemini Fast (3.x+ and 4.x) ─────────────────────────────────────
  {
    provider: "google",
    name: "gemini-4-hydrogen",
    family: "gemini",
    weights: "closed",
    tier: "cloud",
    costs: { promptTokens: 1.5, completionTokens: 7.5 },
    tagline: "Fast Gemini 4 everyday coding & reasoning model (1M context).",
  },
  {
    provider: "google",
    name: "gemini-3.8-flash",
    family: "gemini",
    weights: "closed",
    tier: "cloud",
    costs: { promptTokens: 0.75, completionTokens: 3.75 },
    tagline: "Current Gemini 3.8 Flash workhorse balancing speed, tools, and code.",
  },
  {
    provider: "google",
    name: "gemini-3.5-flash-lite",
    family: "gemini",
    weights: "closed",
    tier: "cloud",
    costs: { promptTokens: 0.3, completionTokens: 2.5 },
    tagline: "Low-latency Gemini 3.5 Flash-Lite for high-volume structured turns.",
  },
  {
    provider: "google",
    name: "gemini-3.1-flash-lite",
    family: "gemini",
    weights: "closed",
    tier: "cloud",
    costs: { promptTokens: 0.25, completionTokens: 1.5 },
    tagline: "Sub-quarter Flash-Lite tier ($0.25/$1.50 per M tokens).",
  },
  {
    provider: "google",
    name: "gemini-3-flash-preview",
    family: "gemini",
    weights: "closed",
    tier: "cloud",
    costs: { promptTokens: 0.5, completionTokens: 3.0 },
    tagline: "Proven Gemini 3 Flash baseline from the 48-model showdown.",
  },

  // ── Clean Frontier Fast (Anthropic, OpenAI, xAI) ──────────────────────────
  {
    provider: "anthropic",
    name: "claude-haiku-5-5",
    family: "frontier-fast",
    weights: "closed",
    tier: "cloud",
    costs: { promptTokens: 0.1, completionTokens: 0.5 },
    tagline: "1M-context Haiku 5.5 at $0.10/$0.50 per M — 10× cheaper than Haiku 4.5.",
  },
  {
    provider: "anthropic",
    name: "claude-sonnet-5-5",
    family: "frontier-fast",
    weights: "closed",
    tier: "cloud",
    costs: { promptTokens: 2.0, completionTokens: 10.0 },
    tagline: "Mid-size frontier ceiling for multi-step coding and tool orchestration.",
  },
  {
    provider: "openai",
    name: "gpt-6-luna",
    family: "frontier-fast",
    weights: "closed",
    tier: "cloud",
    costs: { promptTokens: 0.1, completionTokens: 0.5 },
    tagline: "OpenAI's smallest, lowest-cost GPT-6 model ($0.10/$0.50 per M).",
  },
  {
    provider: "openai",
    name: "gpt-6.1-terra",
    family: "frontier-fast",
    weights: "closed",
    tier: "cloud",
    costs: { promptTokens: 1.0, completionTokens: 5.0 },
    tagline: "Fast, low-cost GPT-6.1 model for well-defined coding tasks.",
  },
  {
    provider: "xai",
    name: "grok-4.3",
    family: "frontier-fast",
    weights: "closed",
    tier: "cloud",
    costs: { promptTokens: 1.25, completionTokens: 2.5 },
    tagline: "Fastest low-output-cost Grok 4 release.",
  },

  // ── Wafer / LPU & Clean Open-Weight Flash ─────────────────────────────────
  {
    provider: "cerebras",
    name: "gpt-oss-120b",
    family: "wafer-open",
    weights: "open",
    tier: "cloud",
    costs: { promptTokens: 0.35, completionTokens: 0.75 },
    tagline: "Wafer-scale inference (2,000+ tok/s) on open-weight GPT-OSS 120B.",
  },
  {
    provider: "groq",
    name: "openai/gpt-oss-20b",
    family: "wafer-open",
    weights: "open",
    tier: "cloud",
    costs: { promptTokens: 0.075, completionTokens: 0.3 },
    tagline: "LPU-accelerated GPT-OSS 20B with sub-100ms time to first token.",
  },
  {
    provider: "openrouter",
    name: "deepseek/deepseek-v4.1-flash",
    family: "wafer-open",
    weights: "open",
    tier: "cloud",
    costs: { promptTokens: 0.15, completionTokens: 0.6 },
    tagline: "1M-context DeepSeek v4.1 Flash; strong tool caller, watch <think> loops.",
  },
  {
    provider: "openrouter",
    name: "z-ai/glm-5.3-flash",
    family: "wafer-open",
    weights: "open",
    tier: "cloud",
    costs: { promptTokens: 0.04, completionTokens: 0.08 },
    tagline: "Ultra-budget open flash model ($0.04/$0.08 per M on OpenRouter).",
  },
  {
    provider: "openrouter",
    name: "qwen/qwen3.8-flash",
    family: "wafer-open",
    weights: "open",
    tier: "cloud",
    costs: { promptTokens: 0.15, completionTokens: 0.47 },
    tagline: "Alibaba's 1M-context Qwen 3.8 Flash.",
  },
  {
    provider: "openrouter",
    name: "minimax/minimax-m3.1-flash",
    family: "wafer-open",
    weights: "open",
    tier: "cloud",
    costs: { promptTokens: 0.15, completionTokens: 0.6 },
    tagline: "MiniMax M3.1 Flash (1M context; also native via minimax provider).",
  },

  // ── Local Fast Runtimes (run on device with `--live` via llama-swap) ──────
  {
    provider: "llamaswap",
    name: "gemma-4-26b",
    family: "local",
    weights: "open",
    tier: "local",
    costs: { promptTokens: 0, completionTokens: 0 },
    tagline: "26B A4B MoE on llama-server (-np 4); 288.5 agg tok/s at c=4 on M4 Max.",
  },
  {
    provider: "llamaswap",
    name: "gpt-oss-20b",
    family: "local",
    weights: "open",
    tier: "local",
    costs: { promptTokens: 0, completionTokens: 0 },
    tagline: "20B MXFP4 local coder/reasoner; 332.8 agg tok/s at c=4 on M4 Max.",
  },
  {
    provider: "llamaswap",
    name: "nemotron-3-nano-4b",
    family: "local",
    weights: "open",
    tier: "local",
    costs: { promptTokens: 0, completionTokens: 0 },
    tagline: "Compact 4B local reasoner; 389.1 agg tok/s (4.4× batch scaling) at c=4.",
  },
  {
    provider: "llamaswap",
    name: "gemma-4-e2b",
    family: "local",
    weights: "open",
    tier: "local",
    costs: { promptTokens: 0, completionTokens: 0 },
    tagline: "2B effective edge sprinter; 1,014.3 agg tok/s (6.8× batch scaling) at c=4.",
  },
];

/** Concise 5-model fast slice used by quick standalone example scripts. */
export const QUICK_FAST_MODELS: FastModelEntry[] = [
  FAST_MODEL_ROSTER.find((m) => m.name === "gemini-3.8-flash")!,
  FAST_MODEL_ROSTER.find((m) => m.name === "gemini-3.1-flash-lite")!,
  FAST_MODEL_ROSTER.find((m) => m.name === "claude-haiku-5-5")!,
  FAST_MODEL_ROSTER.find((m) => m.name === "gpt-oss-120b")!,
  FAST_MODEL_ROSTER.find((m) => m.name === "gemma-4-26b")!,
];

export const DEFAULT_FAST_JUDGE: ModelSpec = {
  provider: "google",
  name: "gemini-3.8-flash",
};
