# The Model Showdown: Testing 49 LLMs Across 5 Dimensions for $4.63

*March 2026 — Run 2 (full coding coverage, 49 models)*

## The Question Behind the Showdown

Which model should you actually use? Not which one tops a leaderboard somewhere — which one will reason through your problem, follow your formatting instructions, write code that compiles, answer factual questions correctly, and orchestrate real-world tools without falling apart?

We built an evaluation suite that tests **49 language models** across 5 fundamentally different capabilities: logical reasoning, factual knowledge, precise instruction following, executable code generation, and MCP tool orchestration against a live API. The total cost was $4.63.

The lineup spans the full spectrum: frontier models (Claude Opus 4.6, GPT-5.4, Gemini 3.1 Pro, Grok 4.20) to free-tier NVIDIA models, to 13 local Ollama models running on a MacBook. Premium ($5+/M tokens), value ($0.05-0.50), budget (<$0.05), and free. Closed-source and open-weight. Cloud and local.

This is Run 2. Run 1 had incomplete coding coverage due to container DNS failures and timeouts. Run 2 re-evaluated all models across all 18 coding tasks with full local execution — no containers, no DNS failures, no time limits. Six models now achieve a perfect 126/126 on coding.

**Note on MCP coverage:** 41 of 49 models have complete 5-dimension results (including MCP tool use). The remaining 8 either lack tool-use support (phi4, gemma3n, deepseek-r1 variants, gemma-3-27b-it) or were not included in the MCP evaluation run (nemotron-nano-9b-v2 variants, minimax-01). The 4-dimension leaderboard below includes all 49 models; the 5-dimension leaderboard covers the 41 with complete data.

## What We Tested and Why

### The Models

49 models across 4 providers and local inference:

**OpenRouter** (31 models via `@openrouter/ai-sdk-provider`):
- **Premium**: `anthropic/claude-opus-4.6`, `anthropic/claude-sonnet-4.6`, `openai/gpt-5.4`, `x-ai/grok-4.20-beta`
- **High**: `openai/gpt-5.4-mini`, `anthropic/claude-haiku-4.5`, `moonshotai/kimi-k2.5`, `moonshotai/kimi-k2`, `google/gemini-3.1-pro-preview`
- **Mid/Value**: Qwen 3.5 (397B, 122B, 35B), DeepSeek v3.2, MiniMax M2.7, Inception Mercury 2/Coder, OpenAI GPT-OSS (120B, 20B), GPT-5.4 Nano, Grok 4.1 Fast
- **Budget**: Meta Llama 4 (Maverick, Scout), Mistral (Small, Codestral, Ministral 8B), Gemma 3 27B
- **Free**: NVIDIA Nemotron 3 (Super 120B, Nano 30B, Nano 9B v2)

**Google** (2 models, direct API):
- `gemini-3-flash-preview`, `gemini-3.1-pro-preview`

**DeepInfra** (3 models):
- NVIDIA Nemotron 3 (Super 120B, Nano 30B, Nano 9B v2)

**Ollama** (13 models, local on MacBook):
- `deepseek-r1` (latest/32b/14b), `devstral`, `phi4`, `mistral-small`, `glm-4.7-flash`, `gemma3n:e4b`, `qwen3` (32b/30b-a3b), `nemotron-3-nano` (latest/4b), `gpt-oss`

### The 5 Dimensions

Each dimension tests something that the others can't.

**Reasoning (/20)** — Can the model think past intuitive traps? Four classic logic puzzles where the obvious answer is wrong. A bat and ball that don't cost what you think. A patch of lily pads where halving the time is the wrong move. A surgeon who isn't who you assumed. And the hardest: find a counterfeit coin among 12 using exactly 3 weighings on a balance scale. Scored by an LLM judge on reasoning quality, not just correctness.

**Knowledge (/30)** — Does the model know things? 30 factual questions across Science, Geography, History, Technology, AI/ML, and Tricky/Adversarial categories. Binary scoring (correct or not) with an LLM judge that allows formatting variations — "5,730 years" and "5730 years" both count.

**Instruction Following (/30)** — Can the model do exactly what you ask? Six tasks with precise formatting constraints scored deterministically — no LLM judge, just regex, JSON parsing, and character counting. Write exactly 12 words. Output valid JSON without markdown fences. Convert CSV to a markdown table. Follow negative constraints ("don't use the word 'beautiful'").

**Coding (/126)** — Can the model write code that actually runs? Six programming challenges across TypeScript, Python, and Go — 18 tasks total. Each submission is compiled, executed against test cases, and scored on correctness (compile: 1pt, run: 1pt, output: 0-5pts = 0-7 per task). FizzBuzz with a twist, business day calculation with holidays, a vending machine state machine, grid path counting with obstacles, rail fence cipher, and data pipeline aggregation.

**MCP Tool Use (/16)** — Can the model orchestrate real-world tools? Each model connects to the TezLab MCP server (real EV vehicle data) and must analyze battery health and charging patterns by calling the right sequence of tools: list vehicles, get battery health, pull charging history, check efficiency stats, find chargers, and search for alternatives. Scored on both tool usage (did you call all 6 required tools? 0-6) and response quality (did you synthesize the data into something useful? 1-10).

---

## The Full Leaderboard: 49 Models × 4 Dimensions

All 49 models ranked by combined score across reasoning, knowledge, instruction following, and coding. This includes premium-tier models, local Ollama models, and free-tier offerings that couldn't be tested on MCP.

