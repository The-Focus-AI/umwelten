# Model Showdown Lineup: Release Dates, Availability, and Missing Models

**Date:** 2026-03-21
**Purpose:** Catalog release dates and open-weights status for current evaluation models, and identify major models missing from the lineup (Oct 2025 -- Mar 2026 releases).

---

## Part 1: Current Evaluation Models -- Release Dates and Details

### OpenAI GPT-OSS

| Model | Release Date | Open Weights? | Parameters | OpenRouter ID |
|-------|-------------|---------------|------------|---------------|
| GPT-OSS-20B | ~Mar 4, 2026 | Yes (Apache 2.0) | 21B total, 3.6B active (MoE) | `openai/gpt-oss-20b` |
| GPT-OSS-120B | ~Mar 4, 2026 | Yes (Apache 2.0) | 117B total, 5.1B active (MoE) | `openai/gpt-oss-120b` |

Sources: [OpenAI announcement](https://openai.com/index/introducing-gpt-oss/), [HuggingFace](https://huggingface.co/openai/gpt-oss-120b), [OpenRouter](https://openrouter.ai/openai/gpt-oss-120b)

### Qwen 3.5

| Model | Release Date | Open Weights? | Parameters | OpenRouter ID |
|-------|-------------|---------------|------------|---------------|
| Qwen3.5-397B-A17B | Feb 16, 2026 | Yes | 397B total, 17B active (MoE) | `qwen/qwen3.5-397b-a17b` |
| Qwen3.5-122B-A10B | Feb 24, 2026 | Yes | 122B total, 10B active (MoE) | `qwen/qwen3.5-122b-a10b` |
| Qwen3.5-35B-A3B | Feb 24, 2026 | Yes | 35B total, 3B active (MoE) | `qwen/qwen3.5-35b-a3b` |

Sources: [Qwen blog](https://qwen.ai/blog?id=qwen3.5), [GitHub](https://github.com/QwenLM/Qwen3.5), [OpenRouter](https://openrouter.ai/qwen)

### DeepSeek V3.2

| Model | Release Date | Open Weights? | Parameters | OpenRouter ID |
|-------|-------------|---------------|------------|---------------|
| DeepSeek-V3.2 | ~Jan 2026 | Yes | 685B total, 37B active (MoE) | `deepseek/deepseek-v3.2` |

Sources: [DeepSeek API docs](https://api-docs.deepseek.com/news/news251201), [OpenRouter](https://openrouter.ai/deepseek/deepseek-v3.2)

### Meta Llama 4

| Model | Release Date | Open Weights? | Parameters | OpenRouter ID |
|-------|-------------|---------------|------------|---------------|
| Llama 4 Scout (16E) | Apr 5, 2025 | Yes (Llama 4 license) | 109B total, 17B active (MoE, 16 experts) | `meta-llama/llama-4-scout` |
| Llama 4 Maverick (128E) | Apr 5, 2025 | Yes (Llama 4 license) | 400B total, 17B active (MoE, 128 experts) | `meta-llama/llama-4-maverick` |

Sources: [Meta AI blog](https://ai.meta.com/blog/llama-4-multimodal-intelligence/), [OpenRouter Maverick](https://openrouter.ai/meta-llama/llama-4-maverick), [OpenRouter Scout](https://openrouter.ai/meta-llama/llama-4-scout)

### MiniMax M2.7

| Model | Release Date | Open Weights? | Parameters | OpenRouter ID |
|-------|-------------|---------------|------------|---------------|
| MiniMax-M2.7 | Mar 18, 2026 | No (proprietary) | Undisclosed | `minimax/minimax-m2.7` |

Sources: [MiniMax](https://www.minimax.io/models/text/m27), [OpenRouter](https://openrouter.ai/minimax/minimax-m2.7)

### Moonshot Kimi K2

| Model | Release Date | Open Weights? | Parameters | OpenRouter ID |
|-------|-------------|---------------|------------|---------------|
| Kimi K2 | Jul 16, 2025 | Yes | 1T total, 32B active (MoE) | `moonshotai/kimi-k2` |

Note: The eval uses `moonshotai/kimi-k2` which maps to the K2 0711 base. Newer variants exist: K2-0905 (Sep 2025), K2-Thinking (Nov 2025), and K2.5 (Jan 27, 2026).

Sources: [HPCwire](https://www.hpcwire.com/2025/07/16/chinas-moonshot-ai-releases-trillion-parameter-model-kimi-k2/), [OpenRouter](https://openrouter.ai/moonshotai/kimi-k2)

### Inception Mercury

| Model | Release Date | Open Weights? | Parameters | OpenRouter ID |
|-------|-------------|---------------|------------|---------------|
| Mercury Coder | Feb 2025 | No (proprietary, diffusion LLM) | Undisclosed | `inception/mercury-coder` |
| Mercury 2 | Feb 24, 2026 | No (proprietary, diffusion LLM) | Undisclosed | `inception/mercury-2` |

Sources: [Inception blog](https://www.inceptionlabs.ai/blog/introducing-mercury-2), [OpenRouter Mercury-2](https://openrouter.ai/inception/mercury-2), [OpenRouter Mercury Coder](https://openrouter.ai/inception/mercury-coder)

### NVIDIA Nemotron 3

| Model | Release Date | Open Weights? | Parameters | OpenRouter ID | DeepInfra ID |
|-------|-------------|---------------|------------|---------------|-------------|
| Nemotron 3 Nano 30B | Dec 14, 2025 | Yes | 31.6B total, 3.2B active (MoE) | `nvidia/nemotron-3-nano-30b-a3b` | `nvidia/Nemotron-3-Nano-30B-A3B` |
| Nemotron 3 Super 120B | Mar 11, 2026 | Yes | 120B total, 12B active (hybrid Mamba-MoE) | `nvidia/nemotron-3-super-120b-a12b` | `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B` |

Sources: [NVIDIA Newsroom](https://nvidianews.nvidia.com/news/nvidia-debuts-nemotron-3-family-of-open-models), [NVIDIA NIM Super](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b/modelcard), [OpenRouter](https://openrouter.ai/nvidia/)

### Mistral Models

| Model | Release Date | Open Weights? | Parameters | OpenRouter ID |
|-------|-------------|---------------|------------|---------------|
| Mistral Small 3.2 24B | Jun 2025 | Yes (Apache 2.0) | 24B (dense) | `mistralai/mistral-small-3.2-24b-instruct` |
| Ministral 8B | Oct 16, 2024 | Yes (research; commercial negotiable) | 8B (dense) | `mistralai/ministral-8b-2512` |
| Codestral 2508 | Aug 1, 2025 | Yes (non-production license) | Undisclosed | `mistralai/codestral-2508` |

Note: The eval uses `ministral-8b-2512` which is actually the Dec 2025 "Ministral 3" refresh (8B variant), not the original Oct 2024 Ministral 8B.

Sources: [Mistral docs](https://docs.mistral.ai/getting-started/changelog), [OpenRouter](https://openrouter.ai/mistralai)

### Google Gemma 3

| Model | Release Date | Open Weights? | Parameters | OpenRouter ID |
|-------|-------------|---------------|------------|---------------|
| Gemma 3 27B | Mar 12, 2025 | Yes (Gemma license) | 27B (dense) | `google/gemma-3-27b-it` |

Sources: [Google AI](https://ai.google.dev/gemma/docs/releases), [OpenRouter](https://openrouter.ai/google/gemma-3-27b-it)

### Google Gemini 3 Flash Preview

| Model | Release Date | Open Weights? | Parameters | Provider |
|-------|-------------|---------------|------------|----------|
| Gemini 3 Flash Preview | Dec 17, 2025 | No (proprietary) | Undisclosed | `google` (direct API) |

Also available on OpenRouter as `google/gemini-3-flash-preview`.

Sources: [OpenRouter](https://openrouter.ai/google/gemini-3-flash-preview)

### Anthropic Claude Haiku 4.5

| Model | Release Date | Open Weights? | Parameters | OpenRouter ID |
|-------|-------------|---------------|------------|---------------|
| Claude Haiku 4.5 | Oct 15, 2025 | No (proprietary) | Undisclosed | `anthropic/claude-haiku-4.5` |

Sources: [Anthropic announcement](https://www.anthropic.com/news/claude-haiku-4-5), [OpenRouter](https://openrouter.ai/anthropic/claude-haiku-4.5)

---

## Part 2: Notable Models MISSING from the Evaluation

### High-Priority Additions (major models released Oct 2025 -- Mar 2026)

#### OpenAI GPT-4.1 Family (released Apr 14, 2025)

Pre-dates our Oct 2025 window but very widely used and directly comparable to our frontier references.

| Model | OpenRouter ID | Notes |
|-------|---------------|-------|
| GPT-4.1 | `openai/gpt-4.1-2025-04-14` | Flagship, 1M context, proprietary, undisclosed params |
| GPT-4.1 Mini | `openai/gpt-4.1-mini-2025-04-14` | Mid-tier, competitive with GPT-4o at lower cost |
| GPT-4.1 Nano | `openai/gpt-4.1-nano-2025-04-14` | Smallest, cost-optimized |

#### OpenAI GPT-4o (released May 13, 2024)

| Model | OpenRouter ID | Notes |
|-------|---------------|-------|
| GPT-4o | `openai/gpt-4o` | Older but still widely used baseline, proprietary |

#### Anthropic Claude Sonnet 4.5 (released Sep 29, 2025)

| Model | OpenRouter ID | Notes |
|-------|---------------|-------|
| Claude Sonnet 4.5 | `anthropic/claude-sonnet-4.5` | Strong frontier model, $3/$15 per M tokens, proprietary |

#### Anthropic Claude Sonnet 4.6 (released Feb 17, 2026)

| Model | OpenRouter ID | Notes |
|-------|---------------|-------|
| Claude Sonnet 4.6 | `anthropic/claude-sonnet-4.6` | Latest Sonnet, same pricing as 4.5, proprietary |

#### Anthropic Claude Sonnet 4 (released May 22, 2025)

| Model | OpenRouter ID | Notes |
|-------|---------------|-------|
| Claude Sonnet 4 | `anthropic/claude-sonnet-4` | Earlier generation but still available, proprietary |

#### xAI Grok 3 (released Feb 17, 2025)

| Model | OpenRouter ID | Notes |
|-------|---------------|-------|
| Grok 3 | `x-ai/grok-3` | xAI flagship (early 2025), proprietary |
| Grok 3 Mini | `x-ai/grok-3-mini` | Smaller thinking model, proprietary |

#### xAI Grok 4.1 Fast (released ~Nov 2025)

| Model | OpenRouter ID | Notes |
|-------|---------------|-------|
| Grok 4.1 Fast | `x-ai/grok-4.1-fast` | #1 on LMArena Elo (1483), best agentic tool calling, proprietary |

#### Moonshot Kimi K2.5 (released Jan 27, 2026)

| Model | OpenRouter ID | Notes |
|-------|---------------|-------|
| Kimi K2.5 | `moonshotai/kimi-k2.5` | Multimodal, 1T params / 32B active, open weights |

#### Google Gemini 3.1 Pro Preview (released ~Feb 2026)

| Model | OpenRouter ID | Notes |
|-------|---------------|-------|
| Gemini 3.1 Pro Preview | `google/gemini-3.1-pro-preview` | Latest Pro tier, 1M context, proprietary |

Also available via Google direct API as `gemini-3.1-pro-preview`.

### Medium-Priority Additions

| Model | Release | OpenRouter ID | Notes |
|-------|---------|---------------|-------|
| Claude 3.5 Sonnet | Jun/Oct 2024 | `anthropic/claude-3.5-sonnet` | Older but still popular baseline |
| DeepSeek V3.2 Speciale | ~Jan 2026 | `deepseek/deepseek-v3.2-speciale` | Enhanced V3.2 variant |
| Kimi K2 Thinking | Nov 6, 2025 | `moonshotai/kimi-k2-thinking` | Reasoning-focused K2 variant |
| MiniMax M2.5 | ~Feb 2026 | `minimax/minimax-m2.5` | Predecessor to M2.7, still available |
| Qwen3.5 Flash | Feb 24, 2026 | `qwen/qwen3.5-flash-20260224` | Speed-optimized Qwen3.5 |
| Qwen3.5 Plus | Feb 16, 2026 | `qwen/qwen3.5-plus-20260216` | API-only Qwen3.5 variant |

### Lower-Priority / Older Frontier References

| Model | Release | OpenRouter ID | Notes |
|-------|---------|---------------|-------|
| Grok 4 Fast | Jul 2025 | `x-ai/grok-4-fast` | Previous Grok flagship |
| GPT-5 Nano | Aug 2025 | `openai/gpt-5-nano-2025-08-07` | Fast/cheap GPT-5 tier |
| GPT-5 Mini | Aug 2025 | `openai/gpt-5-mini-2025-08-07` | Mid-tier GPT-5 |

---

## Part 3: Summary Timeline (Oct 2025 -- Mar 2026)

| Date | Model | Category |
|------|-------|----------|
| Oct 15, 2025 | Claude Haiku 4.5 | IN EVAL |
| Nov 6, 2025 | Kimi K2 Thinking | MISSING |
| Nov 24, 2025 | Claude Opus 4.5 | MISSING (expensive) |
| Dec 2, 2025 | Ministral 3 (8B/14B refresh) | IN EVAL (as ministral-8b-2512) |
| Dec 14, 2025 | Nemotron 3 Nano 30B | IN EVAL |
| Dec 17, 2025 | Gemini 3 Flash Preview | IN EVAL |
| ~Jan 2026 | DeepSeek V3.2 | IN EVAL |
| Jan 27, 2026 | Kimi K2.5 | MISSING |
| Feb 5, 2026 | Claude Opus 4.6 | MISSING (expensive) |
| Feb 16, 2026 | Qwen3.5-397B-A17B | IN EVAL |
| Feb 17, 2026 | Claude Sonnet 4.6 | MISSING |
| Feb 24, 2026 | Qwen3.5-122B, 35B | IN EVAL |
| Feb 24, 2026 | Mercury 2 | IN EVAL |
| ~Mar 4, 2026 | GPT-OSS-20B, 120B | IN EVAL |
| Mar 11, 2026 | Nemotron 3 Super 120B | IN EVAL |
| Mar 18, 2026 | MiniMax M2.7 | IN EVAL |

---

## Part 4: Recommended Additions to `SHOWDOWN_MODELS`

Based on significance, availability, and cost, here are the top candidates to add:

```typescript
// ── OpenAI Proprietary (OpenRouter) ─────────────────────────────────────────
{ name: 'openai/gpt-4.1-2025-04-14', provider: 'openrouter' },
{ name: 'openai/gpt-4.1-mini-2025-04-14', provider: 'openrouter' },
{ name: 'openai/gpt-4.1-nano-2025-04-14', provider: 'openrouter' },
{ name: 'openai/gpt-4o', provider: 'openrouter' },

// ── Anthropic (OpenRouter) ──────────────────────────────────────────────────
{ name: 'anthropic/claude-sonnet-4.5', provider: 'openrouter' },
{ name: 'anthropic/claude-sonnet-4.6', provider: 'openrouter' },

// ── xAI Grok (OpenRouter) ──────────────────────────────────────────────────
{ name: 'x-ai/grok-3-mini', provider: 'openrouter' },

// ── Moonshot Kimi K2.5 (OpenRouter) ─────────────────────────────────────────
{ name: 'moonshotai/kimi-k2.5', provider: 'openrouter' },

// ── Google Gemini 3.1 Pro (OpenRouter or direct) ────────────────────────────
{ name: 'google/gemini-3.1-pro-preview', provider: 'openrouter' },
```

**Cost warning:** Claude Sonnet 4.5/4.6 at $3/$15 per M tokens and Grok models are significantly more expensive than the open-weight models in the current lineup. GPT-4.1 is $2/$8 per M tokens. Consider running these on a subset of eval tasks rather than the full suite.

---

## References

1. [OpenAI GPT-OSS announcement](https://openai.com/index/introducing-gpt-oss/)
2. [Qwen 3.5 blog](https://qwen.ai/blog?id=qwen3.5)
3. [DeepSeek V3.2 release](https://api-docs.deepseek.com/news/news251201)
4. [Meta Llama 4 blog](https://ai.meta.com/blog/llama-4-multimodal-intelligence/)
5. [MiniMax M2.7](https://www.minimax.io/models/text/m27)
6. [Kimi K2 (HPCwire)](https://www.hpcwire.com/2025/07/16/chinas-moonshot-ai-releases-trillion-parameter-model-kimi-k2/)
7. [Kimi K2.5 (TechCrunch)](https://techcrunch.com/2026/01/27/chinas-moonshot-releases-a-new-open-source-model-kimi-k2-5-and-a-coding-agent/)
8. [Mercury 2 launch](https://www.businesswire.com/news/home/20260224034496/en/Inception-Launches-Mercury-2-the-Fastest-Reasoning-LLM-5x-Faster-Than-Leading-Speed-Optimized-LLMs-with-Dramatically-Lower-Inference-Cost)
9. [Inception Mercury Coder intro](https://www.inceptionlabs.ai/blog/introducing-mercury)
10. [NVIDIA Nemotron 3 family](https://nvidianews.nvidia.com/news/nvidia-debuts-nemotron-3-family-of-open-models)
11. [Nemotron 3 Super blog](https://developer.nvidia.com/blog/introducing-nemotron-3-super-an-open-hybrid-mamba-transformer-moe-for-agentic-reasoning/)
12. [Mistral changelog](https://docs.mistral.ai/getting-started/changelog)
13. [Ministral 8B (SiliconANGLE)](https://siliconangle.com/2024/10/16/mistral-introduces-ministral-3b-8b-device-ai-computing-models/)
14. [Google Gemma releases](https://ai.google.dev/gemma/docs/releases)
15. [Claude Haiku 4.5 announcement](https://www.anthropic.com/news/claude-haiku-4-5)
16. [Claude Wikipedia timeline](https://en.wikipedia.org/wiki/Claude_(language_model))
17. [OpenAI GPT-4.1 announcement](https://openai.com/index/gpt-4-1/)
18. [GPT-4o announcement](https://openai.com/index/hello-gpt-4o/)
19. [Grok 3 announcement](https://x.ai/news/grok-3)
20. [OpenRouter models page](https://openrouter.ai/models)
21. [OpenRouter Anthropic models](https://openrouter.ai/anthropic)
22. [OpenRouter xAI models](https://openrouter.ai/x-ai)
23. [OpenRouter OpenAI models](https://openrouter.ai/openai)
24. [DeepInfra models](https://deepinfra.com/models)
