# DeepInfra vs OpenRouter: Technical Differences in LLM Inference for Nemotron Models

**Date:** 2026-03-20
**Scope:** Technical comparison of inference providers, focused on what causes identical model weights to produce different outputs

---

## Abstract

This report investigates the technical differences between DeepInfra and OpenRouter as LLM inference providers, with specific attention to NVIDIA Nemotron models. DeepInfra operates as a direct inference provider running models on their own GPU infrastructure using optimized serving engines (likely vLLM or SGLang) with FP8 quantization for Nemotron models. OpenRouter functions as a routing proxy that does not run inference itself but dispatches requests to downstream providers -- including DeepInfra -- adding a translation layer between the caller and the actual inference engine. Key sources of behavioral divergence include: quantization level differences (DeepInfra uses FP8 for Nemotron Super, free-tier providers may use different precision), prompt transformation by OpenRouter's middleware (context compression, message transforms, tool-call translation), tool calling implementation differences (each provider applies its own chat templates for function calling), and privacy/logging differences (OpenRouter's free tier requires prompt logging and may route to providers that train on data). These factors collectively explain why the same nominal model can exhibit measurably different behavior across providers.

---

## 1. Introduction

When running model evaluations across providers, a common assumption is that the same model name implies identical behavior. In practice, even models served from the same checkpoint can produce substantially different outputs depending on the provider's infrastructure choices. OpenRouter itself has acknowledged this problem, stating that "the same model weights (with the same quantization) should yield the same results" yet "production-grade inference implementation involves complexity that creates divergence" [1].

This report examines the specific technical mechanisms that cause such divergence, focusing on the DeepInfra and OpenRouter providers as they relate to serving NVIDIA Nemotron models.

---

## 2. How DeepInfra Serves Models

### 2.1 Infrastructure Overview

DeepInfra is a **direct inference provider** that runs models on its own GPU infrastructure in US-based data centers. The company is SOC 2 and ISO 27001 certified [2]. They provide a deployment API that accepts Hugging Face model repositories and supports GPU classes including A100-80GB and H100-80GB with configurable multi-GPU allocations [2].

### 2.2 Serving Engine

DeepInfra does not publicly disclose which specific inference engine they use. However, based on available evidence:

- Their infrastructure is described as "cutting-edge inference optimised" [2]
- The broader industry in 2025-2026 has converged on **vLLM** and **SGLang** as the primary open-source serving engines, with TGI entering maintenance mode in December 2025 [3]
- OpenRouter's own documentation references providers optimizing inference stacks using "VLLM and SGLang" [1], and DeepInfra is one of their primary upstream providers
- DeepInfra's GitHub presence shows contributions to the open-source inference ecosystem [4]

It is highly likely that DeepInfra uses vLLM, SGLang, or a custom fork of one of these engines, potentially varying by model.

### 2.3 Quantization for Nemotron

For Nemotron models specifically, DeepInfra serves:

- **Nemotron 3 Super**: FP8 quantization, as indicated by the model identifier `NVIDIA-Nemotron-3-Super-120B-A12B-FP8` on OpenRouter [5]
- **Nemotron 3 Nano**: FP8 version available from NVIDIA on Hugging Face (`NVIDIA-Nemotron-3-Nano-30B-A3B-FP8`), where the model including KV cache is quantized to FP8 with a selective strategy keeping attention layers and feeding Mamba layers in BF16 [6]

DeepInfra has also been known to use FP4 quantization for some models. In evaluations of the Kimi K2 model, DeepInfra used fp4 quantization yet still achieved ratings of 8.5-10 [7], demonstrating that aggressive quantization does not necessarily destroy output quality -- but it does change outputs.

### 2.4 Tool Calling Implementation

DeepInfra provides an OpenAI-compatible API for function calling [8]. Their implementation:

- Uses the standard OpenAI tool schema format
- Supports `tool_choice` with `auto` or `none` only
- Supports parallel tool calls (though quality may be lower)
- Supports streaming mode
- Does **not** support nested calls

The critical detail for behavioral differences: DeepInfra applies the model's native **chat template** for tool calling. For models like Llama that have built-in tool calling support, the chat template defines how function definitions are formatted in the prompt. Different serving engines may apply these templates slightly differently, particularly around whitespace, delimiters, and special tokens [8].

---

## 3. How OpenRouter Routes Models

### 3.1 Architecture: Proxy, Not Inference