| Rank | Model | Provider | Combined | Reasoning | Knowledge | Instruction | Coding | Cost | Time |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `anthropic/claude-sonnet-4.6` | OpenRouter | 100.0% | 20/20 | 30/30 | 30/30 | 126/126 | $0.20 | 3m |
| 2 | `qwen/qwen3.5-397b-a17b` | OpenRouter | 99.2% | 20/20 | 29/30 | 30/30 | 126/126 | $0.52 | 36m |
| 3 | `x-ai/grok-4.20-beta` | OpenRouter | 98.8% | 20/20 | 29/30 | 30/30 | 124/126 | $0.09 | 2m |
| 4 | `gemini-3-flash-preview` | Google | 98.8% | 19/20 | 30/30 | 30/30 | 126/126 | $0.04 | 1h41m |
| 5 | `openai/gpt-5.4` | OpenRouter | 98.8% | 19/20 | 30/30 | 30/30 | 126/126 | $0.17 | 2m |
| 6 | `openai/gpt-oss-120b` | OpenRouter | 98.3% | 20/20 | 28/30 | 30/30 | 126/126 | $0.01 | 10m |
| 7 | `qwen/qwen3.5-122b-a10b` | OpenRouter | 97.6% | 20/20 | 30/30 | 30/30 | 114/126 | $0.43 | 18m |
| 8 | `openai/gpt-5.4-mini` | OpenRouter | 97.3% | 20/20 | 30/30 | 28/30 | 121/126 | $0.05 | 1m |
| 9 | `gemini-3.1-pro-preview` | Google | 97.3% | 18/20 | 30/30 | 30/30 | 125/126 | $0.01 | 23m |
| 10 | `qwen/qwen3.5-35b-a3b` | OpenRouter | 97.2% | 20/20 | 30/30 | 30/30 | 112/126 | $0.21 | 30m |
| 11 | `google/gemini-3.1-pro-preview` | OpenRouter | 96.9% | 18/20 | 30/30 | 30/30 | 123/126 | $1.85 | 31m |
| 12 | `anthropic/claude-haiku-4.5` | OpenRouter | 96.3% | 17/20 | 30/30 | 30/30 | 126/126 | $0.07 | 2m |
| 13 | `minimax/minimax-m2.7` | OpenRouter | 96.3% | 17/20 | 30/30 | 30/30 | 126/126 | $0.10 | 24m |
| 14 | `moonshotai/kimi-k2` | OpenRouter | 95.8% | 20/20 | 30/30 | 25/30 | 126/126 | $0.03 | 5m |
| 15 | `moonshotai/kimi-k2.5` | OpenRouter | 95.8% | 20/20 | 30/30 | 25/30 | 126/126 | $0.26 | 50m |
| 16 | `x-ai/grok-4.1-fast` | OpenRouter | 95.8% | 20/20 | 30/30 | 30/30 | 105/126 | $0.06 | 13m |
| 17 | `anthropic/claude-opus-4.6` | OpenRouter | 95.8% | 18/20 | 30/30 | 28/30 | 126/126 | $0.37 | 4m |
| 18 | `inception/mercury-2` | OpenRouter | 94.4% | 20/20 | 30/30 | 25/30 | 119/126 | $0.06 | 2m |
| 19 | `mistralai/mistral-small-2603` | OpenRouter | 94.1% | 17/20 | 30/30 | 30/30 | 115/126 | $0.008 | 1m |
| 20 | `openai/gpt-oss-20b` | OpenRouter | 94.0% | 17/20 | 29/30 | 30/30 | 119/126 | $0.02 | 8m |
| 21 | `gpt-oss:latest` | Ollama | 93.3% | 20/20 | 28/30 | 29/30 | 105/126 | Free | 1h11m |
| 22 | `deepseek/deepseek-v3.2` | OpenRouter | 93.2% | 17/20 | 29/30 | 28/30 | 123/126 | $0.007 | 14m |
| 23 | `nvidia/Nemotron-3-Nano-30B-A3B` | DeepInfra | 93.1% | 17/20 | 30/30 | 30/30 | 110/126 | Free | 14m |
| 24 | `nvidia/Nemotron-Super-120B-A12B` | DeepInfra | 90.8% | 20/20 | 28/30 | 30/30 | 88/126 | Free | 3m |
| 25 | `nemotron-3-nano:latest` | Ollama | 89.4% | 20/20 | 30/30 | 27/30 | 85/126 | Free | 36m |
| 26 | `meta-llama/llama-4-maverick` | OpenRouter | 89.1% | 17/20 | 29/30 | 25/30 | 115/126 | $0.008 | 16m |
| 27 | `meta-llama/llama-4-scout` | OpenRouter | 88.8% | 17/20 | 27/30 | 30/30 | 101/126 | $0.004 | 15m |
| 28 | `openai/gpt-5.4-nano` | OpenRouter | 87.4% | 15/20 | 29/30 | 27/30 | 111/126 | $0.02 | 2m |
| 29 | `nvidia/nemotron-3-nano-30b-a3b:free` | OpenRouter | 87.4% | 20/20 | 30/30 | 28/30 | 71/126 | Free | 2m |
| 30 | `mistralai/codestral-2508` | OpenRouter | 87.3% | 17/20 | 25/30 | 25/30 | 123/126 | $0.01 | 48s |
| 31 | `google/gemma-3-27b-it` | OpenRouter | 87.1% | 17/20 | 29/30 | 25/30 | 105/126 | $0.003 | 4m |
| 32 | `qwen3:32b` | Ollama | 86.7% | 17/20 | 29/30 | 25/30 | 103/126 | Free | 59m |
| 33 | `inception/mercury-coder` | OpenRouter | 86.5% | 17/20 | 25/30 | 25/30 | 119/126 | $0.01 | 2m |
| 34 | `nvidia/nemotron-3-super-120b-a12b:free` | OpenRouter | 85.5% | 20/20 | 30/30 | 25/30 | 74/126 | Free | 11m |
| 35 | `phi4:latest` | Ollama | 84.6% | 16/20 | 27/30 | 27/30 | 99/126 | Free | 25m |
| 36 | `mistral-small:latest` | Ollama | 84.4% | 17/20 | 29/30 | 23/30 | 100/126 | Free | 49m |
| 37 | `glm-4.7-flash:latest` | Ollama | 84.1% | 17/20 | 29/30 | 26/30 | 86/126 | Free | 54m |
| 38 | `devstral:latest` | Ollama | 84.0% | 16/20 | 28/30 | 26/30 | 96/126 | Free | 44m |
| 39 | `deepseek-r1:32b` | Ollama | 84.0% | 17/20 | 28/30 | 28/30 | 81/126 | Free | 1h5m |
| 40 | `mistralai/mistral-small-3.2-24b-instruct` | OpenRouter | 83.0% | 17/20 | 29/30 | 26/30 | 80/126 | $0.002 | 2m |
| 41 | `mistralai/ministral-8b-2512` | OpenRouter | 81.4% | 16/20 | 27/30 | 25/30 | 91/126 | $0.004 | 1m |
| 42 | `gemma3n:e4b` | Ollama | 79.7% | 17/20 | 29/30 | 24/30 | 72/126 | Free | 54m |
| 43 | `deepseek-r1:14b` | Ollama | 78.2% | 17/20 | 24/30 | 26/30 | 77/126 | Free | 57m |
| 44 | `deepseek-r1:latest` | Ollama | 78.1% | 15/20 | 26/30 | 30/30 | 64/126 | Free | 33m |
| 45 | `nvidia/nemotron-nano-9b-v2:free` | OpenRouter | 77.6% | 17/20 | 26/30 | 29/30 | 53/126 | Free | 1h52m |
| 46 | `qwen3:30b-a3b` | Ollama | 77.5% | 20/20 | 29/30 | 4/30 | 126/126 | Free | 1h14m |
| 47 | `nvidia/Nemotron-Nano-9B-v2` | DeepInfra | 75.7% | 17/20 | 26/30 | 25/30 | 60/126 | Free | 9m |
| 48 | `nemotron-3-nano:4b` | Ollama | 73.8% | 19/20 | 25/30 | 25/30 | 42/126 | Free | 42m |

