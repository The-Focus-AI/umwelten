# Umwelten Examples (on Pi & Pi Durable)

Every example in `examples/` focuses strictly on what Umwelten adds on top of `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, the official MCP SDK (`@modelcontextprotocol/client` / `server` 2.x), and `@earendil-works/pi-durable`.

## Instant Offline Mock vs. `--live` Device Runs

By default, every evaluation example runs in **deterministic mock mode** (`examples/_shared/mock-runtime.ts`, powered by `@earendil-works/pi-ai`'s `fauxProvider` and isolated under `output/mock-evaluations/`) so you can verify the full `EvalSuite`, `VerifyTask`, `JudgeTask`, Node subprocess code runner, `PairwiseRanker` Elo, and `Jev` calibration pipelines in under two seconds with zero API keys.

When you are ready to run against real cloud APIs and local GPUs (`llama-swap` / `ollama`) on your machine, pass `--live` (which uses the clean `output/evaluations/` cache directory):

```bash
# 1. Run any standalone recipe immediately (mock mode via fauxProvider)
pnpm tsx examples/evals/car-wash.ts
pnpm tsx examples/evals/reasoning.ts
pnpm tsx examples/evals/instruction.ts
pnpm tsx examples/evals/tool-math.ts
pnpm tsx examples/jev/run.ts --mock
pnpm tsx examples/pi-extension/demo.ts
pnpm tsx examples/durable-habitat/host.ts
pnpm tsx examples/mycel-e2e/run.ts

# 2. Run the full 20-model Fast Roster (Gemini 3.x/4 + Haiku/Sonnet 5.5 + GPT-6 + Cerebras/Groq + Local)
pnpm run site:bench                  # mock wiring run -> reports/data/model-watch-mock.json
pnpm tsx examples/model-showdown/generate-report.ts

# 3. Later on your workstation with API keys + local llama-swap running:
pnpm run site:bench --live           # real cloud + local run -> reports/data/model-watch-live.json
pnpm run site:build                  # rebuild build/site/
```

## Clean Fast Models Roster (`examples/_shared/fast-models.ts`)

All cloud slugs resolve directly against `@earendil-works/pi-ai` `builtinModels()`:

- **Google Gemini (3.x+ & 4.x)**: `google:gemini-4-hydrogen`, `google:gemini-3.8-flash`, `google:gemini-3.5-flash-lite`, `google:gemini-3.1-flash-lite`, `google:gemini-3-flash-preview`
- **Frontier Fast**: `anthropic:claude-haiku-5-5`, `anthropic:claude-sonnet-5-5`, `openai:gpt-6-luna`, `openai:gpt-6.1-terra`, `xai:grok-4.3`
- **Wafer / LPU & Open Flash**: `cerebras:gpt-oss-120b`, `groq:openai/gpt-oss-20b`, `openrouter:deepseek/deepseek-v4.1-flash`, `openrouter:z-ai/glm-5.3-flash`, `openrouter:qwen/qwen3.8-flash`, `openrouter:minimax/minimax-m3.1-flash`
- **Local (`llama-swap` continuous batching)**: `llamaswap:gemma-4-26b`, `llamaswap:gpt-oss-20b`, `llamaswap:nemotron-3-nano-4b`, `llamaswap:gemma-4-e2b`