OpenRouter is fundamentally **not an inference provider**. It is a unified API gateway that routes requests to downstream inference providers [9][10]. The architecture works as follows:

1. Your application sends a request to `api.openrouter.ai`
2. OpenRouter analyzes the request and selects a provider based on cost, latency, availability, and user preferences
3. OpenRouter translates the request into the provider's native API format
4. The downstream provider (e.g., DeepInfra, NVIDIA, etc.) runs the actual inference
5. OpenRouter translates the response back to a unified format

This means every OpenRouter request passes through an additional translation layer that can introduce differences.

### 3.2 Provider Selection and Routing

By default, OpenRouter load-balances across available providers, prioritizing those without recent outages and weighting by inverse square of price [11]. Users can control routing through:

- **`order`**: Preferred provider list
- **`sort`**: Prioritize by "price", "throughput", or "latency"
- **`only` / `ignore`**: Whitelist or blacklist specific providers
- **`quantizations`**: Filter by precision level (int4, int8, fp4, fp6, fp8, fp16, bf16, fp32) [11]
- **Dynamic variants**: `:nitro` (throughput-optimized), `:floor` (cheapest), `:exacto` (quality-first for tool calling) [11]

### 3.3 Who Runs Nemotron Inference Behind OpenRouter

For the **paid** Nemotron 3 Super endpoint, OpenRouter lists **DeepInfra** as a provider using the FP8 model weights, with multiple providers available [5]. The model page indicates "higher uptime with 3 providers."

For the **free** Nemotron 3 Super endpoint (`:free` suffix), the provider is listed as **NVIDIA** (via `NvidiaAdapter`) [12]. The quantization for the free tier is listed as **"unknown"** [12].

This is significant: the free and paid tiers may route to entirely different infrastructure with different quantization levels.

### 3.4 Dynamic Variants and Exacto

OpenRouter introduced **Exacto** endpoints specifically to address provider variance in tool calling [1]. Their data from measuring billions of tool calls revealed that "tool calling failures happen measurably less often" with certain providers. Exacto routes requests to providers meeting three criteria:

- Top-tier tool-calling accuracy
- Normal tool-calling propensity ranges
- Not frequently blacklisted by users

This confirms that provider variance in tool calling is a recognized, measured problem.

---

## 4. Free Tier Differences

### 4.1 OpenRouter Free Models

OpenRouter's free tier has several documented differences from paid access [13][14][15]:

1. **Privacy and logging**: Free models **require** users to enable training and logging in privacy settings. All prompts and outputs are logged to "improve the provider's model and its product and services" [12][13]
2. **Rate limits**: 20 requests/minute, 200 requests/day (reduced to 50/day for users who haven't recharged) [14]
3. **Priority**: During peak times, free requests may be queued behind paid requests [14]
4. **Provider routing**: Free endpoints may route to different providers than paid ones. For Nemotron 3 Super, the free tier routes through NVIDIA's adapter while the paid tier routes through DeepInfra [5][12]
5. **Quantization**: The free tier lists quantization as "unknown" while the paid tier explicitly uses FP8 [12][5]

### 4.2 DeepInfra Free Access

DeepInfra does not offer a formal "free tier" in the same way. Their pricing is straightforward per-token (e.g., $0.10/$0.50 per million input/output tokens for Nemotron 3 Super) [5]. There is no documented difference in model weights or quantization between any usage tiers on DeepInfra.

---

## 5. Prompt Modification and System Prompt Injection

### 5.1 OpenRouter Message Transforms

OpenRouter applies several transformations to messages before forwarding them to providers:

- **Context compression**: When prompts exceed a model's context window, OpenRouter can remove or truncate messages from the middle of the prompt, since "LLMs pay less attention to the middle of sequences" [16]. For Anthropic models hitting the 1000-message limit, it keeps half from the start and half from the end [16]
- **Models with 8,192 tokens or fewer** have context compression enabled by default [16]
- **Response healing**: For JSON responses, OpenRouter can automatically repair malformed syntax (missing brackets, trailing commas, unquoted keys, markdown wrappers) [17]. This modifies the raw model output
- **Strict tool use header stripping**: Without the `structured-outputs-2025-11-13` header, OpenRouter strips the `strict` field from tool definitions [18]
- **Unsupported parameter dropping**: If a model doesn't support a request parameter, OpenRouter silently ignores it [18]

### 5.2 DeepInfra Prompt Handling

DeepInfra, as a direct inference provider, does not document any middleware that modifies prompts or responses. The model receives the prompt as submitted through the OpenAI-compatible API, with the serving engine applying the model's native chat template to format messages into the expected prompt structure.

### 5.3 Implications for Behavioral Differences

The OpenRouter translation layer introduces several potential sources of divergence:

- A prompt that fits within context limits on DeepInfra may trigger context compression on OpenRouter if the endpoint reports a smaller context window
- JSON responses may be "healed" by OpenRouter, producing syntactically different output than the raw model generation
- Tool definitions may be silently modified (e.g., `strict` field removal)

---

## 6. Tool Calling Implementation Differences

### 6.1 The Core Problem

Neither DeepInfra nor OpenRouter has published the exact prompt templates they use for tool calling with models that lack native API-level function calling support. Both providers present an OpenAI-compatible API, but the transformation from that API format to the actual model prompt can differ significantly.

### 6.2 DeepInfra's Approach

DeepInfra implements tool calling at the serving engine level [8]:

- Tools are defined using the OpenAI function schema
- The serving engine (vLLM/SGLang) applies the model's **chat template** (typically a Jinja2 template from the model's tokenizer config) to format tool definitions into the prompt
- The model generates structured tool call output which the engine parses back into the API response format
- Quality varies: parallel calls produce lower quality than sequential [8]
- The model's own chat template controls formatting, so this is typically close to what the model was trained on

