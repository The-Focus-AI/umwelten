# NVIDIA Nemotron-3 Model Family: Complete Inventory

**Date:** March 31, 2026
**Scope:** All models with "Nemotron-3" in the name -- excludes Llama-Nemotron, Nemotron-2, Nemotron-1, and Qwen-Nemotron variants.

---

## Abstract

The NVIDIA Nemotron-3 family is a set of open-weight large language models announced on December 15, 2025, designed for agentic AI workloads. The family spans three tiers -- Nano, Super, and Ultra -- covering parameter counts from 4 billion to approximately 500 billion. All models share a hybrid Mamba-Transformer Mixture-of-Experts (MoE) architecture that activates only a fraction of total parameters per token, enabling high throughput with competitive accuracy. As of March 31, 2026, the Nano (both 30B and 4B) and Super (120B) models have been publicly released with open weights on HuggingFace and NVIDIA NIM (build.nvidia.com). The Ultra (~500B) remains announced but unreleased.

---

## 1. Family Overview

| Tier | Total Params | Active Params | Architecture | Announced | Weights Released |
|------|-------------|---------------|--------------|-----------|-----------------|
| **Nano 30B** | ~31.6B | 3.5B | Hybrid Mamba-2 + Transformer MoE | Dec 15, 2025 | Dec 15, 2025 |
| **Nano 4B** | 3.97B | 3.97B (dense) | Mamba-2 + Transformer Hybrid | Dec 15, 2025 | Mar 16-17, 2026 |
| **Super 120B** | ~124B | 12B | Hybrid Mamba-2 + LatentMoE | Dec 15, 2025 | Mar 11, 2026 |
| **Ultra ~500B** | ~500B | ~50B | Hybrid Mamba-2 + LatentMoE | Dec 15, 2025 | **Not yet released** (expected H1 2026) |

---

## 2. Detailed Model Specifications

### 2.1 Nemotron-3 Nano 30B-A3B

The first model released in the family. A sparse MoE model that activates only 3.5B of its 31.6B total parameters per forward pass.

**Architecture:**
- 52 total layers: 23 Mamba-2 layers, 23 MoE layers, 6 Attention layers (Grouped Query Attention with 2 groups)
- MoE configuration: 128 routed experts + 1 shared expert per MoE layer, 6 experts activated per token
- Context length: up to 1M tokens (default config: 256K)
- Languages: English, German, Spanish, French, Italian, Japanese

**Training:**
- Pre-training: 25 trillion tokens (cutoff: June 25, 2025)
- Post-training: SFT + RLVR + RLHF (cutoff: November 28, 2025)

**Key Benchmarks:**
- MMLU-Pro: 78.3
- AIME25 (with tools): 99.2
- LiveCodeBench: 68.3
- SWE-Bench: 38.8
- RULER-100 @ 1M tokens: 86.3

**HuggingFace Variants (all by nvidia/):**

| Model ID | Format | HF Param Count | Released |
|----------|--------|----------------|----------|
| `NVIDIA-Nemotron-3-Nano-30B-A3B-BF16` | Instruct, BF16 | 32B | Dec 15, 2025 |
| `NVIDIA-Nemotron-3-Nano-30B-A3B-FP8` | Instruct, FP8 | 32B | Dec 15, 2025 |
| `NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4` | Instruct, NVFP4 | 18B | ~Mar 2026 |
| `NVIDIA-Nemotron-3-Nano-30B-A3B-Base-BF16` | Base (pretrained only), BF16 | 32B | ~Mar 2026 |

**NVIDIA NIM (build.nvidia.com):**
- Endpoint: `nemotron-3-nano-30b-a3b`
- Created: December 15, 2025
- Last updated: January 29, 2026

