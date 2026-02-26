# The Car Wash Test: Do LLMs Have Common Sense?

*Research Report / February 2026*

A simple question exposes a fundamental gap in AI reasoning. We tested 131 models across 8 providers — including 11 local Ollama models — to see which ones understand that you need to bring your car to the car wash, not just yourself.

- 131 models evaluated
- 8 providers
- Run #007 · 50m distance

## The Prompt

> "I want to wash my car. The car wash is 50 meters away. Should I walk or drive?"

Correct answer: **DRIVE** — the car must be physically present at the car wash to be washed. Walking there leaves your car at home, defeating the purpose entirely.

## Results at a Glance

| Metric | Count |
|--------|-------|
| Models Tested | 131 |
| Truly Correct | 31 (23.7%) |
| Lucky (Wrong Reason) | 6 |
| Failed (Walk) | 90 |
| Both / Unclear / Error | 4 |

## Comparison with Original Research

The car wash test was originally devised by [Opper.ai](https://opper.ai/blog/car-wash-test), who tested 53 models at 50 meters. We replicated their study at the same distance with 131 models, added an LLM judge for reasoning quality, included the latest 2026 models, and added 11 local Ollama models to compare cloud vs local inference.

### Opper.ai (Original): 11 / 53

- Distance: **50 meters**
- Single-run pass rate: **20.8%**
- 10-run consistent: **5 models only**
- GPT-5 scored 7/10 across runs
- Human baseline: **71.5% correct**
- 33 models never correct in any run

### Our Replication (Extended): 31 / 131

- Distance: **50 meters** (same)
- Single-run pass rate: **23.7%**
- Lucky (drive, wrong reason): **6 models**
- Reasoning judge: claude-haiku-4.5
- 14 thinking/reasoning models tested
- 11 local Ollama models: **1 passed**

At the same 50m distance, our expanded test shows a 23.7% pass rate vs Opper's 20.8%. The improvement comes from newer 2026 models (Qwen 3.5, GPT-5+, Grok 4+) that weren't available in the original study. The 50m distance remains brutally effective at tripping up models — they latch onto "50 meters is so close, just walk!" without considering that the car is the cargo.

### Consistent Findings Across Both Studies

**Heuristic Dominance.** Models default to "short distance = walk" without considering what needs to travel. The environmental/health framing overrides physical necessity.

**Newer Models Do Better.** Models released in late 2025–2026 pass at much higher rates. The Qwen 3.5 family achieves 100% (5/5). GPT-5 family mostly succeeds.

**Local Models: Near-Zero Pass Rate.** Of 11 Ollama models, only minimax-m2.1:cloud passed. Local inference models lack the reasoning quality of cloud frontier models on this task.

## Key Findings

### 1. The 50m Trap

At 50 meters, the distance becomes a powerful distractor. Models fixate on "50 meters is so close!" and immediately conclude walking is better — for health, environment, convenience. Only 24% of models see through this to the core issue: the car must physically be at the car wash. Even models that passed Opper's test at this distance in other runs may fail on any given attempt due to LLM non-determinism.

### 2. The Qwen 3.5 Breakthrough

The Qwen 3.5 family is the standout performer: all five models (plus, 397b, 122b, 35b, 27b) pass with perfect reasoning. Their responses immediately identify that "the vehicle must be physically present at the car wash." This is notable because the older Qwen 3 models (qwen3-max, qwen3-coder, qwen3-max-thinking) all fail. Something changed in the 3.5 generation.

### 3. Local Models: Near-Complete Failure

Of 11 local Ollama models, only minimax-m2.1:cloud passed with correct reasoning. The other 10 — including deepseek-r1 (three sizes), qwen3 (two sizes), phi4, gemma3n, mistral-small, devstral, and gpt-oss — all failed. deepseek-r1:14b said "drive" but for wrong reasons (convenience, not physical necessity). This suggests quantization and missing RLHF significantly impact common-sense reasoning.

### 4. Anthropic's Split

Only Claude Opus 4.5, Opus 4.6, and Claude 3.7 Sonnet:thinking pass. Every other Claude model fails — including Sonnet 4.6, Opus 4, Opus 4.1, Sonnet 4, Sonnet 4.5, and Claude 3.5 models. Notably, Sonnet 4.6 passed in Run #006 but failed in this run — demonstrating the non-determinism that makes single-run benchmarks unreliable. The 3.7 Sonnet thinking variant succeeded this time by reasoning through the physical constraint explicitly.

### 5. Cost Is Not a Predictor

Claude Opus 4 ($0.009/query) and Claude Opus 4.1 ($0.009) both fail, while Gemini 3 Flash ($0.000044) and Grok 4.1 Fast ($0.000241) pass — at 30–300x less cost. The most expensive correct model is GPT-5-pro at $0.15/query. The cheapest is Gemini 3 Flash at $0.000044. Common sense is orthogonal to model cost.

### 6. Reasoning Models: Mixed Results

Of 14 dedicated thinking/reasoning models, 7 passed (50%): o3, o3-pro, o1, o3-mini, claude-3.7-sonnet:thinking, qwen3-30b-thinking, qwen3-next-80b-thinking, and qwen3-vl-235b-thinking. But 7 others failed — including o3-mini-high, o4-mini, o4-mini-high, qwen3-235b-thinking, and sonar-reasoning-pro. Extended reasoning helps some models work through the physical constraint, but can also reinforce the "short distance = walk" heuristic.

## Full Results

### Truly Correct (31 models)

These models recommended driving **and** correctly identified that the car must physically be at the car wash.

| Model | Provider | Quality | Time | Cost |
|-------|----------|---------|------|------|
| claude-3.7-sonnet:thinking | Anthropic | 5 | 6.9s | $0.004815 |
| claude-opus-4.5 | Anthropic | 5 | 4.2s | $0.002175 |
| claude-opus-4.6 | Anthropic | 5 | 3.4s | $0.002730 |
| gemini-2.5-pro | Google | 5 | 14.2s | $0.000635 |
| gemini-3-flash-preview | Google | 5 | 5.1s | $0.000044 |
| gemini-3-pro-preview | Google | 5 | 7.4s | $0.000041 |
| glm-4.7 | Zhipu | 5 | 79.7s | $0.003876 |
| glm-5 | Zhipu | 5 | 7.9s | $0.000957 |
| gpt-5 | OpenAI | 5 | 19.9s | $0.008243 |
| gpt-5-mini | OpenAI | 5 | 17.4s | $0.001905 |
| gpt-5-nano | OpenAI | 5 | 21.4s | $0.000853 |
| gpt-5-pro | OpenAI | 4 | 91.6s | $0.152910 |
| grok-3-mini | xAI | 4 | 18.8s | $0.000577 |
| grok-4 | xAI | 5 | 11.5s | $0.009594 |
| grok-4-fast | xAI | 5 | 4.0s | $0.000260 |
| grok-4.1-fast | xAI | 5 | 5.1s | $0.000241 |
| kimi-k2.5 | Moonshot | 5 | 48.7s | $0.003980 |
| minimax-m2.1 | MiniMax | 5 | 6.8s | $0.000374 |
| minimax-m2.1:cloud | Ollama | 5 | 3.3s | free |
| o1 | OpenAI | 5 | 11.9s | $0.125730 |
| o3 | OpenAI | 5 | 9.8s | $0.005556 |
| o3-mini | OpenAI | 5 | 16.5s | $0.015129 |
| o3-pro | OpenAI | 5 | 35.0s | $0.060920 |
| qwen3-30b-a3b-thinking-2507 | Qwen | 5 | 18.0s | $0.000471 |
| qwen3-next-80b-a3b-thinking | Qwen | 5 | 32.7s | $0.005949 |
| qwen3-vl-235b-a22b-thinking | Qwen | 5 | 144.2s | free |
| qwen3.5-122b-a10b | Qwen | 5 | 6.3s | $0.003048 |
| qwen3.5-27b | Qwen | 5 | 9.3s | $0.001763 |
| qwen3.5-35b-a3b | Qwen | 5 | 64.0s | $0.027915 |
| qwen3.5-397b-a17b | Qwen | 5 | 12.1s | $0.003734 |
| qwen3.5-plus-02-15 | Qwen | 5 | 63.2s | $0.010910 |

### Lucky (6 models)

These models recommended driving but for the **wrong reasons** — convenience, speed, or environmental calculations rather than recognizing the car must be present.

| Model | Provider | Quality | Stated Reason |
|-------|----------|---------|---------------|
| deepseek-r1:14b | Ollama | 2 | Walking would be impractical for such a short distance |
| ernie-4.5-21b-a3b-thinking | Baidu | 2 | Driving is faster and more efficient |
| mercury | Inception | 2 | Convenience, speed, bringing car inside |
| phi-4 | Microsoft | 1 | Time and convenience factors |
| sonar | Perplexity | 1 | Environmental impact negligible, driving is faster |
| sonar-pro | Perplexity | 2 | Environmental calculations favor driving |

### Failed — Walk (90 models)

Every model below recommended walking, failing to realize the car must be at the car wash. Sorted by provider.

| Model | Provider | Stated Reason |
|-------|----------|---------------|
| olmo-3.1-32b-instruct | AllenAI | Walking is faster, healthier, more environmentally friendly |
| olmo-3.1-32b-think | AllenAI | Walking is faster and more efficient than driving 50m |
| nova-lite-v1 | Amazon | Walking is healthy, eco-friendly; 50m is short |
| nova-micro-v1 | Amazon | Environmental friendliness, fuel savings, exercise |
| nova-premier-v1 | Amazon | 50m is short; walking saves fuel and reduces car usage |
| nova-pro-v1 | Amazon | Short distance, saves time, environmentally friendly |
| claude-3.5-haiku | Anthropic | Short distance, saves fuel, exercise |
| claude-3.5-sonnet | Anthropic | 50m is short, wastes fuel, walking is better for environment |
| claude-3.7-sonnet | Anthropic | Short distance, convenience, fuel savings |
| claude-haiku-4.5 | Anthropic | 50m is short; walking is faster and cheaper |
| claude-opus-4 | Anthropic | 50m is a short walk; driving wastes gas |
| claude-opus-4.1 | Anthropic | 50m is a short walk; driving is wasteful |
| claude-sonnet-4 | Anthropic | 50m is very short; saves time by avoiding engine start |
| claude-sonnet-4.5 | Anthropic | 50m is too short to justify driving |
| claude-sonnet-4.6 | Anthropic | 50m is short; driving defeats the purpose |
| ernie-4.5-21b-a3b | Baidu | Walking is healthier and more environmentally friendly |
| ernie-4.5-300b-a47b | Baidu | 50m is short; walking is faster, saves fuel |
| seed-1.6-flash | ByteDance | 50m is short; walking is quicker |
| seed-1.6 | ByteDance | 50m too short to drive; saves gas |
| command-a | Cohere | Proximity, efficiency, environmental impact |
| deepseek-chat-v3-0324 | DeepSeek | 50m is short; driving is inefficient |
| deepseek-chat-v3.1 | DeepSeek | 50m is short; walking is more convenient |
| deepseek-r1 | DeepSeek | Time efficiency and convenience |
| deepseek-r1-0528 | DeepSeek | 50m is too short to drive |
| deepseek-v3.1-terminus | DeepSeek | Walking is quicker and more convenient |
| deepseek-v3.2 | DeepSeek | Driving 50m is inefficient |
| gemini-2.0-flash | Google | Walking is faster for short distances |
| gemini-2.0-flash-lite | Google | Walking is more convenient |
| gemini-2.5-flash | Google | 50m is short, walking is more efficient |
| gemini-2.5-flash-lite | Google | 50m is short; walking is eco-friendly |
| gemma-3-27b-it | Google | 50m is short; walking is quicker |
| gemma-3n-e4b-it | Google | Walking is faster and more convenient |
| inflection-3-productivity | Inflection | Walking is quicker for 50m |
| lfm-2.5-1.2b-thinking:free | Liquid | 50m is short enough that walking is efficient |
| llama-3.3-70b-instruct | Meta | Walking is quicker for 50m |
| llama-4-maverick | Meta | Short distance, environmentally friendly |
| llama-4-scout | Meta | Short distance, walking is quicker |
| minimax-m2.5 | MiniMax | Walking is faster for 50m |
| devstral-medium | Mistral | Short distance, saves time and fuel |
| devstral-small | Mistral | Walking is more fuel-efficient |
| mistral-large-2411 | Mistral | 50m is short; walking is quicker |
| mistral-large-2512 | Mistral | Short distance makes driving unnecessary |
| mistral-medium-3 | Mistral | Short distance, environmental impact |
| mistral-medium-3.1 | Mistral | Distance is short, walking is efficient |
| mistral-small-3.1-24b-instruct | Mistral | Distance is short, walking is convenient |
| mistral-small-3.2-24b-instruct | Mistral | Short distance, environmental friendliness |
| kimi-k2-0905 | Moonshot | 50m is short; driving wastes time and fuel |
| llama-3.3-nemotron-super-49b-v1.5 | NVIDIA | 50m is short; walking is more efficient |
| nemotron-3-nano-30b-a3b | NVIDIA | Distance is short; no parking hassle |
| gpt-4.1 | OpenAI | Short distance, saves fuel |
| gpt-4.1-mini | OpenAI | Walking is more practical |
| gpt-4.1-nano | OpenAI | Walking is quicker and more convenient |
| gpt-4o | OpenAI | Walking is more convenient |
| gpt-4o-mini | OpenAI | Walking is more environmentally friendly |
| gpt-5.1 | OpenAI | 50m is too close to drive |
| gpt-5.2 | OpenAI | Driving is slower, uses fuel |
| gpt-5.3-codex | OpenAI | 50m is too short |
| gpt-oss-120b | OpenAI | Environmental and health benefits |
| gpt-oss-20b | OpenAI | 50m is a short walk |
| o3-mini-high | OpenAI | Walking saves fuel, reduces emissions |
| o4-mini | OpenAI | Walking is faster |
| o4-mini-high | OpenAI | Walking is faster, cheaper |
| sonar-reasoning-pro | Perplexity | Environmental impact, efficiency |
| qwen-2.5-72b-instruct | Qwen | Walking is quick, eco-friendly |
| qwen-plus-2025-07-28:thinking | Qwen | Distance is short, walking is faster |
| qwen3-235b-a22b | Qwen | 50m is short, walking is unnecessary |
| qwen3-235b-a22b-thinking-2507 | Qwen | 50m is too short to drive |
| qwen3-coder | Qwen | Walking saves fuel, is better for environment |
| qwen3-coder-next | Qwen | 50m is short; walking is faster |
| qwen3-max | Qwen | Walking is faster, avoids hassle |
| qwen3-max-thinking | Qwen | Short distance, saves fuel |
| qwen3-vl-30b-a3b-thinking | Qwen | 50m is too short to drive |
| qwen3-vl-8b-thinking | Qwen | Walking is more time-efficient |
| qwq-32b | Qwen | 50m is short; walking is faster |
| step-3.5-flash | StepFun | 50m is short; driving wastes fuel |
| palmyra-x5 | Writer | 50m is too short to drive |
| grok-3 | xAI | Short distance, convenience |
| grok-3-beta | xAI | Short distance, convenience |
| glm-4.5 | Zhipu | Driving would make car dirty again |
| glm-4.6 | Zhipu | 50m is too short; driving causes wear |
| glm-4.7-flash | Zhipu | 50m is negligible; driving wastes fuel |
| deepseek-r1:32b | Ollama | Walking is quick, eco-friendly |
| deepseek-r1:latest | Ollama | Walking is more energy-efficient |
| devstral:latest | Ollama | Distance is short, walking is faster |
| gemma3n:e4b | Ollama | Walking is faster and more convenient |
| gpt-oss:latest | Ollama | Time savings, cost savings |
| mistral-small:latest | Ollama | Distance is short, walking is convenient |
| phi4:latest | Ollama | Environmental impact, exercise |
| qwen3:30b-a3b | Ollama | 50m too short to drive |
| qwen3:32b | Ollama | 50m is very short; walking is faster |

### Errors (4 models)

| Model | Provider | Issue |
|-------|----------|-------|
| gpt-5.2-pro | OpenAI | Insufficient credits |
| kimi-k2-thinking | Moonshot | Empty response |
| maestro-reasoning | Arcee | Provider returned error |
| o1-pro | OpenAI | Insufficient credits |

## Pass Rates by Model Family

| Family | Correct | Lucky | Failed | Other | Total | Pass Rate |
|--------|---------|-------|--------|-------|-------|-----------|
| Qwen 3.5 | 5 | 0 | 0 | 0 | 5 | 100% |
| xAI Grok | 4 | 0 | 2 | 0 | 6 | 67% |
| Zhipu GLM | 2 | 0 | 3 | 0 | 5 | 40% |
| OpenAI GPT-5 | 4 | 0 | 3 | 1 | 8 | 50% |
| OpenAI o-series | 4 | 0 | 3 | 1 | 8 | 50% |
| Google Gemini | 3 | 0 | 5 | 0 | 8 | 38% |
| MiniMax | 2 | 0 | 1 | 0 | 3 | 67% |
| Anthropic Claude | 3 | 0 | 9 | 0 | 12 | 25% |
| Qwen 3 | 3 | 0 | 10 | 0 | 13 | 23% |
| Moonshot Kimi | 1 | 0 | 1 | 1 | 3 | 33% |
| OpenAI GPT-4 | 0 | 0 | 5 | 0 | 5 | 0% |
| DeepSeek | 0 | 0 | 6 | 0 | 6 | 0% |
| Meta Llama | 0 | 0 | 3 | 0 | 3 | 0% |
| Mistral | 0 | 0 | 8 | 0 | 8 | 0% |
| Amazon Nova | 0 | 0 | 4 | 0 | 4 | 0% |
| Baidu ERNIE | 0 | 1 | 2 | 0 | 3 | 0% |

## Methodology

Models were evaluated using the [umwelten](https://github.com/thefocus-ai/umwelten) evaluation framework. Each model received an identical prompt with a system message describing a "helpful assistant" role (temperature 0.3, max 500 tokens). Responses were cached per-run to ensure reproducibility.

Judging was performed by **anthropic/claude-haiku-4.5** via OpenRouter, scoring each response on: recommendation (drive/walk/both/unclear), whether the model recognizes the car must be present, whether the correct reason was given, a 1–5 reasoning quality score, and a free-text explanation.

A model is classified as **truly correct** only if it recommends driving *and* identifies that the car must physically be at the car wash. Models that recommend driving for other reasons (convenience, speed) are classified as **lucky**.

**Local models** were run via Ollama on an Apple Silicon Mac (M-series). Cloud models were accessed via Google AI API (direct) and OpenRouter. The distance was set to **50 meters** to match the original Opper.ai study exactly.

**Note on variance:** LLM responses are non-deterministic even at low temperature. The original Opper.ai study showed significant run-to-run variance (GPT-5 scored 7/10 across 10 runs). Our results represent a single run and should be interpreted as a snapshot, not a definitive classification.

---

Based on the [Car Wash Test by Opper.ai](https://opper.ai/blog/car-wash-test). Extended evaluation by [The Focus AI](https://thefocus.ai) using the umwelten framework. Report generated February 2026. Total evaluation cost: $0.46.