### 6.3 OpenRouter's Approach

OpenRouter standardizes tool calling across all providers [19]:

- "Tool calling follows OpenAI's tool calling request shape. For non-OpenAI providers, it will be transformed accordingly" [19]
- The transformation details are not publicly documented
- OpenRouter has measured that tool calling accuracy varies significantly across providers for the same model, leading to the Exacto routing variant [1]
- OpenRouter checks for three failure modes: invalid JSON, incorrect tool names, and schema mismatches [1]

### 6.4 Where Differences Arise

When you send a tool-calling request through OpenRouter that routes to DeepInfra:

1. OpenRouter receives your OpenAI-format tool definitions
2. OpenRouter translates and forwards to DeepInfra's API
3. DeepInfra's serving engine applies the model's chat template
4. The model generates a response
5. DeepInfra parses the response into structured tool calls
6. OpenRouter receives and potentially transforms the response

Each translation step is a potential source of information loss or transformation. When you call DeepInfra directly, you eliminate steps 2 and 6.

---

## 7. Known Output Modification Issues

### 7.1 Provider Variance Data

OpenRouter's own measurements confirm that provider variance is real and measurable [1]:

- Different providers hosting identical model weights produce measurably different results
- Root causes include: infrastructure optimization trade-offs, model burn-in periods for new deployments, and operational implementation differences
- Tool-calling accuracy varies significantly across providers
- Some providers are "frequently blacklisted by users" due to quality issues

### 7.2 Quantization Effects

DeepInfra has been observed using aggressive quantization (fp4) for some models while maintaining competitive quality [7]. For Nemotron specifically, FP8 quantization is used with selective precision -- attention layers and feeding Mamba layers remain in BF16 to preserve accuracy [6]. A provider using a different quantization scheme (e.g., INT4 vs FP8) would produce numerically different outputs even with identical prompts.

### 7.3 Response Length and Truncation

In provider evaluations, DeepInfra has been observed to produce the longest responses (~2,000 tokens) compared to other providers [7], while also showing "large response length variations" in coding tasks (240-1,030 tokens) [7]. This suggests that response length characteristics can differ substantially across providers even for the same model.

### 7.4 OpenRouter-Specific Modifications

Documented ways OpenRouter can modify outputs:

- **Response healing** repairs malformed JSON by fixing brackets, quotes, commas [17]
- **Context compression** removes middle portions of prompts [16]
- **Parameter stripping** silently removes unsupported parameters [18]
- **Encoding issues** have been reported with model names being URL-encoded [20]

---

## 8. Summary of Divergence Sources

| Factor | DeepInfra (Direct) | OpenRouter |
|--------|-------------------|------------|
| **Inference** | Runs on own GPUs | Proxies to downstream providers |
| **Nemotron Provider** | DeepInfra itself | NVIDIA (free), DeepInfra + others (paid) |
| **Quantization (Nemotron Super)** | FP8 (confirmed) | "Unknown" (free), FP8 via DeepInfra (paid) |
| **Prompt Modification** | None documented; applies chat template | Context compression, parameter stripping, response healing |
| **Tool Calling** | Model's native chat template via serving engine | Translation layer over provider's implementation |
| **System Prompt Injection** | None documented | Presets can add system prompts; no evidence of automatic injection |
| **Response Modification** | None documented | Response healing for JSON; context compression |
| **Free Tier** | No free tier; consistent behavior | Different provider, unknown quantization, prompts logged for training |
| **Logging** | Standard data handling | Free: prompts logged; Paid: configurable opt-in/out |