Sources: [HuggingFace Model Card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16), [NVIDIA NIM](https://build.nvidia.com/nvidia/nemotron-3-nano-30b-a3b/modelcard), [NVIDIA Research](https://research.nvidia.com/labs/nemotron/Nemotron-3/)

---

### 2.2 Nemotron-3 Nano 4B

A dense (non-MoE) edge model derived from Nemotron Nano 9B v2 via structured pruning using the Nemotron Elastic framework. Unlike the 30B variant, this is NOT a MoE model -- all 3.97B parameters are active.

**Architecture:**
- 42 layers: 21 Mamba-2 layers, 4 Attention layers, 17 MLP layers
- Mamba heads: 96
- Embedding dimension: 3,136
- FFN intermediate dimension: 12,544
- Context length: up to 262K tokens
- Parent model: NVIDIA-Nemotron-Nano-9B-v2 (compressed via Nemotron Elastic)
- Compression: Two-stage distillation (short-context 8K @ 63B tokens, then long-context 49K @ 150B tokens)

**Training:**
- Training dates: December 2025 - January 2026
- Pre-training data: 10+ trillion tokens
- Data freshness cutoff: September 2024

**Key Benchmarks (Reasoning-On Mode):**
- MATH500: 95.4
- AIME25: 78.5
- GPQA: 53.2
- IFEval-Instruction: 92.0

**Target Platforms:** NVIDIA Jetson Thor, Jetson Orin Nano (8GB), GeForce RTX, DGX Spark

**HuggingFace Variants (all by nvidia/):**

| Model ID | Format | HF Param Count | Released |
|----------|--------|----------------|----------|
| `NVIDIA-Nemotron-3-Nano-4B-BF16` | Instruct, BF16 | ~4B | Mar 16, 2026 |
| `NVIDIA-Nemotron-3-Nano-4B-FP8` | Instruct, FP8 | 4B | Mar 16, 2026 |
| `NVIDIA-Nemotron-3-Nano-4B-GGUF` | Instruct, GGUF (Q4_K_M) | 4B | Mar 16, 2026 |

Sources: [HuggingFace Model Card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16), [HuggingFace Blog](https://huggingface.co/blog/nvidia/nemotron-3-nano-4b)

---

### 2.3 Nemotron-3 Super 120B-A12B

The mid-tier model optimized for collaborative agents and high-volume workloads. Uses a more advanced LatentMoE architecture compared to the Nano 30B's standard MoE.

**Architecture:**
- Hybrid Mamba-2 + LatentMoE + Attention layers
- Total parameters: ~124B (reported as "120B" in the name)
- Active parameters: 12B per token
- Latent MoE: Compresses tokens before they reach experts, enabling 4x as many expert consultations at the same compute cost
- Multi-Token Prediction (MTP): Forecasts multiple future tokens simultaneously (up to 3x wall-clock speedups for structured generation)
- Native NVFP4 pre-training: Trained in 4-bit precision from the start on NVIDIA B200
- Context length: up to 1M tokens (default config: 256K)
- Languages: English, French, German, Italian, Japanese, Spanish, Chinese (base model supports 20 languages)

**Training:**
- Pre-training: 25+ trillion tokens (cutoff: June 2025; base model cutoff: December 2025)
- Post-training: SFT + multi-environment RL (GRPO + RLHF) (cutoff: February 2026)

**Key Benchmarks:**
- AIME25 (no tools): 90.21%
- HMMT Feb25 (with tools): 94.73%
- SWE-Bench (OpenHands): 60.47%
- MMLU-Pro: 83.73%
- RULER @ 1M tokens: 91.75%

**Hardware Requirements:** Minimum 8x H100-80GB; single B200/B300 for BF16

**HuggingFace Variants (all by nvidia/):**

| Model ID | Format | HF Param Count | Released |
|----------|--------|----------------|----------|
| `NVIDIA-Nemotron-3-Super-120B-A12B-BF16` | Instruct, BF16 | 124B | Mar 11, 2026 |
| `NVIDIA-Nemotron-3-Super-120B-A12B-FP8` | Instruct, FP8 | 124B | Mar 11, 2026 |
| `NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4` | Instruct, NVFP4 | 67B | ~Mar 2026 |
| `NVIDIA-Nemotron-3-Super-120B-A12B-Base-BF16` | Base (pretrained only), BF16 | 124B | Mar 4, 2026 |

**NVIDIA NIM (build.nvidia.com):**
- Endpoint: `nemotron-3-super-120b-a12b`
- Created: March 11, 2026
- Also available on: OpenRouter, Perplexity, DeepInfra, Baseten, Cloudflare, CoreWeave, DigitalOcean

Sources: [HuggingFace Model Card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16), [NVIDIA Developer Blog](https://developer.nvidia.com/blog/introducing-nemotron-3-super-an-open-hybrid-mamba-transformer-moe-for-agentic-reasoning/), [NVIDIA NIM](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b/modelcard)

---

### 2.4 Nemotron-3 Ultra ~500B-A50B

The largest model in the family. Announced but NOT yet released as of March 31, 2026.

**Known Specifications:**
- Total parameters: ~500 billion
- Active parameters: ~50 billion per token
- Architecture: Hybrid Mamba-2 + Transformer LatentMoE (same family as Super but scaled up)
- Context length: 1M tokens
- Training: NVFP4 precision on NVIDIA Blackwell GPUs, 3 trillion token dataset
- Includes reinforcement learning for agentic tasks

**Intended Use Cases:**
- Deep research
- Strategic planning
- Large-scale multi-agent coordination

**Release Status:**
- Announced: December 15, 2025
- Expected availability: H1 2026
- As of March 31, 2026: No weights on HuggingFace, no endpoint on build.nvidia.com
- License will be NVIDIA Nemotron Open Model License (per announcement)

Sources: [NVIDIA Newsroom](https://nvidianews.nvidia.com/news/nvidia-debuts-nemotron-3-family-of-open-models), [LLM Database](https://llmdb.com/models/nemotron-3-ultra), [NVIDIA Research](https://research.nvidia.com/labs/nemotron/Nemotron-3/)

---

## 3. Complete HuggingFace Model List (Official NVIDIA uploads only)

All models are under the `nvidia/` organization and collected at [NVIDIA Nemotron v3 Collection](https://huggingface.co/collections/nvidia/nvidia-nemotron-v3).

| # | Model ID | Tier | Total Params | Active Params | Format | Type | Release Date |
|---|----------|------|-------------|---------------|--------|------|-------------|
| 1 | `NVIDIA-Nemotron-3-Nano-30B-A3B-BF16` | Nano | 31.6B | 3.5B | BF16 | Instruct | Dec 15, 2025 |
| 2 | `NVIDIA-Nemotron-3-Nano-30B-A3B-FP8` | Nano | 31.6B | 3.5B | FP8 | Instruct | Dec 15, 2025 |
| 3 | `NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4` | Nano | 31.6B | 3.5B | NVFP4 | Instruct | ~Mar 2026 |
| 4 | `NVIDIA-Nemotron-3-Nano-30B-A3B-Base-BF16` | Nano | 31.6B | 3.5B | BF16 | Base | ~Mar 2026 |
| 5 | `NVIDIA-Nemotron-3-Nano-4B-BF16` | Nano | 3.97B | 3.97B | BF16 | Instruct | Mar 16, 2026 |
| 6 | `NVIDIA-Nemotron-3-Nano-4B-FP8` | Nano | 3.97B | 3.97B | FP8 | Instruct | Mar 16, 2026 |
| 7 | `NVIDIA-Nemotron-3-Nano-4B-GGUF` | Nano | 3.97B | 3.97B | GGUF | Instruct | Mar 16, 2026 |
| 8 | `NVIDIA-Nemotron-3-Super-120B-A12B-BF16` | Super | ~124B | 12B | BF16 | Instruct | Mar 11, 2026 |
| 9 | `NVIDIA-Nemotron-3-Super-120B-A12B-FP8` | Super | ~124B | 12B | FP8 | Instruct | Mar 11, 2026 |
| 10 | `NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4` | Super | ~124B | 12B | NVFP4 | Instruct | ~Mar 2026 |
| 11 | `NVIDIA-Nemotron-3-Super-120B-A12B-Base-BF16` | Super | ~124B | 12B | BF16 | Base | Mar 4, 2026 |

**Third-party GGUF re-quantizations** (not official NVIDIA uploads):
- `unsloth/Nemotron-3-Nano-30B-A3B-GGUF`
- `unsloth/NVIDIA-Nemotron-3-Super-120B-A12B-GGUF`

---

## 4. NVIDIA NIM / build.nvidia.com Endpoints

| Model | Endpoint | Status |
|-------|----------|--------|
| Nemotron-3 Nano 30B | `nemotron-3-nano-30b-a3b` | Live (since Dec 15, 2025) |
| Nemotron-3 Super 120B | `nemotron-3-super-120b-a12b` | Live (since Mar 11, 2026) |
| Nemotron-3 Nano 4B | Available via DGX Spark page | Live |
| Nemotron-3 Ultra | -- | Not yet available |

---

## 5. Key Architectural Distinctions Across the Family

| Feature | Nano 4B | Nano 30B | Super 120B | Ultra ~500B |
|---------|---------|----------|------------|-------------|
| MoE? | No (dense) | Yes (128 experts) | Yes (LatentMoE) | Yes (LatentMoE) |
| Mamba-2 layers | Yes | Yes | Yes | Yes |
| Attention layers | 4 | 6 | Select | TBD |
| Multi-Token Prediction | No | No | Yes | Yes |
| NVFP4 native training | No | No | Yes | Yes |
| Max context | 262K | 1M | 1M | 1M |
| Derived from | Nemotron Nano 9B v2 | Trained from scratch | Trained from scratch | Trained from scratch |

---

## 6. Timeline Summary

| Date | Event |
|------|-------|
| **Dec 15, 2025** | Family announced. Nano 30B-A3B released (BF16, FP8) on HuggingFace and build.nvidia.com. Super and Ultra announced for H1 2026. |
| **Mar 4, 2026** | Super 120B Base model uploaded to HuggingFace. |
| **Mar 11, 2026** | Super 120B Instruct released (BF16, FP8) on HuggingFace, build.nvidia.com, OpenRouter, and other providers. |
| **Mar 16-17, 2026** | Nano 4B released (BF16, FP8, GGUF) on HuggingFace. |
| **~Mar 2026** | NVFP4 variants added for both Nano 30B and Super 120B; Nano 30B Base model uploaded. |
| **H1 2026 (TBD)** | Ultra ~500B expected release. No weights available as of Mar 31, 2026. |

---

## References

1. [NVIDIA Debuts Nemotron 3 Family of Open Models - NVIDIA Newsroom](https://nvidianews.nvidia.com/news/nvidia-debuts-nemotron-3-family-of-open-models) (Dec 15, 2025)
2. [NVIDIA Nemotron 3 Family of Models - NVIDIA Research](https://research.nvidia.com/labs/nemotron/Nemotron-3/)
3. [Introducing Nemotron 3 Super - NVIDIA Developer Blog](https://developer.nvidia.com/blog/introducing-nemotron-3-super-an-open-hybrid-mamba-transformer-moe-for-agentic-reasoning/) (Mar 11, 2026)
4. [NVIDIA Nemotron v3 Collection - HuggingFace](https://huggingface.co/collections/nvidia/nvidia-nemotron-v3)
5. [NVIDIA-Nemotron-3-Nano-30B-A3B-BF16 - HuggingFace](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16)
6. [NVIDIA-Nemotron-3-Nano-4B-BF16 - HuggingFace](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16)
7. [Nemotron 3 Nano 4B Blog - HuggingFace](https://huggingface.co/blog/nvidia/nemotron-3-nano-4b)
8. [NVIDIA-Nemotron-3-Super-120B-A12B-BF16 - HuggingFace](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16)
9. [NVIDIA-Nemotron-3-Super-120B-A12B-Base-BF16 - HuggingFace](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-Base-BF16)
10. [nemotron-3-nano-30b-a3b - NVIDIA NIM / build.nvidia.com](https://build.nvidia.com/nvidia/nemotron-3-nano-30b-a3b/modelcard)
11. [nemotron-3-super-120b-a12b - NVIDIA NIM / build.nvidia.com](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b/modelcard)
12. [Nemotron 3 Ultra - LLM Database](https://llmdb.com/models/nemotron-3-ultra)
13. [Nemotron 3 Nano - Efficient Open Intelligent Models Blog - HuggingFace](https://huggingface.co/blog/nvidia/nemotron-3-nano-efficient-open-intelligent-models)
14. [Inside NVIDIA Nemotron 3 - NVIDIA Developer Blog](https://developer.nvidia.com/blog/inside-nvidia-nemotron-3-techniques-tools-and-data-that-make-it-efficient-and-accurate/)
15. [Nemotron 3 Super on Artificial Analysis](https://artificialanalysis.ai/articles/nvidia-nemotron-3-super-the-new-leader-in-open-efficient-intelligence)
