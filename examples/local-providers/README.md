# Local-Providers Showdown

**The thesis under test:** how much does the runtime actually matter when
running a local LLM, vs. everything else around it — chat template,
reasoning mode, quantization, sampling? This example runs the *same
weights* through multiple local runtimes and isolates each variable so we
can say what's doing what.

It benchmarks **Ollama**, **LM Studio**, **LlamaBarn**, and **llama-swap**
across quality suites (instruction, reasoning, coding write + fix, tool
calling, file-tools/artifact-building) with an optional **frontier
reference** (Gemini 3 Flash + Claude Opus 4.7).

Inspired by [Migrating to llama.cpp](https://willschenk.com/howto/2026/migrating_to_llama_cpp/)
and the sharper polemic [Stop Using Ollama](https://sleepingrobots.com/dreams/stop-using-ollama/).

## Claims under test

This benchmark exists specifically to test the claims in those two posts.
We track each claim, what our tests say about it, and what's still
undetermined.

### From "Stop Using Ollama" (sleepingrobots.com)

| # | Claim | Status | What we found |
|---|---|---|---|
| 1 | "llama.cpp runs 1.8× faster than Ollama" (161 vs 89 tok/s) | **refuted as stated** | At matched config (same quant, same chat template), tok/s is within noise. The popular number conflates Q4-vs-Q8 and `--jinja` thinking-mode overhead, both of which favor Ollama's defaults. |
| 2 | CPU perf gap 30-50% | undetermined | We're on Metal/GPU; not our scenario |
| 3 | Qwen-3 Coder 32B: 70% higher throughput on llama.cpp | not tested yet | Not in our matrix |
| 4 | Overhead from Ollama's daemon + GPU offloading | partly refuted | We see Ollama ~14% **faster** than llama.cpp-Q8 on gemma-4-26b (Q4 advantage), and within ~5% when we control for quant |
| 5 | Ollama's fork reintroduced llama.cpp bugs | partly supported | We saw `gpt-oss-20b` fail consistently under LlamaBarn (upstream llama.cpp) with "Compute error"; Ollama's `gpt-oss:latest` worked fine. That's the **opposite** of the claim. But: see claim 7 below. |
| 6 | Broken structured output, vision failures, GGML crashes | not tested | |
| 7 | `gpt-oss-20b` works in upstream llama.cpp but fails in Ollama | **contradicted here** | We observed the reverse: Ollama's `gpt-oss:latest` scored 100% on our suite; LlamaBarn+llamaswap on `gpt-oss-20b-mxfp4` had scattered failures in early runs (later resolved). Likely version-dependent. |
| 8 | Qwen tool calls / garbage responses on Ollama | not tested | No Qwen in matrix yet |
| 9 | DeepSeek-R1 naming misrepresentation | N/A | Documentation claim, not performance |
| 10 | Stripped distinction from DeepSeek's naming | N/A | Documentation claim |
| 11 | Ollama can only create Q4_K_S, Q4_K_M, Q8_0, F16, F32 | **true** (by inspection) | `ollama create` lacks Q5_K_M, Q6_K, IQ quants — but this is a quant-creation claim, not a runtime quality claim |
| 12 | Can't create Q5/Q6/IQ without external tools | **true** | See #11 |
| 13 | Ollama auto-detects chat templates from hardcoded list | **true** (by design) | Ollama uses Go templates; unknown models need a manual modelfile |
| 14 | Falls back to bare template, silently breaking instruction format | not directly tested | Would manifest as score regression on unknown models |
| 15 | Requires translating Jinja to Go template syntax | **true** | Known limitation |
| 16 | Changing a parameter copies the entire 30-60 GB model | unverified | Would need to time `ollama cp` — out of scope |
| 17 | New HF models appear in llama.cpp within hours; Ollama lags | **true** (known) | Ollama's registry requires manual packaging |

### From "Migrating to llama.cpp" (willschenk.com)

| Claim | Status | What we found |
|---|---|---|
| llama.cpp runs 1.5-1.8× faster than Ollama | **collapses with controls** | Same story as sleepingrobots #1 — apparent speedup is quant + thinking-mode confound. |
| Q4_K_M is the sweet spot at ~17 GB for 26B models | plausible | Our scores on Q4 vs Q8 data (in progress) will tell. |
| `llama-swap` gives hot-swapping without daemon lock-in | **supported** | Confirmed — `GET /unload` + per-model YAML TTL works. |

### Our own claims (emergent from the data)

| Claim | Status | Evidence |
|---|---|---|
| Thinking mode dominates wall-clock time on llama.cpp runtimes | **strong evidence** | 20-200× speedups when disabled, with no measurable score regression on short-horizon tasks |
| Thinking mode can **hurt** scores (context truncation) | **some evidence** | LlamaBarn gemma-4-26b: thinking-on 86.1% vs thinking-off 95.0% |
| Thinking mode **helps** some model-runtime pairs | **some evidence** | LlamaBarn glm-4.7: thinking-on 87.6% vs thinking-off 74.1% |
| "Runtime speed difference" is mostly quantization + chat-template | **strong evidence** | Controlling for both brings Ollama / llamaswap / LlamaBarn tok/s within ~14% on gemma-4-26b |
| gpt-oss-20b is the strongest open model in our matrix | **supported** | Tied at 100% / 98.5% / 98.5% across llamabarn / llamaswap / ollama |

## The four dimensions

Every benchmark cell is a combination of these:

| Dimension | Values we test | Why it matters |
|---|---|---|
| **Runtime** | `ollama`, `llamabarn`, `llamaswap`, (`lmstudio`) | Are Ollama's custom fork's optimizations better than upstream llama.cpp? Does orchestration (TTL, swap) matter? |
| **Model family** | gemma-4-26b-a4b, glm-4-7-flash, gpt-oss-20b, nvidia-nemotron-3-nano-4b | Which open model is smartest? Which scales down? |
| **Thinking mode** | `on` (default), `off` | Hidden reasoning tokens can multiply generation time 20-200× with little or no score improvement. When is it worth it? |
| **Quantization** | Q4_K_M, Q8_0 (BF16 planned) | Does 4-bit precision hurt scores enough to justify the 2× memory cost of Q8? Does the answer depend on the model? |

**Not every cell makes sense:**

- Ollama has no `--jinja` equivalent exposed — its modelfiles ship with a
  fixed chat template per model and most don't emit hidden reasoning tokens.
  So Ollama's "thinking on/off" dimension is whatever the modelfile says.
- llama.cpp runtimes (llamabarn, llamaswap) **do** expose thinking via
  `chat_template_kwargs.enable_thinking=false` per-request — see
  [Thinking mode](#thinking-mode) below.
- Quantization is determined by which GGUF file is loaded. Each runtime
  loads a specific file; to compare quants you need the file for each
  quant level on disk.

## What each runtime is

| Runtime | Backend | Orchestration | Strengths |
|---|---|---|---|
| **Ollama** | Ollama's llama.cpp fork | Single daemon, TTL-based auto-unload | Ergonomics, built-in registry (`ollama pull`) |
| **LM Studio** | Upstream llama.cpp | GUI loader + headless server | Per-model config GUI |
| **LlamaBarn** | Upstream llama.cpp | Mac-native auto-swap | "Ollama UX with real llama.cpp" |
| **llama-swap** | Upstream llama.cpp | YAML-configured proxy, per-model TTL | Headless, programmable, scriptable |

The popular belief (from the blog post we were inspired by) is that
**llama.cpp runs 1.5-1.8× faster than Ollama for the same model**. **Our
measurements suggest that's wrong in the way it's usually stated**, because:

1. Ollama ships Q4_K_M quants by default. Upstream llama.cpp's HuggingFace
   auto-downloads (ggml-org repos) ship Q8_0 by default. Q4 is
   mechanically faster per token than Q8 because half as much data per
   weight has to move through the arithmetic unit. **That confounds the
   whole comparison.**
2. Default `--jinja` on llama.cpp activates a model's chat template,
   which for most recent models (Gemma 4, GLM 4.7, GPT-OSS) means
   *thinking mode*. Ollama's modelfiles usually don't. This alone can
   make the llama.cpp path look 20-200× **slower**, not faster.

When you control for both — same quant (e.g. Q4_K_M on both) AND same
thinking mode (either both on or both off) — the tok/s numbers converge.
The runtime itself contributes much less than the popular claim suggests.
Full data in the per-run reports.

## Install runtimes

**Ollama** — <https://ollama.com/download>

```bash
brew install ollama
ollama serve  # in one terminal, or launch the .app
ollama pull gemma4:26b
ollama pull glm-4.7-flash
ollama pull gpt-oss
ollama pull nemotron-3-nano:4b
```

**LM Studio** — <https://lmstudio.ai/download>

Download the Mac app, install models through the GUI, then enable the
local server (⚙️ → Developer → Start Server, default
`http://localhost:1234`).

**LlamaBarn** — <https://llamabarn.com/>

Mac app. Install, add models through the GUI. API at
`http://localhost:2276/v1`. Uses upstream llama.cpp. Preset config lives
at `~/.llamabarn/models.ini`.

**llama-swap + llama.cpp** — <https://github.com/mostlygeek/llama-swap>

```bash
brew install llama.cpp   # or latest release with --jinja support
brew install llama-swap  # or: go install github.com/mostlygeek/llama-swap@latest

# Generate a config from your GGUF cache:
umwelten models llamaswap-config --output examples/local-providers/llama-swap.yaml

# Start the proxy
llama-swap --config examples/local-providers/llama-swap.yaml --listen :8090
```

Set `LLAMASWAP_HOST=http://localhost:8090/v1` in `.env` if you use a
non-default port (we use `:8090` to avoid conflicts).

## Seed shared models

For cross-runtime comparison we need the **same weights** loadable on
every runtime. For head-to-head at a specific quant you also need the
right GGUF file on disk for each quant you want to test. The eval
defaults currently expect:

| Model family | Q4_K_M source | Q8_0 source |
|---|---|---|
| gemma-4-26b-a4b | `unsloth/gemma-4-26B-A4B-it-GGUF` | `ggml-org/gemma-4-26B-A4B-it-GGUF` |
| glm-4-7-flash | (pull from Ollama or HF) | `ggml-org/GLM-4.7-Flash-GGUF` |
| gpt-oss-20b | (via Ollama) | `ggml-org/gpt-oss-20b-GGUF` (mxfp4) |
| nemotron-3-nano-4b | `unsloth/NVIDIA-Nemotron-3-Nano-4B-GGUF` | same |

Download what you need via `llama-cli -hf <repo>:<quant> -cnv` (ctrl-C
after the first token to keep the file), or LlamaBarn's UI, or LM
Studio's UI. Then `umwelten models llamaswap-config` will pick them up.

## Verify setup

```bash
# Catalog: show which runtimes are up and which models they agree on
pnpm tsx examples/local-providers/catalog.ts

# Smoke test: cold + warm latency per (runtime, model) with eviction
dotenvx run -- pnpm tsx examples/local-providers/smoke.ts

# Eviction spike: confirm one model at a time actually works
dotenvx run -- pnpm tsx examples/local-providers/eviction-spike.ts
```

## The matrix

Edit `shared/models.ts`. Three exported matrices:

- **`LOCAL_MATRIX`** — the "default" runtime behavior: 12 cells (4 models
  × 3 runtimes, ollama/llamabarn/llamaswap at their stock config). This
  is what you get out of the box.
- **`LOCAL_MATRIX_NOTHINK`** — 8 cells. Same 4 models but on
  `llamabarn-nothink` + `llamaswap-nothink` (Ollama excluded since its
  modelfiles don't expose a thinking toggle). Each request injects
  `chat_template_kwargs: { enable_thinking: false }`.
- **`LOCAL_MATRIX_ALL`** — union of the two.

Model IDs need to match what each runtime actually exposes — Ollama uses
short names (`gemma4:26b`), llama.cpp uses the HF-style alias
(`gemma-4-26b-a4b`). `smoke.ts`'s `FAMILY_ALIASES` handles the
cross-runtime family mapping.

## Run the quality suite

The benchmark is **model-major** — it loads one model at a time, runs
all four quality suites (instruction, reasoning, coding write, coding
fix) on it, evicts, then moves to the next. This is critical on hardware
that can't hold two big models simultaneously.

```bash
# Default matrix (12 entries, thinking-on wherever it is default)
dotenvx run -- pnpm tsx examples/local-providers/run-quality.ts

# Thinking OFF (8 llama.cpp entries)
dotenvx run -- pnpm tsx examples/local-providers/run-quality.ts --matrix nothink

# Both (20 entries)
dotenvx run -- pnpm tsx examples/local-providers/run-quality.ts --matrix all

# Subset filters
dotenvx run -- pnpm tsx examples/local-providers/run-quality.ts --only reasoning,coding
dotenvx run -- pnpm tsx examples/local-providers/run-quality.ts --model llamaswap

# Debug
dotenvx run -- pnpm tsx examples/local-providers/run-quality.ts --skip-evict   # no eviction
dotenvx run -- pnpm tsx examples/local-providers/run-quality.ts --new          # bust caches
```

Each suite caches per (task, model) so re-running is incremental. A
90-minute **watchdog** per suite prevents a hung model from stalling
the whole run.

Every suite run also triggers memory eviction between models — see
[Eviction](#eviction).

## Run the other suites

Speed, tool-math, soul-md are standalone scripts:

```bash
dotenvx run -- pnpm tsx examples/local-providers/speed.ts
dotenvx run -- pnpm tsx examples/local-providers/quality/tool-math.ts
dotenvx run -- pnpm tsx examples/local-providers/quality/soul-md.ts
```

## Generate the combined report

```bash
dotenvx run -- pnpm run cli eval combine \
  --config examples/local-providers/suite-config.ts \
  --format md --output output/local-providers-report.md

# Full narrative writeup
dotenvx run -- pnpm run cli eval combine \
  --config examples/local-providers/suite-config.ts \
  --format narrative --output output/local-providers-narrative.md
```

The report shows a leaderboard per dimension, provider breakdowns,
cost/speed tradeoffs, and per-task failure summaries. It consumes
the cached (model, task) scores written by each suite — you can
regenerate the report without re-running the models.

## Thinking mode

Most recent open-weights chat models emit hidden reasoning tokens
between `<think>` and `</think>` tags before their final answer. The
tokens are often stripped from the API response body but **counted in
`completion_tokens`** — which is why the same weights can take 20-200×
longer on a llama.cpp-based runtime (with `--jinja` chat template) than
on Ollama.

Some chat templates expose a template parameter to disable this. For
llama.cpp `--jinja` servers, we inject:

```json
{
  "chat_template_kwargs": { "enable_thinking": false }
}
```

…into every POST body. This is wired up via `extraBody` passthrough on
the `llamaswap-nothink` and `llamabarn-nothink` providers (see
`src/providers/llamaswap.ts` and `llamabarn.ts`).

What we've measured so far:

- On llamaswap+gemma-4-26b, an instruction task: **981s → 8.6s**
  (~114× speedup). Same weights, same runtime, same API.
- On llamabarn+glm-4-7-flash coding suite: **5226s → 209s** (~25×).
- Scores are **indistinguishable** — the hidden reasoning tokens don't
  measurably improve outcomes on these tests.

**Caveat:** the tests are short-horizon. Harder multi-step problems
might still benefit from thinking. Add your own.

## Quantization

Quantization is the precision at which model weights are stored. Common
levels for our models:

| Quant | bits/weight | ~Size for 26B | Notes |
|---|---|---|---|
| Q4_K_M | ~4 | 17 GB | Ollama's default. Good quality/size tradeoff. |
| Q5_K_M | ~5 | 20 GB | |
| Q8_0 | 8 | 27 GB | llama.cpp HF ggml-org default. Near-lossless. |
| BF16 / F16 | 16 | 50 GB | Baseline / "full precision". |

Smaller quants are **mechanically faster** (less data per arithmetic op)
and **degrade quality**, but how much depends on the model and task.

Our benchmark supports any quant per (runtime, model) cell — the `-q4` /
`-q8` suffix in `LOCAL_MATRIX` entries routes to the corresponding GGUF
file via llamaswap's YAML aliases and LlamaBarn's `models.ini` entries.

`umwelten models llamaswap-config --prefer-quant smallest|largest`
generates a YAML pinned to the smaller or larger of whatever's in your
GGUF cache. Use this to flip a whole run between "Q4 on everything" and
"Q8 on everything" without hand-editing.

**Claims we're set up to test** (some have data, some don't yet):

1. Q4 is ~2-5% worse than Q8 on hard reasoning, indistinguishable on
   easy tasks. *Data TBD.*
2. Q8 is within noise of BF16 for all tasks. *Data TBD.*
3. Smaller models degrade more from Q4 than larger models ("quantization
   costs more at the bottom"). *Data TBD.*
4. llama.cpp at Q4 is the same speed as Ollama at Q4 (i.e. the
   "llama.cpp is faster" claim is quantization confound). *Partial data
   — gemma-4-26b Q4-vs-Q8 comparison in progress.*

## Eviction

Only one model at a time on our hardware (M4 Max, 64 GB). The runner
evicts everything else before each new (runtime, model) starts:

- **Ollama**: POST `/api/generate` with `keep_alive: 0` per-model.
- **llama-swap**: `GET /unload` unloads all swapped models.
- **LlamaBarn**: `pkill -9` the `llama-server --host 127.0.0.1` child
  (the GUI coordinator respawns it on next request). **SIGKILL is
  required** — SIGTERM is ignored.
- **LM Studio**: no programmatic unload. Rely on JIT mode if the GUI is
  configured that way.

`shared/evict.ts` centralizes this. `eviction-spike.ts` is a standalone
harness that verifies the single-model-at-a-time invariant across the
full matrix.

## Memory monitoring

`memory-log.sh` samples every 60s to `/tmp/memory.log`:

```
timestamp | free=XG active=XG wired=XG swap=XG | models=XG | <per-proc>
```

Run it in a terminal while benchmarks are going to watch for pressure.
Swap usage climbing toward 30+ GB is a sign the eviction isn't working.

## What each quality dimension tests

| Dimension | Type | Scoring | Tests |
|---|---|---|---|
| **instruction** | deterministic | `/30` | Exact word count, JSON shape, alphabetized list, negative constraints, format transformation, multi-format |
| **reasoning** | LLM judge | `/20` | Surgeon riddle, bat & ball, lily pad, counterfeit coin |
| **coding — write** | compile + run + check stdout | `/126` | 6 problems × 3 languages (TS, Python, Go) |
| **coding — fix** | hidden test harness | `/25` | 5 buggy JS functions, run hidden tests against the fix |
| **tool math** | deterministic + tool-call count | `/25` | 5 multi-step arithmetic problems using calculator + statistics tools |
| **soul.md** | LLM judge over final artifact | `/10` | 8-turn conversation where assistant maintains `soul.md` using read_file / write_file |

## Adding a new dimension

To bolt on another axis (e.g. sampling temperature, or a new runtime):

1. **If it's a new runtime**: add `src/providers/<name>.ts`, register in
   `src/providers/index.ts`, add to `catalog.ts`'s `RUNTIMES` list, add
   eviction logic in `shared/evict.ts`.

2. **If it's a new config knob of an existing runtime** (like
   `enable_thinking`): use the pattern in `llamaswap-nothink` /
   `llamabarn-nothink` — register a variant provider key that wraps
   the base provider with `extraBody` + a distinct `providerId` (so
   `validateModel()` round-trips correctly; see the fix in commit
   `2176b34`).

3. **If it's a new quant**: add a separate GGUF file entry to
   llama-swap.yaml (suffix the alias, e.g. `gemma-4-26b-a4b-q4`),
   edit LlamaBarn's models.ini, `ollama pull <model>:<quant-tag>`.
   Add matching `-q4`/`-q8` entries to `LOCAL_MATRIX`.

4. **Always**: add a `family` for any cell that should cluster with
   existing ones in the combined report's per-dimension breakdown.
   Same-weight comparisons rely on this.

5. **Document why**. Add a row to the "four dimensions" table at the
   top of this README. Point at which commit introduced the dimension.

## Files

| File | What |
|---|---|
| `shared/models.ts` | `LOCAL_MATRIX`, `LOCAL_MATRIX_NOTHINK`, `LOCAL_MATRIX_ALL` — the source of truth for what gets tested |
| `shared/evict.ts` | Per-runtime eviction + memory sampling |
| `run-quality.ts` | The main driver. Model-major loop with eviction, watchdog, resume. |
| `quality/*.ts` | Each quality suite exports `makeSuite(models)` — the driver imports and runs them one-model-at-a-time |
| `suite-config.ts` | `EvalDimension[]` for `umwelten eval combine` |
| `catalog.ts` | Cross-runtime model discovery + llama-swap YAML generation |
| `speed.ts` | Streaming latency benchmark (TTFT, tok/s, cold vs warm) |
| `smoke.ts` | Pre-flight sanity test across shared-family models |
| `eviction-spike.ts` | Verify single-model-at-a-time invariant |
| `memory-log.sh` | Minute-granularity memory logger |
| `llama-swap.yaml` | (generated, gitignored) — the config fed to the llama-swap binary |

## What's next

- **Finish quantization dimension** — run Q4 on llama.cpp runtimes for
  gemma-4-26b and nemotron-4b, compare against existing Q8 data.
- **Add BF16 baseline** for a reference ceiling on at least one model.
- **Autoresearch agent** — the `soul-md` test's file-tools substrate
  is the seed. Swap the scripted conversation for a research goal,
  give the model `SkillsRegistry` + `stimulus/tools/loader.ts`, see
  what it builds.
- **Cost-per-score axis** — local is "free" in API dollars but not in
  watts or time. Would be useful to quantify.