---

## 9. Conclusions and Recommendations

### 9.1 Key Takeaways

1. **The same model name does not guarantee the same behavior.** OpenRouter's own data confirms measurable provider variance, particularly for tool calling.

2. **Free tier on OpenRouter is a different product.** The free Nemotron endpoint routes to a different provider (NVIDIA vs DeepInfra), uses unknown quantization, logs all prompts, and has lower priority during peak times.

3. **DeepInfra provides more predictable behavior** because it eliminates the translation/routing layer. When you call DeepInfra directly, you know exactly which quantization is used (FP8 for Nemotron) and there are no middleware transforms.

4. **Tool calling is the highest-variance area.** OpenRouter created the Exacto routing variant specifically because tool-calling quality varies so dramatically across providers.

5. **Quantization is the most likely cause of output differences** between providers. FP8 vs FP4 vs INT4 vs BF16 will produce numerically different activations, which compound through the model's layers.

### 9.2 Recommendations for Evaluation

- When comparing model quality across providers, **pin the provider** using OpenRouter's `only` parameter or call DeepInfra directly
- Use OpenRouter's `quantizations` filter to ensure consistent precision across comparisons
- For tool-calling evaluations, consider using the `:exacto` variant on OpenRouter or calling DeepInfra directly
- **Never compare free-tier OpenRouter with paid DeepInfra** -- you are likely comparing different quantizations on different infrastructure
- Log the `x-openrouter-provider` response header to know which provider actually served each request

---

## References

1. [Provider Variance: Introducing Exacto - OpenRouter Announcement](https://openrouter.ai/announcements/provider-variance-introducing-exacto)
2. [DeepInfra - Machine Learning Models and Infrastructure](https://deepinfra.com/)
3. [LLM Inference Servers Compared: vLLM vs TGI vs SGLang vs Triton (2026)](https://blog.premai.io/llm-inference-servers-compared-vllm-vs-tgi-vs-sglang-vs-triton-2026/)
4. [Deep Infra - GitHub](https://github.com/DeepInfra)
5. [Nemotron 3 Super - API Pricing & Providers - OpenRouter](https://openrouter.ai/nvidia/nemotron-3-super-120b-a12b)
6. [NVIDIA-Nemotron-3-Nano-30B-A3B-FP8 - Hugging Face](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8)
7. [Kimi K2 Provider Evaluation: Significant Performance Differences Across Platforms](https://eval.16x.engineer/blog/kimi-k2-provider-evaluation-results)
8. [Use Function Calling with DeepInfra endpoints](https://deepinfra.com/docs/advanced/function_calling)
9. [A Practical Guide to OpenRouter - Medium](https://medium.com/@milesk_33/a-practical-guide-to-openrouter-unified-llm-apis-model-routing-and-real-world-use-d3c4c07ed170)
10. [OpenRouter FAQ](https://openrouter.ai/docs/faq)
11. [Provider Routing - OpenRouter Documentation](https://openrouter.ai/docs/guides/routing/provider-selection)
12. [Nemotron 3 Super (free) - OpenRouter](https://openrouter.ai/nvidia/nemotron-3-super-120b-a12b:free)
13. [OpenRouter Privacy - Logging Documentation](https://openrouter.ai/docs/guides/privacy/logging)
14. [Updates to Our Free Tier - OpenRouter Announcement](https://openrouter.ai/announcements/updates-to-our-free-tier-sustaining-accessible-ai-for-everyone)
15. [OpenRouter Free Models Collection](https://openrouter.ai/collections/free-models)
16. [Message Transforms - OpenRouter Documentation](https://openrouter.ai/docs/guides/features/message-transforms)
17. [Response Healing - OpenRouter Documentation](https://openrouter.ai/docs/guides/features/plugins/response-healing)
18. [OpenRouter API Reference](https://openrouter.ai/docs/api/reference/overview)
19. [Tool & Function Calling - OpenRouter Documentation](https://openrouter.ai/docs/guides/features/tool-calling)
20. [OpenRouter Error Guide - JanitorAI](https://help.janitorai.com/en/article/openrouter-error-guide-10ear52/)
