# Local-Providers Showdown

Four local LLM runtimes, same hardware, same weights — which one should you
actually use?

This example benchmarks **Ollama**, **LM Studio**, **LlamaBarn**, and
**llama-swap** across six dimensions (speed, instruction following, reasoning,
coding — write + fix, tool calling, file-tools/artifact-building), with an
optional **frontier reference** (Gemini 3 Flash + Claude Opus 4.7) to answer:

1. **When can I use local instead of frontier?** (quality gap)
2. **Which runtime is fastest for the same weights?** (speed)
3. **Which local model is smartest overall?** (leaderboard)

Inspired by [Migrating to llama.cpp](https://willschenk.com/howto/2026/migrating_to_llama_cpp/).

## What each runtime is

| Runtime | Backend | Orchestration | Good at |
|---|---|---|---|
| **Ollama** | Ollama's llama.cpp fork | Single daemon, auto-unload | Ergonomics, model registry |
| **LM Studio** | Upstream llama.cpp | GUI loader + headless server | GUI tuning, per-model config |
| **LlamaBarn** | Upstream llama.cpp | Mac-native auto-swap | "Ollama UX with real llama.cpp" |
| **llama-swap** | Upstream llama.cpp | YAML-configured proxy, TTL-unload | Headless, programmable, fastest |

Ollama lags upstream llama.cpp (community benchmarks show 1.5-1.8× slower on
identical hardware). The other three all run upstream llama.cpp; they differ
in orchestration, not inference.

## Install runtimes

**Ollama** — <https://ollama.com/download>

```bash
brew install ollama
ollama serve  # in one terminal
ollama pull gemma4:26b
```

**LM Studio** — <https://lmstudio.ai/download>

Download the Mac app, install models through the GUI, then enable the local
server (⚙️ → Developer → Start Server, default `http://localhost:1234`).

**LlamaBarn** — <https://llamabarn.com/>

Mac app. Install, add models through the GUI. API at `http://localhost:2276/v1`.

**llama-swap + llama.cpp** — <https://github.com/mostlygeek/llama-swap>

```bash
brew install llama.cpp
go install github.com/mostlygeek/llama-swap@latest

# Generate a starter config from your LM Studio / LlamaBarn model cache:
pnpm tsx examples/local-providers/catalog.ts --yaml > examples/local-providers/llama-swap.yaml

# Start the proxy (runs llama-server on demand, unloads on idle)
llama-swap --config examples/local-providers/llama-swap.yaml --listen :8080
```

## Seed a shared model

For apples-to-apples comparison we need the **same weights** loadable on every
runtime. The blog post lands on Gemma 4 26B-A4B Q4_K_M (~17 GB). To install
across all four:

```bash
# Ollama
ollama pull gemma4:26b

# llama.cpp (direct) — also used by llama-swap
llama-cli -hf unsloth/gemma-4-26B-A4B-it-GGUF:Q4_K_M -cnv
# (Ctrl-C after first token; the file is now in ~/.cache/llama.cpp/)

# LM Studio: GUI → Search → unsloth/gemma-4-26B-A4B-it-GGUF → Download
# LlamaBarn: GUI → Browse → same model
```

Then run:

```bash
pnpm tsx examples/local-providers/catalog.ts
```

…to confirm all four runtimes can see the model.

## Run the suite

Each sub-suite writes to `output/evaluations/local-providers-<dim>/runs/NNN/`.
Tasks are cached; re-running is cheap.

```bash
# Speed (TTFT, tok/s, cold-start)
dotenvx run -- pnpm tsx examples/local-providers/speed.ts
dotenvx run -- pnpm tsx examples/local-providers/speed.ts --prompt long

# Quality
dotenvx run -- pnpm tsx examples/local-providers/quality/instruction.ts
dotenvx run -- pnpm tsx examples/local-providers/quality/reasoning.ts
dotenvx run -- pnpm tsx examples/local-providers/quality/coding.ts
dotenvx run -- pnpm tsx examples/local-providers/quality/coding-bugfix.ts

# Tools
dotenvx run -- pnpm tsx examples/local-providers/quality/tool-math.ts
dotenvx run -- pnpm tsx examples/local-providers/quality/soul-md.ts

# Add --frontier to any of the above to include Gemini 3 Flash + Opus 4.7.
# Add --new to force a fresh run (default is resume/cache).
```

## Combined report

After running all sub-suites:

```bash
# Leaderboard + per-dimension tables in markdown
dotenvx run -- pnpm run cli eval combine \
  --config examples/local-providers/suite-config.ts \
  --format md --output output/local-providers-report.md

# Full narrative writeup
dotenvx run -- pnpm run cli eval combine \
  --config examples/local-providers/suite-config.ts \
  --format narrative --output output/local-providers-narrative.md
```

## Editing the matrix

`shared/models.ts` is the source of truth for (runtime, model) pairs.
Edit `LOCAL_MATRIX` to match what you have installed. The `family` field
groups "same weights on different runtime" so the combined report can show
head-to-head comparisons.

## What each dimension tests

| Dimension | Type | Scoring | Tests |
|---|---|---|---|
| **speed** | streaming latency | TTFT ms + tok/s | Short + long prompt, cold + warm |
| **instruction** | deterministic | `/30` | Exact word count, JSON shape, alphabetized list, negative constraints, format transformation, multi-format |
| **reasoning** | LLM judge | `/20` | Surgeon riddle, bat & ball, lily pad, counterfeit coin |
| **coding — write** | compile + run + check stdout | `/126` | 6 problems × 3 languages (TS, Python, Go) |
| **coding — fix** | hidden test harness | `/25` | 5 buggy JS functions, run hidden tests against the fix |
| **tool math** | deterministic + tool-call count | `/25` | 5 multi-step arithmetic problems using calculator + statistics tools |
| **soul.md** | LLM judge over final artifact | `/10` | 8-turn conversation where assistant maintains `soul.md` using read_file / write_file |

## What's next

The `soul-md` test uses the same substrate (sandboxed file tools + workspace)
that an **autoresearch agent** would use — drop the scripted conversation,
give the model a research goal, and let it write its own tools via
`src/stimulus/tools/loader.ts` + `SkillsRegistry`. That's the next step.