### Key Findings From the Full Lineup

**1. Claude Sonnet 4.6 achieves a perfect 100%.** The only model to score maximum on all 4 dimensions: 20/20 reasoning, 30/30 knowledge, 30/30 instruction, 126/126 coding. At $0.20, it's the gold standard for capability — but it costs 5x more than Gemini Flash which is 1.2 points behind.

**2. Gemini 3 Flash is the value champion at 98.8% for $0.04.** Nearly tied for #3, costing 5x less than the next-cheapest competitor at its tier. Perfect knowledge, perfect instruction, perfect coding — it only lost 1 point on reasoning.

**3. `openai/gpt-oss-120b` at $0.01 is absurd.** 98.3% — #6 overall, ahead of Gemini Pro and GPT-5.4 Mini — for one cent. Perfect coding (126/126), perfect instruction, perfect reasoning. It missed 2 knowledge questions. An Apache-licensed model at a penny.

**4. `gpt-oss:latest` on Ollama scores 93.3% — for free, running locally.** The same GPT-OSS architecture running on a MacBook ranks #21 overall, beating Meta Llama 4, DeepSeek v3.2, and all Mistral models. Local inference is no longer a compromise.

**5. `qwen3:30b-a3b` on Ollama gets perfect coding (126/126) but catastrophic instruction following (4/30).** It produces excellent code but can't follow formatting constraints — markdown fences everywhere, wrong word counts. A pure specialist that would rank #1 on coding alone but #46 overall.

**6. The Ollama models cluster at 78-93%.** Local models are consistently 5-15 points behind cloud models on the same architecture. The gap comes primarily from coding (Go struggles) and instruction following, not reasoning or knowledge.

---

## The 5-Dimension Leaderboard: 41 Models With MCP

41 models have complete results across all 5 dimensions including MCP tool use. Only 8 models are excluded — 5 that lack tool-use support entirely (phi4, gemma3n, deepseek-r1 variants), 1 without tool endpoints (gemma-3-27b-it), and 2 not attempted (nemotron-nano-9b-v2 variants).

