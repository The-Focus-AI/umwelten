# NVIDIA Nemotron 3 Inference Provider Survey

**Date:** 2026-03-25
**Scope:** API providers serving Nemotron 3 Nano 30B, Super 120B, or Nano 9B -- excluding OpenRouter, DeepInfra, and Ollama (already known)

## Abstract

This report surveys the current landscape of inference providers offering NVIDIA Nemotron 3 models via API as of March 2026. Beyond the already-known providers (OpenRouter, DeepInfra, Ollama), we identified **14 additional providers** serving Nemotron 3 models. The Super 120B variant has the broadest availability across providers, while Nano 30B has fewer but growing options. Pricing ranges from free (NVIDIA NIM) to $1.50/M output tokens (Cloudflare), with most providers clustering around $0.50-0.75/M output tokens for Super. Tool/function calling is widely supported but not universal.

---

## Provider Summary Table

### Nemotron 3 Super 120B (A12B)

| Provider | Input $/M | Output $/M | Speed (t/s) | Tool Calling | Quantization | Notes |
|----------|-----------|------------|-------------|--------------|--------------|-------|
| **NVIDIA NIM** | Free | Free | ~418 | Yes | FP8/BF16 | Trial API at build.nvidia.com; rate-limited |
| **Amazon Bedrock** | $0.10 | $0.50 | N/A | Yes | N/A | Launched 2026-03-11; 8 regions |
| **Baseten** | $0.55 | $0.75 | 451 | Yes | NVFP4 | Fastest benchmarked provider |
| **Lightning AI** | $0.30 | $0.75 | 427 | No | FP8 | No tool calling support |
| **Nebius** | $0.30 | $0.60 | 288 | Yes | N/A | "Token Factory" product |
| **Weights & Biases** | $0.20 | $0.50 | 147 | Yes | N/A | Low latency (0.74s TTFT) |
| **Together AI** | N/A | N/A | N/A | Yes | FP8 | Serverless + dedicated; pricing not public on page |
| **Fireworks AI** | N/A | N/A | N/A | Yes | N/A | Day-0 launch partner; on-demand deployment |
| **FriendliAI** | N/A | N/A | N/A | Yes | N/A | Dedicated endpoints only; pricing requires inquiry |
| **Cloudflare Workers AI** | $0.50 | $1.50 | N/A | Yes | N/A | 256K context; prompt caching support |
| **Microsoft Foundry (Azure)** | N/A | N/A | N/A | Yes | NVFP4 | NIM microservice; pricing via Azure |
| **Modal** | GPU-hour | GPU-hour | N/A | Yes | FP8 | Self-deploy with SGLang on B200; pay per GPU-hour |
| **Replicate** | N/A | N/A | N/A | N/A | N/A | Super not confirmed; Nano 30B is available |

### Nemotron 3 Nano 30B (A3B)

| Provider | Input $/M | Output $/M | Speed (t/s) | Tool Calling | Quantization | Notes |
|----------|-----------|------------|-------------|--------------|--------------|-------|
| **NVIDIA NIM** | Free | Free | N/A | Yes | FP8/BF16 | Trial API at build.nvidia.com |
| **Amazon Bedrock** | $0.06 | $0.24 | N/A | Yes | N/A | 256K context; 8 regions |
| **Together AI** | N/A | N/A | N/A | Yes | N/A | Serverless + dedicated |
| **Fireworks AI** | N/A | N/A | N/A | Yes | N/A | On-demand dedicated only (not serverless) |
| **FriendliAI** | N/A | N/A | N/A | Yes | N/A | Dedicated endpoints |
| **Replicate** | Per-second | Per-second | N/A | N/A | N/A | Runs on A100 80GB; ~14 min cold start |
| **Baseten** | N/A | N/A | N/A | Yes | N/A | Confirmed available |

---

## Detailed Provider Analysis

### 1. NVIDIA NIM (build.nvidia.com)

- **Models:** Nemotron 3 Super 120B, Nemotron 3 Nano 30B
- **Pricing:** Free (rate-limited trial)
- **Tool Calling:** Yes
- **Quantization:** FP8 and BF16 checkpoints available
- **Context:** 1M tokens
- **Notes:** This is NVIDIA's own hosted API. Free for experimentation but rate-limited. Not intended for production workloads. Models available as NIM microservices for self-hosting on your own NVIDIA GPUs.

According to [NVIDIA NIM](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b), the trial service is governed by NVIDIA API Trial Terms of Service.

