# LLM Models Landscape -- February 2026

A concise reference of the latest models available via API from each major provider, current as of February 24, 2026.

---

## Google (Gemini)

**Newer than gemini-3-flash-preview and gemini-3-pro-preview: YES**

| Model | API ID | Notes |
|-------|--------|-------|
| Gemini 3.1 Pro Preview | `gemini-3.1-pro-preview` | Latest flagship. 1M context. Most advanced model for complex tasks. [Source](https://deepmind.google/models/model-cards/gemini-3-1-pro/) |
| Gemini 3 Pro Preview | `gemini-3-pro-preview` | Previous Pro tier. No free tier in API. |
| Gemini 3 Flash Preview | `gemini-3-flash-preview` | Fast thinking model. Free tier available. [Source](https://ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview) |
| Gemini 2.5 Flash | `gemini-2.5-flash` | Budget multimodal. Retiring June 2026. |
| Gemini 2.0 Flash | `gemini-2.0-flash` | $0.10/M input. Retiring June 1, 2026. |

**Key update:** Gemini 3.1 Pro Preview is new since your list. There does not appear to be a Gemini 3.1 Flash yet -- only 3.1 Pro.

---

## Anthropic (Claude)

**Newer than claude-opus-4, claude-sonnet-4.5, claude-sonnet-4: YES**

| Model | API ID | Release Date | Notes |
|-------|--------|-------------|-------|
| Claude Opus 4.6 | `claude-opus-4-6` | Feb 5, 2026 | Latest flagship. Agent teams. Found 500+ zero-day vulnerabilities. [Source](https://www.anthropic.com/claude/opus) |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | Feb 17, 2026 | 1M context (beta). Same price as Sonnet 4.5. [Source](https://www.anthropic.com/news/claude-sonnet-4-6) |
| Claude Opus 4.1 | `claude-opus-4-1-20250805` | Aug 2025 | Still available. [Source](https://www.anthropic.com/news/claude-opus-4-1) |
| Claude Sonnet 4.5 | `claude-sonnet-4-5-20241022` | Oct 2024 | |
| Claude Haiku 4.5 | `claude-haiku-4-5-20241022` | Oct 2025 | Fastest/cheapest. |

**Key update:** Opus 4.6 and Sonnet 4.6 are both new since your list. There is no Haiku 4.6 yet.

---

## OpenAI

**Newer than gpt-5.2, o4-mini: YES (partially)**

### GPT-5 Family
| Model | Notes |
|-------|-------|
| GPT-5.3-Codex | Latest. Agentic coding model. Feb 5, 2026. Not yet in general API -- Codex app/CLI/IDE only. [Source](https://openai.com/index/introducing-gpt-5-3-codex/) |
| GPT-5.3-Codex-Spark | Smaller/faster variant. 1000+ tok/s. Feb 12, 2026. Research preview. [Source](https://openai.com/index/introducing-gpt-5-3-codex-spark/) |
| GPT-5.2 | Flagship. 400K context. Three variants: Instant, Thinking, Pro. Dec 2025. |
| GPT-5.2-Codex | Coding variant. Jan 14, 2026. |
| GPT-5.1 | Previous generation. Still available. |
| GPT-5 mini | Small model. Succeeded o4-mini. |
| GPT-5 nano | Smallest/cheapest. |

### O-Series (Reasoning)
| Model | Notes |
|-------|-------|
| o3 | Most intelligent reasoning model. Succeeded by GPT-5 for general use. [Source](https://openai.com/index/introducing-o3-and-o4-mini/) |
| o3-pro | Extended thinking variant of o3. |
| o3-deep-research | Deep research variant. |
| o4-mini | Small reasoning model. Succeeded by GPT-5 mini but still available. |
| o4-mini-deep-research | Deep research variant. |

### Legacy (retiring from ChatGPT, API still available)
| Model | Notes |
|-------|-------|
| GPT-4.1 | 1M context. $2/$8 per M tokens. Being retired from ChatGPT. |
| GPT-4o | Being retired from ChatGPT. |

**Key update:** No "o4-full" exists. GPT-5.3-Codex is the newest model but is not yet in the general API. GPT-5.2 remains the flagship API model. There is a GPT-5 mini (not "gpt-5.2-mini"). Also notable: `gpt-oss-120b` appeared in some lists.

---

## xAI (Grok)

**Newer than grok-4: YES**

| Model | Notes |
|-------|-------|
| Grok 4.20 Beta | Multi-agent collaboration (4 Agents system). Mid-Feb 2026. API not yet public. [Source](https://help.apiyi.com/en/grok-4-20-beta-4-agents-guide-en.html) |
| Grok 4.1 | 65% fewer hallucinations, 30-40% faster, 2M context, multimodal vision. Available now. [Source](https://x.ai/news/grok-4-1) |
| Grok 4 | Previous flagship. $3/$15 per M tokens. [Source](https://docs.x.ai/developers/models) |
| Grok 4.1 Fast | Budget variant. $0.20/M input. |
| Grok 3 | Still available. |
| Grok 3 Mini | Still available. |

**Key update:** Grok 4.1 and Grok 4.20 Beta are newer than grok-4. Grok 4.1 is the current API flagship.

---

## Meta (Llama)

**Newer than llama-4-maverick, llama-4-scout: NO (for API-available models)**

| Model | Notes |
|-------|-------|
| Llama 4 Maverick | 17B active / 128 experts. Multimodal. Available via third-party APIs. [Source](https://ai.meta.com/blog/llama-4-multimodal-intelligence/) |
| Llama 4 Scout | 17B active / 16 experts. 10M context window. Available via third-party APIs. |
| Llama 4 Behemoth | 288B active / 16 experts. **Still training. NOT released.** [Source](https://siliconangle.com/2025/05/15/meta-postpone-release-llama-4-behemoth-model-report-claims/) |

**Key update:** No new Llama models since your list. Behemoth remains unreleased.

---

## Mistral

**Newer than mistral-medium-3: YES**

| Model | API ID | Notes |
|-------|--------|-------|
| Mistral Large 3 | `mistral-large-latest` | Flagship. 41B active / 675B total MoE. 256K context. [Source](https://mistral.ai/news/mistral-3) |
| Mistral Medium 3 | `mistral-medium-latest` | Mid-tier. $0.40/$2.00 per M tokens. |
| Mistral Small 3.1 | `mistral-small-latest` | Versatile. Budget. |
| Mistral 3 (14B, 8B, 3B) | Various | Small dense models. Open weight. |
| Voxtral | | Audio/speech models. |

**Key update:** Mistral Large 3 is the big new addition -- a 675B MoE flagship model.

---

## DeepSeek

**Newer than deepseek-r1, deepseek-chat-v3: YES**

| Model | Notes |
|-------|-------|
| DeepSeek V3.2 | Current API model. Integrated thinking + tool use. Sparse attention. [Source](https://api-docs.deepseek.com/news/news251201) |
| DeepSeek V3.2 Speciale | High-compute reasoning variant. API-only, no tool calls. [Source](https://openrouter.ai/deepseek/deepseek-v3.2-speciale) |
| DeepSeek R1 | Reasoning model. Still available. |
| DeepSeek V4 | **Not yet released.** Expected Q1-Q2 2026. 1T parameters rumored. [Source](https://evolink.ai/blog/deepseek-v4-release-window-prep) |
| DeepSeek R2 | **No official announcement.** Speculated but unconfirmed. |

**Key update:** V3.2 and V3.2-Speciale are newer than your list. V4 and R2 are not yet available.

---

## Qwen (Alibaba)

**Newer than qwen-2.5-72b, qwq-32b: YES, significantly**

| Model | Notes |
|-------|-------|
| Qwen 3.5 (family) | Released Feb 16-17, 2026. Multiple variants. [Source](https://qwen.ai/blog?id=qwen3.5) |
| Qwen 3.5 Flash | 35B-A3B MoE. 1M context. $0.40/M input. Low-latency agentic. [Source](https://www.cnbc.com/2026/02/17/china-alibaba-qwen-ai-agent-latest-model.html) |
| Qwen 3.5 Plus | Available on OpenRouter. [Source](https://openrouter.ai/qwen/qwen3.5-plus-02-15) |
| Qwen 3 (family) | Released Apr 2025. Sizes: 0.6B to 235B-A22B. Thinking/non-thinking modes. [Source](https://github.com/QwenLM/Qwen3) |
| Qwen 3 Max | Large variant. |
| Qwen3-Coder-Next | 3B active / 80B total. Coding-specialized. [Source](https://qwen.ai/blog?id=qwen3-coder-next) |
| QwQ-32B | Reasoning model on Qwen 2.5 base. Still available. |

**Key update:** Qwen 3 and Qwen 3.5 are both significantly newer than your list. The jump from 2.5 to 3.5 is substantial.

---

## Notable New Providers / Models You May Be Missing

### GLM-5 (Zhipu AI / Z.AI)
- 744B total / 40B active MoE. 200K context.
- Tops open-source intelligence indexes. Scores higher than Gemini 3 Pro.
- Available via Z.AI API, Novita, GMI Cloud, DeepInfra. $1/$3.20 per M tokens.
- [Source](https://huggingface.co/zai-org/GLM-5)

### GLM-4.7 Thinking
- 89% on LiveCodeBench. Strong reasoning model.

### Kimi K2.5 (Moonshot AI)
- Open-source multimodal model. 262K context. Self-directed agent swarm (up to 100 sub-agents).
- API: $0.60/$3.00 per M tokens. OpenAI/Anthropic-compatible API.
- [Source](https://huggingface.co/moonshotai/Kimi-K2.5)

### MiMo-V2-Flash (Xiaomi)
- 309B total / 15B active MoE. ~150 tok/s output.
- 87% LiveCodeBench. Ultra-aggressive pricing: $0.10/M input.
- [Source](https://llmbase.ai/compare/mimo-v2-flash-reasoning,deepseek-v3-2-speciale/)

### AI21 Jamba 1.6
- Transformer + Mamba SSM hybrid. Enterprise-focused.
- [Source](https://www.ai21.com/blog/introducing-jamba-1-6/)

### Amazon Nova
- Amazon's own models via Bedrock. Nova Pro for long documents and reasoning.

### Cohere Command R / R+
- RAG-specialized. Available via Bedrock and direct API.

---

## Quick Reference: What Is Actually New Since Your List

| Provider | You Had | What Is New |
|----------|---------|-------------|
| Google | gemini-3-flash-preview, gemini-3-pro-preview | **gemini-3.1-pro-preview** |
| Anthropic | claude-opus-4, claude-sonnet-4.5, claude-sonnet-4 | **claude-opus-4.6, claude-sonnet-4.6** (also opus-4.1 existed) |
| OpenAI | gpt-5.2, o4-mini | **GPT-5.3-Codex** (not general API yet), **GPT-5 mini**, **GPT-5 nano**, o3-pro, o3/o4-mini-deep-research. No o4-full. |
| xAI | grok-4 | **grok-4.1** (API), **grok-4.20 beta** (no API yet) |
| Meta | llama-4-maverick, llama-4-scout | Nothing new. Behemoth still training. |
| Mistral | mistral-medium-3 | **Mistral Large 3** (675B MoE flagship) |
| DeepSeek | deepseek-r1, deepseek-chat-v3 | **DeepSeek V3.2**, **V3.2-Speciale** |
| Qwen | qwen-2.5-72b, qwq-32b | **Qwen 3** (full family), **Qwen 3.5** (Feb 2026), **Qwen3-Coder-Next** |
| NEW | -- | **GLM-5** (Z.AI), **Kimi K2.5** (Moonshot), **MiMo-V2-Flash** (Xiaomi) |

---

## References

1. [LLM Stats - AI News February 2026](https://llm-stats.com/ai-news)
2. [Google Gemini API Models](https://ai.google.dev/gemini-api/docs/models)
3. [Gemini 3.1 Pro Model Card](https://deepmind.google/models/model-cards/gemini-3-1-pro/)
4. [Anthropic Claude Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview)
5. [Anthropic - Claude Sonnet 4.6](https://www.anthropic.com/news/claude-sonnet-4-6)
6. [Anthropic - Claude Opus 4.6](https://techcrunch.com/2026/02/05/anthropic-releases-opus-4-6-with-new-agent-teams/)
7. [OpenAI Models API](https://platform.openai.com/docs/models)
8. [OpenAI - Introducing o3 and o4-mini](https://openai.com/index/introducing-o3-and-o4-mini/)
9. [OpenAI - GPT-5.3-Codex](https://openai.com/index/introducing-gpt-5-3-codex/)
10. [OpenAI - GPT-5.3-Codex-Spark](https://openai.com/index/introducing-gpt-5-3-codex-spark/)
11. [xAI Models and Pricing](https://docs.x.ai/developers/models)
12. [xAI - Grok 4.1](https://x.ai/news/grok-4-1)
13. [Meta - Llama 4](https://ai.meta.com/blog/llama-4-multimodal-intelligence/)
14. [Mistral AI - Introducing Mistral 3](https://mistral.ai/news/mistral-3)
15. [DeepSeek API Models](https://api-docs.deepseek.com/api/list-models)
16. [DeepSeek V3.2 on OpenRouter](https://openrouter.ai/deepseek/deepseek-v3.2-speciale)
17. [Qwen 3.5 on GitHub](https://github.com/QwenLM/Qwen3.5)
18. [Qwen 3.5 - CNBC](https://www.cnbc.com/2026/02/17/china-alibaba-qwen-ai-agent-latest-model.html)
19. [GLM-5 on Hugging Face](https://huggingface.co/zai-org/GLM-5)
20. [Kimi K2.5 on Hugging Face](https://huggingface.co/moonshotai/Kimi-K2.5)
21. [MiMo-V2-Flash comparison](https://llmbase.ai/compare/mimo-v2-flash-reasoning,deepseek-v3-2-speciale/)
22. [OpenRouter - Qwen 3.5 Plus](https://openrouter.ai/qwen/qwen3.5-plus-02-15)
23. [LLM Pricing February 2026](https://dev.to/kaeltiwari/llm-pricing-in-february-2026-what-every-model-actually-costs-3jdd)