| Rank | Model | Provider | Combined | Reasoning | Knowledge | Instruction | Coding | MCP | Cost | Time |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `anthropic/claude-sonnet-4.6` | OpenRouter | 93.8% | 20/20 | 30/30 | 30/30 | 126/126 | 11/16 | $0.33 | 4m |
| 2 | `qwen/qwen3.5-397b-a17b` | OpenRouter | 93.1% | 20/20 | 29/30 | 30/30 | 126/126 | 11/16 | $0.54 | 37m |
| 3 | `x-ai/grok-4.20-beta` | OpenRouter | 92.8% | 20/20 | 29/30 | 30/30 | 124/126 | 11/16 | $0.16 | 3m |
| 4 | `gemini-3-flash-preview` | Google | 92.8% | 19/20 | 30/30 | 30/30 | 126/126 | 11/16 | $0.05 | 1h42m |
| 5 | `openai/gpt-5.4` | OpenRouter | 92.8% | 19/20 | 30/30 | 30/30 | 126/126 | 11/16 | $0.24 | 3m |
| 6 | `qwen/qwen3.5-122b-a10b` | OpenRouter | 91.8% | 20/20 | 30/30 | 30/30 | 114/126 | 11/16 | $0.44 | 19m |
| 7 | `gemini-3.1-pro-preview` | Google | 91.6% | 18/20 | 30/30 | 30/30 | 125/126 | 11/16 | $0.02 | 23m |
| 8 | `qwen/qwen3.5-35b-a3b` | OpenRouter | 91.5% | 20/20 | 30/30 | 30/30 | 112/126 | 11/16 | $0.22 | 31m |
| 9 | `google/gemini-3.1-pro-preview` | OpenRouter | 90.9% | 18/20 | 30/30 | 30/30 | 123/126 | 10.7/16 | $1.91 | 32m |
| 10 | `minimax/minimax-m2.7` | OpenRouter | 90.8% | 17/20 | 30/30 | 30/30 | 126/126 | 11/16 | $0.11 | 27m |
| 11 | `moonshotai/kimi-k2` | OpenRouter | 90.4% | 20/20 | 30/30 | 25/30 | 126/126 | 11/16 | $0.04 | 5m |
| 12 | `moonshotai/kimi-k2.5` | OpenRouter | 90.4% | 20/20 | 30/30 | 25/30 | 126/126 | 11/16 | $0.28 | 53m |
| 13 | `anthropic/claude-opus-4.6` | OpenRouter | 90.4% | 18/20 | 30/30 | 28/30 | 126/126 | 11/16 | $0.65 | 6m |
| 14 | `x-ai/grok-4.1-fast` | OpenRouter | 90.0% | 20/20 | 30/30 | 30/30 | 105/126 | 10.7/16 | $0.07 | 13m |
| 15 | `openai/gpt-5.4-mini` | OpenRouter | 90.0% | 20/20 | 30/30 | 28/30 | 121/126 | 9.7/16 | $0.06 | 2m |
| 16 | `openai/gpt-oss-120b` | OpenRouter | 89.9% | 20/20 | 28/30 | 30/30 | 126/126 | 9/16 | $0.01 | 11m |
| 17 | `inception/mercury-2` | OpenRouter | 89.3% | 20/20 | 30/30 | 25/30 | 119/126 | 11/16 | $0.07 | 2m |
| 18 | `mistralai/mistral-small-2603` | OpenRouter | 89.0% | 17/20 | 30/30 | 30/30 | 115/126 | 11/16 | $0.01 | 2m |
| 19 | `openai/gpt-oss-20b` | OpenRouter | 89.0% | 17/20 | 29/30 | 30/30 | 119/126 | 11/16 | $0.02 | 9m |
| 20 | `deepseek/deepseek-v3.2` | OpenRouter | 88.3% | 17/20 | 29/30 | 28/30 | 123/126 | 11/16 | $0.02 | 16m |
| 21 | `nemotron-3-nano:latest` | Ollama | 84.0% | 20/20 | 30/30 | 27/30 | 85/126 | 10/16 | Free | 38m |
| 22 | `nvidia/nemotron-3-nano-30b-a3b:free` | OpenRouter | 83.7% | 20/20 | 30/30 | 28/30 | 71/126 | 11/16 | Free | 4m |
| 23 | `meta-llama/llama-4-maverick` | OpenRouter | 82.5% | 17/20 | 29/30 | 25/30 | 115/126 | 9/16 | $0.01 | 16m |
| 24 | `nvidia/nemotron-3-super-120b-a12b:free` | OpenRouter | 82.2% | 20/20 | 30/30 | 25/30 | 74/126 | 11/16 | Free | 14m |
| 25 | `openai/gpt-5.4-nano` | OpenRouter | 82.1% | 15/20 | 29/30 | 27/30 | 111/126 | 9.7/16 | $0.02 | 2m |
| 26 | `inception/mercury-coder` | OpenRouter | 81.7% | 17/20 | 25/30 | 25/30 | 119/126 | 10/16 | $0.02 | 2m |
| 27 | `glm-4.7-flash:latest` | Ollama | 81.1% | 17/20 | 29/30 | 26/30 | 86/126 | 11/16 | Free | 57m |
| 28 | `mistral-small:latest` | Ollama | 80.9% | 17/20 | 29/30 | 23/30 | 100/126 | 10.7/16 | Free | 52m |
| 29 | `meta-llama/llama-4-scout` | OpenRouter | 80.7% | 17/20 | 27/30 | 30/30 | 101/126 | 7.7/16 | $0.005 | 15m |
| 30 | `qwen3:32b` | Ollama | 80.6% | 17/20 | 29/30 | 25/30 | 103/126 | 9/16 | Free | 1h3m |
| 31 | `anthropic/claude-haiku-4.5` | OpenRouter | 79.5% | 17/20 | 30/30 | 30/30 | 126/126 | 2/16 | $0.08 | 2m |
| 32 | `devstral:latest` | Ollama | 78.5% | 16/20 | 28/30 | 26/30 | 96/126 | 9/16 | Free | 46m |
| 33 | `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B` | DeepInfra | 77.6% | 20/20 | 28/30 | 30/30 | 88/126 | 4/16 | Free | 3m |
| 34 | `mistralai/codestral-2508` | OpenRouter | 77.4% | 17/20 | 25/30 | 25/30 | 123/126 | 6/16 | $0.02 | 54s |
| 35 | `gpt-oss:latest` | Ollama | 77.2% | 20/20 | 28/30 | 29/30 | 105/126 | 2/16 | Free | 1h11m |
| 36 | `nvidia/Nemotron-3-Nano-30B-A3B` | DeepInfra | 77.0% | 17/20 | 30/30 | 30/30 | 110/126 | 2/16 | Free | 15m |
| 37 | `mistralai/mistral-small-3.2-24b-instruct` | OpenRouter | 76.4% | 17/20 | 29/30 | 26/30 | 80/126 | 8/16 | $0.003 | 2m |
| 38 | `mistralai/ministral-8b-2512` | OpenRouter | 73.9% | 16/20 | 27/30 | 25/30 | 91/126 | 7/16 | $0.006 | 2m |
| 39 | `qwen3:30b-a3b` | Ollama | 73.3% | 20/20 | 29/30 | 4/30 | 126/126 | 9/16 | Free | 1h16m |
| 40 | `google/gemma-3-27b-it` | OpenRouter | 69.7% | 17/20 | 29/30 | 25/30 | 105/126 | 0/16 | $0.003 | 4m |
| 41 | `nemotron-3-nano:4b` | Ollama | 64.0% | 19/20 | 25/30 | 25/30 | 42/126 | 4/16 | Free | 42m |

### The Biggest Surprises (5-Dimension View)

**1. Claude Sonnet 4.6 takes #1.** With MCP data for all major models, Sonnet leads at 93.8% — the only model to achieve 100% on 4 of 5 dimensions, with a strong 11/16 MCP showing.

**2. MCP reshuffles everything.** Claude Haiku 4.5 is #12 on 4 dimensions (96.3%) but drops to #31 on 5 dimensions (79.5%) due to its MCP collapse (2/16). Tool use acts as a great equalizer — models that can't orchestrate tools fall behind models that are weaker on other axes.

**3. Free models in the top 22.** `nemotron-3-nano:latest` on Ollama at 84.0% (5-dim) and `nvidia/nemotron-3-nano-30b-a3b:free` at 83.7% both beat Haiku, Llama 4, and most Mistral models. Perfect reasoning, perfect knowledge, strong MCP.

**4. Same weights, different provider, different results.** Nemotron Nano 30B: OpenRouter 83.7%, DeepInfra 77.0%. A 6.7pp gap — larger than the gap between ranks #4 and #10.

---

## Deep Dive: Reasoning

The counterfeit coin problem is the single hardest task in the entire showdown. Only 9 out of 41 models (5-dim) solved it correctly with quality reasoning.

