# NVIDIA Nemotron Models: Complete Family Overview and API Availability

**Date:** 2026-03-17
**Scope:** All NVIDIA Nemotron model variants and their current API hosting providers with pricing

---

## Abstract

NVIDIA's Nemotron is a family of open-weight language models spanning multiple generations (Nemotron-4, Llama-Nemotron, Nemotron 2, and Nemotron 3) with variants ranging from 9B to 500B parameters. As of March 2026, the ecosystem includes approximately 14 distinct model variants available for API inference across providers including NVIDIA NIM (build.nvidia.com), OpenRouter, DeepInfra, Together AI, Fireworks AI, AWS Bedrock, Nebius, and others. The Nemotron 3 generation, announced December 2025, introduced a hybrid Mamba-Transformer MoE architecture with 1M-token context windows. The Nemotron 3 Nano (30B/3B active) and Super (120B/12B active) are available now, while Ultra (500B/50B active) is expected in mid-2026. Pricing is extremely competitive, with input tokens starting as low as $0.04/M for smaller models and free tiers available on OpenRouter. This report catalogs every known Nemotron variant and maps each to its available API providers and pricing.

---

## 1. The Complete Nemotron Model Family

### 1.1 Nemotron-4 (June 2024) -- Legacy Generation

The original large-scale Nemotron release. These models are largely superseded but remain available on some platforms.

| Model | Parameters | Context | Status |
|-------|-----------|---------|--------|
| Nemotron-4 340B Base | 340B | 4,096 | Weights on HuggingFace; NIM endpoint on build.nvidia.com |
| Nemotron-4 340B Instruct | 340B | 4,096 | Weights on HuggingFace; NIM endpoint on build.nvidia.com |
| Nemotron-4 340B Reward | 340B | 4,096 | Weights on HuggingFace (reward model, not for inference) |