### 2. Amazon Bedrock

- **Models:** Nemotron 3 Super 120B (launched 2026-03-11), Nemotron 3 Nano 30B (launched 2025-12-23)
- **Pricing (Super):** $0.10/M input, $0.50/M output
- **Pricing (Nano):** $0.06/M input, $0.24/M output
- **Tool Calling:** Yes (native tool calling support via Bedrock Converse API)
- **Context:** Super 1M tokens, Nano 256K tokens
- **Regions:** US East (N. Virginia, Ohio), US West (Oregon), AP (Tokyo, Mumbai), SA (Sao Paulo), EU (London, Milan)
- **Notes:** Fully managed serverless. Supports both unified and OpenAI API-compatible endpoints. Very competitive pricing -- matches or beats most other providers.

According to [AWS](https://aws.amazon.com/about-aws/whats-new/2026/03/amazon-bedrock-nemotron-3-super/), Nemotron 3 Super is built for agentic workloads.

### 3. Baseten

- **Models:** Nemotron 3 Super 120B, Nemotron 3 Nano 30B
- **Pricing (Super):** $0.55/M input, $0.75/M output
- **Speed:** 451 t/s (fastest benchmarked for Super)
- **Tool Calling:** Yes
- **Quantization:** NVFP4 (4-bit NVIDIA floating point)
- **Notes:** Highest throughput among benchmarked providers. Good for latency-sensitive workloads. Focused on financial services use cases.

According to [Baseten](https://www.baseten.co/blog/introducing-nemotron-3-super/), Nemotron 3 Super is optimized for agents that combine multiple inputs, reason across steps, and call tools reliably.

### 4. Lightning AI

- **Models:** Nemotron 3 Super 120B
- **Pricing:** $0.30/M input, $0.75/M output
- **Speed:** 427 t/s
- **Tool Calling:** No
- **Notes:** Fast inference but **does not support tool/function calling**, which limits usefulness for agentic workloads. JSON mode is supported.

According to [Artificial Analysis](https://artificialanalysis.ai/models/nvidia-nemotron-3-super-120b-a12b/providers), Lightning AI is the second-fastest provider.

### 5. Nebius AI

- **Models:** Nemotron 3 Super 120B
- **Pricing:** $0.30/M input, $0.60/M output
- **Speed:** 288 t/s
- **Tool Calling:** Yes
- **Notes:** Available via Nebius Token Factory. Good balance of price and features. Higher latency (1.73s TTFT) than competitors.

According to [Nebius](https://nebius.com/blog/posts/nemotron3-super-now-available), Nemotron 3 Super is available in their Token Factory console.

### 6. Weights & Biases

- **Models:** Nemotron 3 Super 120B
- **Pricing:** $0.20/M input, $0.50/M output
- **Speed:** 147 t/s
- **Tool Calling:** Yes
- **Notes:** Lowest price among non-free providers. Slower throughput but very low latency to first token (0.74s). Good for cost-sensitive applications where raw throughput is less important.

### 7. Together AI

- **Models:** Nemotron 3 Super 120B, Nemotron 3 Nano 30B
- **Pricing:** Not publicly listed on model page; requires account
- **Tool Calling:** Yes
- **Quantization:** FP8
- **Deployment:** Serverless and dedicated options
- **Notes:** Day-0 launch partner for both models. Supports deployment on single H200 or H100 GPUs. Enterprise features include 99.9% uptime SLA and SOC 2 compliance.

According to [Together AI](https://www.together.ai/blog/nvidia-nemotron-3-super), they brought Nemotron 3 to developers on Day 0.

### 8. Fireworks AI

- **Models:** Nemotron 3 Super 120B, Nemotron 3 Nano 30B
- **Pricing:** Not publicly listed for these models
- **Tool Calling:** Yes (function calling confirmed for Nano)
- **Deployment:** On-demand dedicated GPUs (Nano is not serverless)
- **Notes:** Day-0 launch partner. Supports fine-tuning on Nano. No rate limits on dedicated deployments.

According to [Fireworks AI](https://fireworks.ai/blog/nvidia-nemotron3-nano), they provide the engine for next-generation AI agents with Nemotron 3.

### 9. FriendliAI

- **Models:** Nemotron 3 Super 120B, Nemotron 3 Nano 30B
- **Pricing:** Requires inquiry (dedicated endpoint pricing)
- **Tool Calling:** Yes
- **Deployment:** Dedicated endpoints only
- **Notes:** Official NVIDIA launch partner. OpenAI-compatible API. Enterprise-focused with full control over deployment, scaling, and hardware selection.

According to [FriendliAI](https://friendli.ai/blog/nvidia-nemotron-3-super), they support tool-calling workflows at enterprise scale.

### 10. Cloudflare Workers AI

- **Models:** Nemotron 3 Super 120B (model ID: `@cf/nvidia/nemotron-3-120b-a12b`)
- **Pricing:** $0.50/M input, $1.50/M output
- **Tool Calling:** Yes
- **Context:** 256K tokens (not 1M)
- **Notes:** Added 2026-03-11. Accessible via Workers AI binding, REST API, or OpenAI-compatible endpoint. Supports prompt caching via `x-session-affinity` header. Most expensive per-token option but integrates well with Cloudflare's edge network.

According to [Cloudflare](https://developers.cloudflare.com/changelog/post/2026-03-11-nemotron-3-super-workers-ai/), Nemotron 3 Super is now available on Workers AI.

### 11. Microsoft Foundry (Azure AI)

- **Models:** Nemotron 3 Super 120B (as NIM microservice)
- **Pricing:** Via Azure billing (not per-token public pricing)
- **Tool Calling:** Yes
- **Quantization:** NVFP4
- **Notes:** Deployed as NVIDIA NIM microservice within Azure. Enterprise-grade with Azure compliance and governance. Part of the broader Azure AI model catalog.

According to [Microsoft](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/nvidia-nemotron-3-super-now-available-on-microsoft-foundry-open-efficient-reason/4501781), Nemotron 3 Super is now available on Microsoft Foundry.

### 12. Modal

- **Models:** Nemotron 3 Super 120B (self-deploy)
- **Pricing:** Per GPU-hour (not per-token)
- **Tool Calling:** Depends on inference server (SGLang/vLLM support it)
- **Quantization:** FP8 recommended
- **Notes:** Not a managed inference API -- you deploy the model yourself on Modal's GPU infrastructure. Provides examples and docs for deploying with SGLang on B200 GPUs. Pay for compute time, not tokens.

According to [Modal](https://modal.com/docs/examples/nemotron_inference), you can serve Nemotron models at low latency with SGLang.

### 13. Replicate

- **Models:** Nemotron 3 Nano 30B (Super not confirmed)
- **Pricing:** Per-second compute billing
- **Hardware:** Runs on A100 80GB
- **Tool Calling:** Not confirmed
- **Notes:** Cold starts can take up to 14 minutes. Better suited for batch/async workloads than real-time inference.

According to [Replicate](https://replicate.com/nvidia/nemotron-3-nano-30b-a3b), the model supports thinking mode and direct mode.

### 14. Google Cloud (mentioned)

- **Models:** Nemotron 3 Super 120B (referenced in NVIDIA's partner list)
- **Details:** Not enough information found to confirm pricing, features, or exact availability.

---

## Providers Checked but NOT Serving Nemotron 3

| Provider | Status |
|----------|--------|
| **Groq** | Not available. Community feature request exists but no Nemotron models listed in their supported models. |
| **Cerebras** | Not available. Their inference API focuses on Llama, Qwen, and GPT-OSS models. |
| **Hugging Face Inference Endpoints** | Weights available on HF Hub but no managed inference endpoint confirmed. |
| **Lepton AI** | No evidence of Nemotron 3 availability found. |
| **OctoAI** | No evidence found (OctoAI may have been acquired/sunset). |
| **Anyscale/Endpoints** | No evidence of Nemotron 3 availability found. |
| **RunPod** | GPU rental platform; could self-host but no managed Nemotron API. |
| **Lambda** | Documentation for self-deploying Nano with vLLM exists, but no managed inference API. |

---

## Cost Comparison (Super 120B, sorted by blended price)

Blended price = (input + output) / 2 per million tokens, as a rough comparison metric.

| Provider | Blended $/M | Tool Calling |
|----------|-------------|--------------|
| NVIDIA NIM | $0.00 (free, rate-limited) | Yes |
| Weights & Biases | $0.35 | Yes |
| Amazon Bedrock | $0.30 | Yes |
| Nebius | $0.45 | Yes |
| Lightning AI | $0.53 | No |
| Baseten | $0.65 | Yes |
| Cloudflare | $1.00 | Yes |

Together AI, Fireworks AI, FriendliAI, Azure: pricing requires account or inquiry.

---

## Recommendations

**Best for production agentic workloads (tool calling required):**
- **Amazon Bedrock** -- competitive pricing ($0.10/$0.50), tool calling, fully managed, multi-region, just launched Super on 2026-03-11.
- **Weights & Biases** -- cheapest per-token with tool calling ($0.20/$0.50), though slower throughput.

**Best for speed-sensitive workloads:**
- **Baseten** -- fastest at 451 t/s with tool calling, but more expensive.

**Best for experimentation:**
- **NVIDIA NIM** -- free trial API with both Super and Nano.

**Best for Nano 30B specifically:**
- **Amazon Bedrock** -- $0.06/$0.24, tool calling, serverless, 8 regions.
- **DeepInfra** (already known) remains the cheapest at $0.05/$0.20.

---

## References

1. [Artificial Analysis - Nemotron 3 Super Providers](https://artificialanalysis.ai/models/nvidia-nemotron-3-super-120b-a12b/providers)
2. [Artificial Analysis - Nemotron 3 Nano Providers](https://artificialanalysis.ai/models/nvidia-nemotron-3-nano-30b-a3b/providers)
3. [NVIDIA NIM - Nemotron 3 Super](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b)
4. [NVIDIA NIM - Nemotron 3 Nano](https://build.nvidia.com/nvidia/nemotron-3-nano-30b-a3b)
5. [AWS - Nemotron 3 Super on Bedrock](https://aws.amazon.com/about-aws/whats-new/2026/03/amazon-bedrock-nemotron-3-super/)
6. [AWS - Nemotron 3 Nano on Bedrock](https://aws.amazon.com/about-aws/whats-new/2025/12/nvidia-nemotron-3-nano-amazon-bedrock/)
7. [AWS Blog - Run Nemotron 3 Super on Bedrock](https://aws.amazon.com/blogs/machine-learning/run-nvidia-nemotron-3-super-on-amazon-bedrock/)
8. [Baseten - Nemotron 3 Super](https://www.baseten.co/blog/introducing-nemotron-3-super/)
9. [Baseten - Nemotron 3 Nano](https://www.baseten.co/blog/nvidia-nemotron-3-nano/)
10. [Together AI - Nemotron 3 Super](https://www.together.ai/models/nvidia-nemotron-3-super)
11. [Together AI Blog - Day 0 Launch](https://www.together.ai/blog/nvidia-nemotron-3-super)
12. [Fireworks AI - Nemotron Nano 3](https://fireworks.ai/models/fireworks/nemotron-nano-3-30b-a3b)
13. [Fireworks AI Blog - Nemotron 3 Nano](https://fireworks.ai/blog/nvidia-nemotron3-nano)
14. [FriendliAI - Nemotron 3 Super](https://friendli.ai/blog/nvidia-nemotron-3-super)
15. [FriendliAI - Nemotron 3 Nano](https://friendli.ai/blog/nvidia-nemotron-3-partnership)
16. [Cloudflare Workers AI - Nemotron 3 Super](https://developers.cloudflare.com/workers-ai/models/nemotron-3-120b-a12b/)
17. [Cloudflare Changelog - Nemotron Launch](https://developers.cloudflare.com/changelog/post/2026-03-11-nemotron-3-super-workers-ai/)
18. [Microsoft Foundry - Nemotron 3 Super](https://ai.azure.com/catalog/models/NVIDIA-Nemotron-3-Super-NIM-microservice)
19. [Microsoft Blog - Nemotron on Foundry](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/nvidia-nemotron-3-super-now-available-on-microsoft-foundry-open-efficient-reason/4501781)
20. [Nebius Blog - Nemotron 3 Super](https://nebius.com/blog/posts/nemotron3-super-now-available)
21. [Modal Docs - Nemotron Inference](https://modal.com/docs/examples/nemotron_inference)
22. [Replicate - Nemotron 3 Nano](https://replicate.com/nvidia/nemotron-3-nano-30b-a3b)
23. [Groq Supported Models](https://console.groq.com/docs/models)
24. [NVIDIA Developer - Nemotron](https://developer.nvidia.com/nemotron)
25. [NVIDIA Blog - Nemotron 3 Super](https://developer.nvidia.com/blog/introducing-nemotron-3-super-an-open-hybrid-mamba-transformer-moe-for-agentic-reasoning/)
26. [Holori - Bedrock Nemotron Nano Pricing](https://calculator.holori.com/llm/bedrock/nvidia.nemotron-nano-3-30b)