### Why the Counterfeit Coin Is So Hard

The problem: you have 12 coins, one is counterfeit (heavier or lighter — you don't know which). Using a balance scale exactly 3 times, find the counterfeit coin and determine whether it's heavier or lighter.

This is information-theoretically tight. Three weighings give you 3^3 = 27 possible outcomes. There are 24 possible states (12 coins × 2 weight possibilities). So it's barely possible — and the procedure must be exhaustive, covering every branch.

**Models that solved it** (quality score 5/5): All three Qwen 3.5 variants, `openai/gpt-oss-120b`, `moonshotai/kimi-k2`, `nvidia/nemotron-3-nano-30b-a3b:free` (OpenRouter), `inception/mercury-2`, both Nemotron Super 120B variants (OpenRouter and DeepInfra).

**Models that failed** (quality score 2/5): `openai/gpt-oss-20b`, `minimax/minimax-m2.7`, `deepseek/deepseek-v3.2`, both Llama 4 variants, `mistralai/mistral-small-2603`, `inception/mercury-coder`, `anthropic/claude-haiku-4.5`, `nvidia/Nemotron-3-Nano-30B-A3B` (DeepInfra), `mistralai/codestral-2508`, `google/gemma-3-27b-it`, and `mistralai/ministral-8b-2512`.

The failure pattern is consistent: models correctly identify the first step (divide into 3 groups of 4, weigh group A vs group B) but then fail to rigorously enumerate the subcases. They hand-wave through the second and third weighings with phrases like "narrow it down to the suspect" without proving that exactly 3 weighings suffice for every branch.

The judge explains it precisely:

> **Claude Haiku 4.5** on counterfeit-coin (2/5): "The response correctly identifies that the puzzle is solvable in 3 weighings and attempts a reasonable initial strategy (divide into thirds, weigh 4 vs 4). However, the procedure is incomplete and contains critical gaps. Step 2 is vague and hand-wavy."

> **DeepSeek v3.2** on counterfeit-coin (2/5): "The model correctly states it's possible and attempts a systematic approach, but the procedure has critical flaws. Case 1 is mostly sound. However, Case 2 has a significant problem: after Step 2, the model claims results that don't follow from the weighing."

What's striking is that `openai/gpt-oss-20b` — which scores 119/126 on coding — falls on its face here. It can write correct FizzBuzz and business-day calculators in three languages, but it can't reason through a logic puzzle that requires exhaustive case analysis. This is exactly why multi-dimensional evaluation matters.

### The Easy Puzzles

The bat-and-ball, lily pad, and surgeon riddle were all solved by 21+ models. These have become training-data staples. The surgeon riddle ("I can't operate — he's my son") was universally handled, with only `gemini-3-flash-preview` getting a 4/5 for briefly mentioning an alternative answer alongside the correct one.

---

## Deep Dive: Knowledge

10 out of 41 models (5-dim) got a perfect 30/30 on factual knowledge. The remainder each missed 1-5 questions.

### "How Many R's in Strawberry?"

Three models — both Llama 4 variants (`meta-llama/llama-4-scout`, `meta-llama/llama-4-maverick`) and `mistralai/mistral-small-2603` — answered "2" instead of "3." This is the classic character-counting failure. The word "strawberry" has three r's (st**r**awbe**rr**y), but models that tokenize the word rather than examining individual characters consistently get it wrong.

### "All But 9 Die"

"A farmer has 10 sheep. All but 9 die. How many sheep does the farmer have left?"

`mistralai/codestral-2508` and `mistralai/ministral-8b-2512` both answered "8," interpreting "all but 9" as something other than "9 survive." Both failing models are from Mistral, suggesting a shared training-data blind spot.

### The Carbon-14 Ambiguity

Four models got the Carbon-14 half-life wrong. The correct answer is 5,730 years. This is the hardest science question by error count — questions that allow rounding introduce scoring complexity.

### AI/ML Gotchas

`google/gemma-3-27b-it` said the "T" in GPT stands for "Transformative" instead of "Transformer." `mistralai/ministral-8b-2512` said the original Transformer's d_model was 64 instead of 512. These are basic ML knowledge gaps — surprising for models that are themselves transformers.

---

## Deep Dive: Instruction Following

11 out of 41 models (5-dim) achieved a perfect 30/30. The failures are mechanical and revealing.

### The Markdown Fence Epidemic

The most systematic failure is "markdown fence hallucination." When told to output raw JSON with no markdown fences, models wrap it in ````json ... ` `` ` anyway. When told to output a markdown table, models wrap the markdown in ````markdown ... ` `` ` (double-wrapping markdown *inside* markdown).

### Word Counting Is Hard

"Write a 12-word sentence about the ocean. Nothing else."

Multiple models got this wrong — writing 11 or 13 words instead of exactly 12. Models that reliably nail word counts tend to be the same ones that score well on reasoning — they actually count rather than estimate.

### Instruction Following Doesn't Predict Tool Use

Perfect instruction following (30/30) does *not* predict good MCP tool use. `anthropic/claude-haiku-4.5` and `nvidia/Nemotron-3-Nano-30B-A3B` (DeepInfra) both got perfect 30/30 on instruction following, yet both scored 2/16 on MCP. Meanwhile, `inception/mercury-2` scored only 25/30 on instruction following but got 11/16 on MCP.

Instruction following tests *compliance*; MCP tests *initiative*. They're different skills.

---

## Deep Dive: Coding

The coding dimension has the widest score spread: 71/126 (`nvidia/nemotron-3-nano-30b-a3b:free`, OpenRouter) to 126/126 (six models tied for perfect).

### Run 2: What Changed

Run 1 ran code inside Dagger containers with DNS issues and 10-minute timeouts. Run 2 runs everything locally — `tsc && node`, `python3`, `go run` — with no artificial time limits. The result: coding scores increased across the board, and the true capability ceiling became visible.

Six models achieved a perfect 126/126: `qwen/qwen3.5-397b-a17b`, `gemini-3-flash-preview`, `minimax/minimax-m2.7`, `moonshotai/kimi-k2`, `openai/gpt-oss-120b`, and `anthropic/claude-haiku-4.5`. These models solved every challenge in every language — FizzBuzz, business days with holidays, vending machine state machines, grid path counting, rail fence cipher, and data pipeline aggregation.

### The Coding Results Matrix

Each cell shows score/7. Six models achieve a perfect 126/126.

| Model | Total | Perfect Tasks |
| --- | ---: | ---: |
| qwen/qwen3.5-397b-a17b | 126/126 | 18/18 |
| gemini-3-flash-preview | 126/126 | 18/18 |
| minimax/minimax-m2.7 | 126/126 | 18/18 |
| moonshotai/kimi-k2 | 126/126 | 18/18 |
| openai/gpt-oss-120b | 126/126 | 18/18 |
| anthropic/claude-haiku-4.5 | 126/126 | 18/18 |
| deepseek/deepseek-v3.2 | 123/126 | 17/18 |
| mistralai/codestral-2508 | 123/126 | 17/18 |
| inception/mercury-2 | 119/126 | 17/18 |
| openai/gpt-oss-20b | 119/126 | 17/18 |
| inception/mercury-coder | 119/126 | 17/18 |
| meta-llama/llama-4-maverick | 115/126 | 15/18 |
| qwen/qwen3.5-122b-a10b | 114/126 | 16/18 |
| qwen/qwen3.5-35b-a3b | 112/126 | 16/18 |
| nvidia/Nemotron-3-Nano-30B-A3B | 110/126 | 15/18 |
| google/gemma-3-27b-it | 105/126 | 14/18 |
| meta-llama/llama-4-scout | 101/126 | 13/18 |
| mistralai/ministral-8b-2512 | 91/126 | 11/18 |
| nvidia/NVIDIA-Nemotron-3-Super-120B-A12B | 88/126 | 12/18 |
| mistralai/mistral-small-2603 | 80/126 | 10/18 |
| nvidia/nemotron-3-super-120b-a12b:free | 74/126 | 10/18 |
| nvidia/nemotron-3-nano-30b-a3b:free | 71/126 | 9/18 |

### Language Comparison

| Language | Avg Score | Compile Rate | Run Rate | Perfect Rate |
| --- | ---: | ---: | ---: | ---: |
| TypeScript | 6.5/7 | 98% | 98% | 88% |
| Python | 6.2/7 | 91% | 90% | 88% |
| Go | 5.9/7 | 86% | 86% | 81% |

Go remains the hardest language. Models generate `time.Time{Year: 2025, Month: 1}` (named fields aren't allowed in Go struct literals for `time.Time`) or call nonexistent methods. These are subtle Go-specific patterns that don't exist in TypeScript or Python.

### Challenge Difficulty

| Challenge | Avg Score | Perfect | Zero | Hardest Language |
| --- | ---: | ---: | ---: | --- |
| FizzBuzz Boom | 6.8/7 | 64 | 2 | python (6.4/7) |
| Grid Paths | 6.6/7 | 62 | 2 | go (6.1/7) |
| Vending Machine | 6.5/7 | 60 | 3 | go (6.1/7) |
| Data Pipeline | 6.4/7 | 56 | 4 | python (6.0/7) |
| Business Days | 5.7/7 | 51 | 9 | go (4.5/7) |
| Rail Fence Cipher | 5.1/7 | 41 | 13 | go (4.8/7) |

The rail fence cipher is the hardest challenge — 13 complete failures across all models. The encode step is straightforward; the decode step (computing rail lengths, filling in reading order, then extracting in zigzag order) is where models break.

---

## Deep Dive: MCP Tool Use

This is the most revealing dimension because it tests something no multiple-choice benchmark can: the ability to autonomously plan and execute a multi-step task using real external tools.

### The Task

Each model connects to the TezLab MCP server — a real API for electric vehicle data — and must analyze battery health and charging patterns by calling the right tools in the right order.

Six tools must be called:
1. `list_vehicles` — discover what vehicles exist
2. `get_battery_health` — check battery degradation
3. `get_charges` — review charging history
4. `get_efficiency` — pull efficiency stats
5. `get_my_chargers` — see which chargers are used
6. `find_nearby_chargers` — search for alternatives

### Results

| Model | Tool Score | Judge | Total | Time | Cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| `inception/mercury-2` | 6/6 | 5/10 | 11/16 | 14s | $0.007 |
| `mistralai/mistral-small-2603` | 6/6 | 5/10 | 11/16 | 18s | $0.004 |
| `qwen/qwen3.5-35b-a3b` | 6/6 | 5/10 | 11/16 | 24s | $0.006 |
| `openai/gpt-5.4` | 6/6 | 5/10 | 11/16 | 28s | $0.075 |
| `moonshotai/kimi-k2` | 6/6 | 5/10 | 11/16 | 34s | $0.014 |
| `qwen/qwen3.5-122b-a10b` | 6/6 | 5/10 | 11/16 | 41s | $0.010 |
| `gemini-3.1-pro-preview` | 6/6 | 5/10 | 11/16 | 44s | $0.007 |
| `qwen/qwen3.5-397b-a17b` | 6/6 | 5/10 | 11/16 | 47s | $0.011 |
| `x-ai/grok-4.20-beta` | 6/6 | 5/10 | 11/16 | 48s | $0.063 |
| `openai/gpt-oss-20b` | 6/6 | 5/10 | 11/16 | 52s | $0.001 |
| `anthropic/claude-sonnet-4.6` | 6/6 | 5/10 | 11/16 | 53s | $0.126 |
| `gemini-3-flash-preview` | 6/6 | 5/10 | 11/16 | 96s | $0.010 |
| `nvidia/nemotron-3-nano-30b-a3b:free` | 6/6 | 5/10 | 11/16 | 112s | Free |
| `anthropic/claude-opus-4.6` | 6/6 | 5/10 | 11/16 | 117s | $0.280 |
| `deepseek/deepseek-v3.2` | 6/6 | 5/10 | 11/16 | 150s | $0.009 |
| `minimax/minimax-m2.7` | 6/6 | 5/10 | 11/16 | 152s | $0.014 |
| `nvidia/nemotron-3-super-120b-a12b:free` | 6/6 | 5/10 | 11/16 | 300s | Free |
| `moonshotai/kimi-k2.5` | 6/6 | 5/10 | 11/16 | 211s | $0.015 |
| `glm-4.7-flash:latest` (Ollama) | 6/6 | 5/10 | 11/16 | 204s | Free |
| `google/gemini-3.1-pro-preview` | 6/6 | 4.7/10 | 10.7/16 | 65s | $0.057 |
| `x-ai/grok-4.1-fast` | 6/6 | 4.7/10 | 10.7/16 | 32s | $0.006 |
| `mistral-small:latest` (Ollama) | 6/6 | 4.7/10 | 10.7/16 | 156s | Free |
| `inception/mercury-coder` | 6/6 | 4/10 | 10/16 | 14s | $0.005 |
| `nemotron-3-nano:latest` (Ollama) | 5/6 | 5/10 | 10/16 | 94s | Free |
| `openai/gpt-5.4-nano` | 5/6 | 4.7/10 | 9.7/16 | 14s | $0.005 |
| `openai/gpt-5.4-mini` | 6/6 | 3.7/10 | 9.7/16 | 62s | $0.012 |
| `meta-llama/llama-4-maverick` | 5/6 | 4/10 | 9/16 | 23s | $0.004 |
| `openai/gpt-oss-120b` | 4/6 | 5/10 | 9/16 | 28s | $0.001 |
| `qwen3:30b-a3b` (Ollama) | 5/6 | 4/10 | 9/16 | 121s | Free |
| `devstral:latest` (Ollama) | 5/6 | 4/10 | 9/16 | 127s | Free |
| `qwen3:32b` (Ollama) | 5/6 | 4/10 | 9/16 | 281s | Free |
| `mistralai/mistral-small-3.2-24b-instruct` | 5/6 | 3/10 | 8/16 | 17s | $0.001 |
| `meta-llama/llama-4-scout` | 4/6 | 3.7/10 | 7.7/16 | 8s | $0.002 |
| `mistralai/ministral-8b-2512` | 5/6 | 2/10 | 7/16 | 10s | $0.002 |
| `mistralai/codestral-2508` | 5/6 | 1/10 | 6/16 | 6s | $0.004 |
| `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B` | 2/6 | 2/10 | 4/16 | 37s | Free |
| `nemotron-3-nano:4b` (Ollama) | 2/6 | 2/10 | 4/16 | 37s | Free |
| `anthropic/claude-haiku-4.5` | 1/6 | 1/10 | 2/16 | 8s | $0.013 |
| `nvidia/Nemotron-3-Nano-30B-A3B` | 1/6 | 1/10 | 2/16 | 33s | Free |
| `gpt-oss:latest` (Ollama) | 1/6 | 1/10 | 2/16 | 21s | Free |
| `google/gemma-3-27b-it` | 0/6 | 0/10 | 0/16 | — | $0.001 |

### The Failures Tell the Real Story

**`anthropic/claude-haiku-4.5` via OpenRouter (2/16)** — The most expensive failure. It called `list_vehicles` twice, got an error, and returned an apology:

> *"I apologize—I'm encountering persistent server errors when trying to connect to your TezLab account."*

The service was running fine for every other model. On every other dimension Haiku was strong: 30/30 knowledge, 30/30 instruction, 126/126 coding. One catastrophic failure in one dimension defines the whole ranking.

**`nvidia/Nemotron-3-Nano-30B-A3B` on DeepInfra (2/16)** — Called `list_vehicles` once, correctly identified both vehicles, and then asked the user for clarification instead of proceeding. The same weights on OpenRouter scored 11/16 by just picking the Tesla and running all 6 tools. Same model, different provider, one asks permission and the other gets to work.

**`google/gemma-3-27b-it` via OpenRouter (0/16)** — OpenRouter returned "No endpoints found that support tool use." This model doesn't support tool calling at all.

### The Quality Gap

Among models that called all 6 tools (tool score 6/6), quality scores ranged from 3.7/10 to 5/10. The majority scored 5/10 — quality variance is far smaller than tool-usage variance. Models either figured out the full tool chain or stopped short. This suggests MCP tool use is primarily a **planning problem**, not a generation problem.

---

## The Provider Effect: Why Infrastructure Matters

The same model weights, served by different providers, produce meaningfully different results.

### The Numbers

| Model | Dimension | OpenRouter | DeepInfra | Gap |
| --- | --- | ---: | ---: | ---: |
| Nemotron Nano 30B | Reasoning | 20/20 | 17/20 | -3 |
| Nemotron Nano 30B | Knowledge | 30/30 | 30/30 | 0 |
| Nemotron Nano 30B | Instruction | 28/30 | 30/30 | +2 |
| Nemotron Nano 30B | Coding | 71/126 | 110/126 | +39 |
| Nemotron Nano 30B | MCP Tool Use | 11/16 | 2/16 | -9 |
| Nemotron Nano 30B | **Combined** | **83.7%** | **77.0%** | **-6.7pp** |
| | | | | |
| Nemotron Super 120B | Reasoning | 20/20 | 20/20 | 0 |
| Nemotron Super 120B | Knowledge | 30/30 | 28/30 | -2 |
| Nemotron Super 120B | Instruction | 25/30 | 30/30 | +5 |
| Nemotron Super 120B | Coding | 74/126 | 88/126 | +14 |
| Nemotron Super 120B | MCP Tool Use | 11/16 | 4/16 | -7 |
| Nemotron Super 120B | **Combined** | **82.2%** | **77.6%** | **-4.6pp** |

The Nano 30B gap is **6.7 percentage points** — larger than the gap between ranks #4 and #10 in our leaderboard. The pattern is inverted between dimensions: DeepInfra dominates coding (110/126 vs 71/126) while OpenRouter dominates MCP (11/16 vs 2/16) and reasoning (20/20 vs 17/20). The Super 120B gap widened to 4.6pp with updated MCP data — OpenRouter now scores 11/16 vs DeepInfra's 4/16.

### Why the Same Weights Behave Differently

At least seven layers can introduce behavioral differences: quantization precision, SDK layers (native vs OpenAI-compatible adapter), middleware (context compression, response healing), tool-calling implementation, default parameters, token usage reporting, and reasoning effort configuration.

**Tool use is the most provider-sensitive capability.** Knowledge and reasoning showed 0-3 point differences; MCP showed a 9-point difference. If your application relies on tool calling, provider choice matters more than model choice.

---

## Cost and Speed Analysis

### The Cost Efficiency Curve (4 Dimensions, All 49 Models)

| Tier | Cost Range | Best Model | 4-dim Score |
| --- | --- | --- | ---: |
| Free (local) | $0.00 | `gpt-oss:latest` (Ollama) | 93.3% |
| Free (cloud) | $0.00 | `nvidia/Nemotron-3-Nano-30B-A3B` (DeepInfra) | 93.1% |
| Sub-penny | $0.001-$0.01 | `openai/gpt-oss-120b` (OR) | 98.3% |
| Penny | $0.01-$0.05 | `gemini-3-flash-preview` (Google) | 98.8% |
| Dime | $0.05-$0.20 | `x-ai/grok-4.20-beta` (OR) | 98.8% |
| Quarter+ | $0.20+ | `anthropic/claude-sonnet-4.6` (OR) | 100.0% |

The knee is at **`openai/gpt-oss-120b` ($0.01, 98.3%)**. For one cent you get a model that's within 2 points of the absolute best. The jump from 98.3% to 100% costs 20x more ($0.20 for Sonnet 4.6). Below that, local `gpt-oss:latest` on Ollama delivers 93.3% for free.

### The Speed/Quality Frontier

| Model | Score | Time | Sweet Spot? |
| --- | ---: | ---: | --- |
| `mistralai/codestral-2508` | 87.3% | 48s | Fastest overall |
| `openai/gpt-5.4-mini` | 97.3% | 1m | Fastest >95% |
| `anthropic/claude-sonnet-4.6` | 100.0% | 3m | Perfect score |
| `x-ai/grok-4.20-beta` | 98.8% | 2m | Best speed/quality |
| `gemini-3-flash-preview` | 98.8% | 1h41m | Best value |
| `openai/gpt-oss-120b` | 98.3% | 10m | Best sub-penny |

---

## What This Tells Us

**1. Claude Sonnet 4.6 is the only perfect model.** 100% across 4 dimensions — 20/20 reasoning, 30/30 knowledge, 30/30 instruction, 126/126 coding. No other model achieves this. But at $0.20, you pay a premium for perfection.

**2. The top 5 models are within 1.2 points of each other.** Sonnet 4.6 (100%), Qwen 397B (99.2%), Grok 4.20 (98.8%), Gemini Flash (98.8%), GPT-5.4 (98.8%). The difference between them is essentially noise — model choice at the frontier matters less than it used to.

**3. `openai/gpt-oss-120b` at $0.01 is the deal of the century.** 98.3% — ahead of GPT-5.4 Mini, Gemini Pro, and Claude Opus — for one cent. Apache-licensed. This is an open-weight model costing 20x less than Sonnet and scoring within 2 points.

**4. Local models are no longer a compromise.** `gpt-oss:latest` on Ollama (93.3%) and `nemotron-3-nano:latest` (89.4%) run entirely on a MacBook, for free, and beat many cloud models. The 5-7% gap vs cloud is primarily in coding (Go struggles) and instruction following.

**5. Multi-dimensional evaluation reveals things single-axis benchmarks hide.** `anthropic/claude-haiku-4.5` scores 96.3% on 4 dimensions but drops to 79.5% on 5 dimensions due to its MCP collapse. `qwen3:30b-a3b` gets perfect coding (126/126) but 4/30 instruction following.

**6. Provider choice matters as much as model choice.** The 6.7pp gap between the same Nemotron Nano 30B on OpenRouter vs DeepInfra is larger than the gap between many adjacent-ranked models.

**7. Tool orchestration is a binary skill.** Models either call all the right tools and produce excellent analysis, or they stall early and produce nothing. No graceful degradation.

**8. Go code generation is the biggest language gap.** TypeScript compiles 98% of the time; Go only 86%.

**9. The frontier is crowded.** 11 models score above 95% on 4 dimensions. At this level, the differentiators are cost, speed, and tool use — not raw capability.

---

## Methodology

All evaluations ran with temperature 0.0 (knowledge, instruction) or 0.2-0.3 (reasoning, coding). Reasoning and knowledge responses were judged by `anthropic/claude-haiku-4.5` (via OpenRouter). Instruction following and coding used deterministic verification — no LLM judge involved. MCP tool usage is scored mechanically (did you call the tool?); response quality is LLM-judged.

Results are cached per model per task; interrupted runs can be resumed. All models were tested under the same conditions with identical prompts.

Combined scores are the mean of normalized dimension percentages (each dimension's raw score divided by its maximum, then averaged across all 5 dimensions). Only models present in all 5 dimensions appear in the combined leaderboard.

### Run Details

- **Reasoning**: Run #7, 4 puzzles, scored /20
- **Knowledge**: Run #2, 30 questions across 6 categories, scored /30
- **Instruction**: Run #2, 6 constraint tasks, scored /30
- **Coding**: Run #6, 6 challenges × 3 languages = 18 tasks, scored /126 (local execution, no containers)
- **MCP Tool Use**: Run #1, 1 multi-tool task, scored /16

Total evaluation cost: **$4.63** across all 49 models and 4-5 dimensions.

### Limitations

- Only 22 of 49 tested models have complete 5-dimension results. Premium models (Claude Opus/Sonnet 4.6, GPT-5.4, Gemini 3.1 Pro, Grok 4.20), mid-tier (GPT-5.4 Mini/Nano, Kimi K2.5, Grok 4.1 Fast), and all 13 Ollama models are missing MCP results due to TezLab server unavailability.
- The MCP eval used a single task with a live API. Results may vary with different MCP servers, tool schemas, or task descriptions.
- Free-tier models may have different availability, rate limits, or routing than paid versions.
- We tested each model once per task. Stochastic variation means scores could shift by 1-3 points on a re-run.

---

*Built with [umwelten](https://github.com/The-Focus-AI/umwelten) — an open-source framework for multi-model evaluation, MCP tool integration, and LLM-judged scoring.*