These models were trained on 9 trillion tokens across 50+ languages and 40+ coding languages. They require 8x H100 GPUs for FP8 deployment and are primarily of historical interest now. According to [NVIDIA Research](https://research.nvidia.com/publication/2024-06_nemotron-4-340b), over 98% of the alignment data was synthetically generated.

### 1.2 Llama-Nemotron Series (2025) -- Llama-Based Fine-Tunes

NVIDIA fine-tuned Meta's Llama 3.x models with Nemotron techniques, creating a bridge generation:

| Model | Parameters | Context | Active Params | Status |
|-------|-----------|---------|---------------|--------|
| Llama-3.1-Nemotron-70B-Instruct | 70B | 128K | 70B (dense) | Available (DeepInfra, OpenRouter) |
| Llama-3.3-Nemotron-Super-49B v1 | 49B | 128K | ~49B | Available (OpenRouter) |
| Llama-3.3-Nemotron-Super-49B v1.5 | 49B | 128K | ~49B | Available (DeepInfra, OpenRouter) |
| Llama-3.1-Nemotron-Ultra-253B v1 | 253B | 128K | ~253B | Available (Nebius, OpenRouter) |

The Llama-Nemotron-Super-49B is notable for delivering 70B-level performance at a fraction of the cost. The Ultra-253B targets multi-agent enterprise workflows.

### 1.3 Nemotron 2 / Nemotron Nano v2 (2025) -- Small Efficient Models

The "Nemotron 2" generation focused on small, efficient models. NVIDIA released these as "Nemotron Nano" variants:

| Model | Parameters | Context | Status |
|-------|-----------|---------|--------|
| NVIDIA-Nemotron-Nano-9B-v2 | 9B | 128K | Available (DeepInfra, Amazon Bedrock, OpenRouter, build.nvidia.com) |
| NVIDIA-Nemotron-Nano-12B-v2-VL | 12B | 128K | Available (DeepInfra, OpenRouter, build.nvidia.com) |

The Nano-9B-v2 was trained from scratch by NVIDIA as a unified model for both reasoning and non-reasoning tasks. The Nano-12B-v2-VL adds multimodal (vision-language) capabilities for video understanding and document intelligence.

### 1.4 Nemotron 3 (December 2025 -- Present) -- Current Generation

The flagship Nemotron 3 family uses a novel **hybrid Mamba-Transformer Mixture-of-Experts (MoE)** architecture, delivering dramatically higher throughput than pure Transformer models while maintaining competitive accuracy. All Nemotron 3 models support **1M-token context windows**.

| Model | Total Params | Active Params | Context | Architecture | Status |
|-------|-------------|---------------|---------|-------------|--------|
| Nemotron 3 Nano 30B-A3B | 31.6B | 3.2B (3.6B w/ embeddings) | 1M | Hybrid Mamba-Transformer MoE | **Available now** |
| Nemotron 3 Super 120B-A12B | 120B | 12B | 1M | Hybrid Mamba-Transformer MoE | **Available now** (released March 2026) |
| Nemotron 3 Ultra ~500B-A50B | ~500B | ~50B | 1M | Hybrid Mamba-Transformer MoE | **Expected H1 2026** |

Key improvements over previous generations:
- Nemotron 3 Nano delivers **4x higher throughput** than Nemotron 2 Nano according to [NVIDIA](https://nvidianews.nvidia.com/news/nvidia-debuts-nemotron-3-family-of-open-models)
- Nemotron 3 Super claims **50% higher token generation** compared to the best open model at time of release, per [Together AI](https://www.together.ai/models/nvidia-nemotron-3-super)
- Trained with NVIDIA's ultra-efficient 4-bit NVFP4 training format (Super and Ultra)

### 1.5 Specialized Nemotron Models

Beyond the main reasoning/chat models, NVIDIA has released domain-specific Nemotron variants:

| Model Category | Examples | Availability |
|---------------|----------|-------------|
| **Nemotron RAG** | Extraction, embedding, reranking models | NIM API, HuggingFace |
| **Nemotron Safety** | Multilingual/multimodal content moderation | NIM API, HuggingFace |
| **Nemotron Speech** | ASR streaming, TTS, speech-to-speech | NIM API, HuggingFace |
| **Nemotron Parse** | Document parsing (v1.5.0) | NIM API |
| **Llama Nemotron Embed VL 1B v2** | Multimodal embedding for retrieval | OpenRouter, HuggingFace |

---

## 2. API Provider Availability and Pricing

### 2.1 NVIDIA NIM / build.nvidia.com

NVIDIA's own hosted API platform provides free-tier access to many Nemotron models. Available models include:

- Nemotron 3 Super 120B-A12B
- Nemotron 3 Nano 30B-A3B
- Nemotron Nano 9B v2
- Nemotron Nano 12B v2 VL
- Nemotron-4 340B Instruct (legacy)
- Nemotron ASR Streaming
- Nemotron Parse
- Nemotron Safety models

Access is free with an NVIDIA developer account. Rate limits apply. This is the primary first-party endpoint. See [build.nvidia.com](https://build.nvidia.com/nvidia).

### 2.2 OpenRouter

OpenRouter offers the broadest selection of Nemotron models, many with **free tiers**:

| Model | Input Price | Output Price | Notes |
|-------|-----------|-------------|-------|
| Nemotron 3 Super 120B-A12B | $0.00/M | $0.00/M | Free tier available |
| Nemotron 3 Nano 30B-A3B | $0.05/M | $0.20/M | Free tier also available |
| Nemotron Nano 9B v2 | Low | Low | Free tier available |
| Nemotron Nano 12B v2 VL | Low | Low | Free tier available |
| Llama-3.3-Nemotron-Super-49B v1.5 | ~$0.10/M | ~$0.40/M | Paid only |
| Llama-3.1-Nemotron-Ultra-253B v1 | Varies | Varies | Free tier available |
| Llama-3.1-Nemotron-70B-Instruct | Varies | Varies | Paid |
| Llama Nemotron Embed VL 1B v2 | $0.00/M | $0.00/M | Free tier available |

OpenRouter lists approximately **14 NVIDIA models** total (including free/paid variants). See [OpenRouter NVIDIA page](https://openrouter.ai/nvidia).

### 2.3 DeepInfra

DeepInfra offers some of the most competitive pricing and fastest inference:

| Model | Input Price | Output Price |
|-------|-----------|-------------|
| Nemotron Nano 9B v2 | $0.04/M | $0.16/M |
| Llama-3.3-Nemotron-Super-49B v1.5 | $0.10/M | $0.40/M |
| Nemotron Nano 12B v2 VL | $0.20/M | $0.60/M |
| Llama-3.1-Nemotron-70B-Instruct | $1.20/M | $1.20/M |
| Nemotron 3 Nano 30B-A3B | $0.05/M | $0.20/M |
| Nemotron 3 Super 120B-A12B | $0.10/M | $0.50/M |

DeepInfra reports the lowest latency for several models (0.66s TTFT for Nano-9B). See [DeepInfra Nemotron page](https://deepinfra.com/nemotron).

### 2.4 Together AI

Together AI hosts Nemotron models on Blackwell-based infrastructure:

| Model | Approx. Input Price | Approx. Output Price |
|-------|-------------------|---------------------|
| Nemotron 3 Super 120B-A12B | Available (pricing via dashboard) | -- |
| Nemotron 3 Nano 30B-A3B | ~$0.06/M | ~$0.24/M |

Together AI offers both serverless and dedicated deployment options. See [Together AI Nemotron page](https://www.together.ai/models/nvidia-nemotron-3-super).

### 2.5 Fireworks AI

Fireworks AI is confirmed to host Nemotron 3 Super and Nemotron 3 Nano. Specific pricing was not publicly listed in search results but is available through their dashboard. Fireworks runs on NVIDIA Blackwell, enabling [up to 10x cost reduction](https://blogs.nvidia.com/blog/inference-open-source-models-blackwell-reduce-cost-per-token/) per token vs. Hopper-era infrastructure.

### 2.6 AWS Bedrock

Amazon Bedrock provides managed serverless access:

| Model | Regions | Notes |
|-------|---------|-------|
| Nemotron 3 Nano 30B-A3B | US East (Virginia, Ohio), US West (Oregon), AP (Tokyo, Mumbai), SA (Sao Paulo), EU (London, Milan) | Fully managed serverless |
| Nemotron Nano 9B v2 | US East, EU West (expanding) | Available since re:Invent 2025 |

Pricing follows AWS Bedrock's standard per-token model. The Nano-9B was priced at approximately $0.06/M input and $0.23/M output. See [AWS blog post](https://aws.amazon.com/blogs/machine-learning/run-nvidia-nemotron-3-nano-as-a-fully-managed-serverless-model-on-amazon-bedrock/).

### 2.7 Nebius

Nebius is the primary provider for the largest Llama-Nemotron model:

| Model | Input Price | Output Price |
|-------|-----------|-------------|
| Llama-3.1-Nemotron-Ultra-253B v1 | $0.60/M | $1.80/M |
| Nemotron 3 Super 120B-A12B | $0.30/M (input) | -- |

Nebius reports 0.82s TTFT and 38.2 t/s output speed for the Ultra-253B. Per [Artificial Analysis](https://artificialanalysis.ai/models/llama-3-1-nemotron-ultra-253b-v1-reasoning/providers).

### 2.8 Other Confirmed Providers

The following providers are confirmed to host Nemotron 3 Super (and in some cases Nano):

| Provider | Models Available | Notes |
|----------|----------------|-------|
| **Baseten** | Nemotron 3 Super, Nano | ~$0.41/M blended for Super |
| **Cloudflare** | Nemotron 3 Super | Workers AI platform |
| **CoreWeave** | Nemotron 3 Super | GPU cloud |
| **FriendliAI** | Nemotron 3 Super, Nano | -- |
| **Google Cloud** | Nemotron 3 Super | Via GCP marketplace/deployment |
| **Inference.net** | Nemotron 3 Super | -- |
| **Lightning AI** | Nemotron 3 Super | $0.75/M output |
| **Modal** | Nemotron 3 Super | Serverless GPU |
| **Replicate** | Nemotron models (via HF Inference) | Community interest confirmed |

### 2.9 Providers NOT Currently Hosting Nemotron

| Provider | Status |
|----------|--------|
| **Azure AI / Azure OpenAI** | No Nemotron models found |
| **Google Vertex AI** | Not as a managed model (though GCP deployment is available) |
| **Groq** | Not available; community feature requests exist on [Groq forums](https://community.groq.com/t/nemotron-3-series/856). The Mamba-Transformer hybrid architecture may require custom kernel support on Groq LPUs. |

---

## 3. Pricing Summary (Best Available Rates)

For quick reference, here are the cheapest known API prices per model as of March 2026:

| Model | Best Input $/M | Best Output $/M | Cheapest Provider |
|-------|---------------|----------------|-------------------|
| Nemotron 3 Super 120B-A12B | **$0.00** | **$0.00** | OpenRouter (free) |
| Nemotron 3 Nano 30B-A3B | **$0.00** | **$0.00** | OpenRouter (free) |
| Nemotron Nano 9B v2 | **$0.00** | **$0.00** | OpenRouter (free) |
| Nemotron Nano 12B v2 VL | **$0.00** | **$0.00** | OpenRouter (free) |
| Llama-3.3-Nemotron-Super-49B v1.5 | $0.10 | $0.40 | DeepInfra |
| Llama-3.1-Nemotron-Ultra-253B v1 | $0.60 | $1.80 | Nebius |
| Llama-3.1-Nemotron-70B-Instruct | $1.20 | $1.20 | DeepInfra |

*Note: Free tiers on OpenRouter and build.nvidia.com have rate limits and may use lower-priority routing.*

For paid tiers, **DeepInfra** consistently offers the lowest prices across the Nemotron lineup.

---

## 4. What Is Coming Next

- **Nemotron 3 Ultra (~500B/50B active):** Expected in the first half of 2026. This will be the largest Nemotron model, targeting deep research, strategic planning, and large-scale multi-agent coordination. No API provider has announced availability yet.
- **NemoClaw Coalition:** NVIDIA has brought together eight AI labs to collaborate on building open frontier models using Nemotron infrastructure, per [Tom's Hardware](https://www.tomshardware.com/tech-industry/artificial-intelligence/nvidias-nemoclaw-coalition-brings-eight-ai-labs-together-to-build-open-frontier-models).
- **Blackwell-powered inference:** Providers including Baseten, DeepInfra, Fireworks AI, and Together AI are deploying on NVIDIA Blackwell GPUs, enabling up to 10x cost reduction per token compared to Hopper, per [NVIDIA Blog](https://blogs.nvidia.com/blog/inference-open-source-models-blackwell-reduce-cost-per-token/).

---

## 5. Conclusion

The Nemotron ecosystem has grown rapidly from the single Nemotron-4 340B release in mid-2024 to a diverse family of approximately 14+ models spanning 9B to 500B parameters. The key takeaways:

1. **Nemotron 3 Super (120B/12B active) is the current flagship** -- available now across 12+ providers with pricing as low as free (OpenRouter) or $0.10/M input (DeepInfra). Its hybrid Mamba-Transformer MoE architecture delivers exceptional throughput.

2. **For budget-conscious usage**, the Nemotron Nano 9B v2 at $0.04/M input on DeepInfra is remarkably cheap, and the Nemotron 3 Nano 30B-A3B offers strong reasoning at $0.05/M input.

3. **For maximum capability**, the Llama-Nemotron-Ultra-253B is the largest currently available model, hosted by Nebius at $0.60/$1.80 per M tokens. The upcoming Nemotron 3 Ultra (500B) will surpass it.

4. **NVIDIA NIM (build.nvidia.com) provides free API access** to most Nemotron models with rate limits -- ideal for development and testing.

5. **Notable gaps:** No Nemotron models are available on Azure AI, Vertex AI (as managed endpoints), or Groq as of March 2026.

---

## References

1. [NVIDIA Debuts Nemotron 3 Family of Open Models - NVIDIA Newsroom](https://nvidianews.nvidia.com/news/nvidia-debuts-nemotron-3-family-of-open-models)
2. [NVIDIA Nemotron Product Page](https://www.nvidia.com/en-us/ai-data-science/foundation-models/nemotron/)
3. [Nemotron AI Models - NVIDIA Developer](https://developer.nvidia.com/nemotron)
4. [NVIDIA Nemotron API Pricing Guide 2026 - DeepInfra](https://deepinfra.com/blog/nvidia-nemotron-api-pricing-guide-2026)
5. [Nemotron 3 Super on OpenRouter](https://openrouter.ai/nvidia/nemotron-3-super-120b-a12b)
6. [Nemotron 3 Nano on OpenRouter](https://openrouter.ai/nvidia/nemotron-3-nano-30b-a3b)
7. [Llama Nemotron Ultra 253B - Artificial Analysis](https://artificialanalysis.ai/models/llama-3-1-nemotron-ultra-253b-v1-reasoning/providers)
8. [Nemotron 3 Super Providers - Artificial Analysis](https://artificialanalysis.ai/models/nvidia-nemotron-3-super-120b-a12b/providers)
9. [NVIDIA NIM on build.nvidia.com](https://build.nvidia.com/nvidia)
10. [Nemotron 3 Nano on AWS Bedrock](https://aws.amazon.com/blogs/machine-learning/run-nvidia-nemotron-3-nano-as-a-fully-managed-serverless-model-on-amazon-bedrock/)
11. [Together AI - Nemotron 3 Super](https://www.together.ai/models/nvidia-nemotron-3-super)
12. [Introducing Nemotron 3 Super - NVIDIA Technical Blog](https://developer.nvidia.com/blog/introducing-nemotron-3-super-an-open-hybrid-mamba-transformer-moe-for-agentic-reasoning/)
13. [Nemotron-4 340B Technical Report - arXiv](https://arxiv.org/abs/2406.11704)
14. [Leading Inference Providers Cut AI Costs with Blackwell - NVIDIA Blog](https://blogs.nvidia.com/blog/inference-open-source-models-blackwell-reduce-cost-per-token/)
15. [Llama-3.3-Nemotron-Super-49B v1.5 on OpenRouter](https://openrouter.ai/nvidia/llama-3.3-nemotron-super-49b-v1.5)
16. [Nemotron 3 Nano Pricing Analysis - The Data Scientist](https://thedatascientist.com/nvidia-nemotron-3-nano-api-pricing-analysis/)
17. [Groq Community - Nemotron 3 Series Feature Request](https://community.groq.com/t/nemotron-3-series/856)
18. [NVIDIA-NeMo/Nemotron GitHub Repository](https://github.com/NVIDIA-NeMo/Nemotron)
19. [OpenRouter NVIDIA Models Page](https://openrouter.ai/nvidia)
20. [DeepInfra Nemotron Models](https://deepinfra.com/nemotron)
