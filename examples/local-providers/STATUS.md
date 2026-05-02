# Status — Q4_K_M restart (2026-04-24)

## What changed

- **Switched every llama.cpp family to Q4_K_M** to match ollama (was Q8_0).
  Eliminates the Q4-vs-Q8 confound that was blocking apples-to-apples
  ollama-vs-llama.cpp comparison.
- **Added Qwen3.6 27B family** (dense, released 2026-04-22).
- **Dropped LlamaBarn runtime.** LlamaBarn.app rewrites `models.ini` at
  every launch, stripping custom `ctx-size = 131072` down to 4096 and
  renaming aliases. That silently caps generation context, which violates
  the "context as high as provider allows" rule in CLAUDE.md. llamaswap
  uses llama-server directly, so we control `--ctx-size 0` (model max).
- **Previous Q8 benchmark data** moved to `output/evaluations/*.q8-backup/`
  (not deleted — reversible). Invalid for comparison with new Q4 runs.

## Matrix (new)

**Primary (`LOCAL_MATRIX`):** 10 cells = 5 families × 2 runtimes.

| # | Family | Ollama | Llamaswap |
|---|---|---|---|
| 1 | gemma-4-26b-a4b | `gemma4:26b` | `gemma-4-26b-a4b` |
| 2 | glm-4-7-flash | `glm-4.7-flash:latest` | `glm-4-7-flash` |
| 3 | gpt-oss-20b (MXFP4) | `gpt-oss:latest` | `gpt-oss-20b` |
| 4 | nvidia-nemotron-3-nano-4b | `nemotron-3-nano:4b` | `nvidia-nemotron-3-nano-4b` |
| 5 | **qwen3-6-27b** (new) | `qwen3.6:27b` | `qwen3-6-27b` |

**Nothink (`LOCAL_MATRIX_NOTHINK`):** 5 cells, llamaswap-nothink only.
(Ollama has no nothink variant; LlamaBarn dropped.)

Total: **15 cells** to re-run.

## GGUF sources (all Q4_K_M except gpt-oss)

| Family | HF repo | Size |
|---|---|---:|
| gemma-4-26b-a4b | `ggml-org/gemma-4-26B-A4B-it-GGUF:Q4_K_M` | 16 GB |
| glm-4.7-flash | `unsloth/GLM-4.7-Flash-GGUF:Q4_K_M` | 17 GB |
| gpt-oss-20b | `ggml-org/gpt-oss-20b-GGUF:mxfp4` (native) | 12 GB |
| nemotron-3-nano-4b | `unsloth/NVIDIA-Nemotron-3-Nano-4B-GGUF:Q4_K_M` | 2.9 GB |
| qwen3.6-27b | `unsloth/Qwen3.6-27B-GGUF:Q4_K_M` | 16 GB |

**Total on disk:** ~64 GB (was ~120 GB at Q8_0).

## Runtimes

- **Ollama daemon** — Q4_K_M for gemma/glm/nemotron/qwen3.6, MXFP4 for gpt-oss
- **llama-swap on :8090** — reads `examples/local-providers/llama-swap.yaml`,
  serves all 5 models via `llama-server --ctx-size 0 --jinja`
- ~~LlamaBarn~~ — removed

## How to resume

```bash
# Verify llama-swap is running
curl -s http://localhost:8090/v1/models

# Run full matrix (15 cells, thinking + nothink)
dotenvx run -- pnpm tsx examples/local-providers/run-quality.ts --matrix all

# Or just thinking (10 cells)
dotenvx run -- pnpm tsx examples/local-providers/run-quality.ts --matrix thinking

# Generate reports after the run
dotenvx run -- pnpm run cli eval combine \
  --config examples/local-providers/suite-config.ts \
  --format md --output output/local-providers-report.md
```

## Known issues / open questions

1. **Qwen3.6 27B is a new model** — no prior data. Treat scores as
   provisional until we see if it's stable across the suites.
2. **Llamaswap-nothink for GPT-OSS was partial** in last Q8 run (status
   code 1 crash mid-Zigzag-Rail-Cipher task). Watch for reproducibility
   under Q4.
3. **gpt-oss MXFP4 is the same file on both runtimes** — apples-to-apples
   regardless of Q4/Q8 choice. Expect this family to show the smallest
   cross-runtime gap.
4. **Gemma tool-calling is broken across all sizes (2026-04-29 sweep).**
   - In nothink mode: calculator infinite-loops (10+ identical
     `1.07^5` calls), then returns empty. e2b 0/5, e4b 0/5×2, 26b-a4b
     0/5, 31b watchdog timeout.
   - In think mode: 26b-a4b and 31b both trip the 20-min suite watchdog,
     stuck in reasoning loops (78k tokens decoded on one cell with no
     output). Smaller variants (e2b/e4b) just return empty.
   - Affects both ollama and llamaswap. Worth a separate investigation —
     looks like a Gemma chat-template / tool-calling integration issue
     rather than a runtime bug.

## Gemma sweep (2026-04-29)

Added Gemma e2b and e4b variants to the matrix (full set: e2b, e4b,
26b-a4b, 31b). Ran two sweeps:

- **llamaswap-nothink Gemmas (4 cells):** 3 ok, gemma-4-31b watchdog
  timeout on tool-calling.
- **think-mode Gemmas (8 cells = 4 ollama + 4 llamaswap):** 6 ok,
  llamaswap:gemma-4-26b-a4b and llamaswap:gemma-4-31b both watchdog
  timeout on tool-calling (reasoning loop).

Combined report regenerated to `output/local-providers-report.md` and
`output/local-providers-report-narrative.md`. New top-3 (any provider):
gemma-4-26b-a4b llamaswap-nothink, gemma-4-31b llamaswap-nothink,
gemma4:31b ollama — all 100% on the 4-suite combined score.

## Files touched

| Path | Change |
|---|---|
| `examples/local-providers/shared/models.ts` | Dropped llamabarn, added qwen3.6-27b, 10 cells |
| `examples/local-providers/llama-swap.yaml` | Q4_K_M paths + qwen3-6-27b entry |
| `~/.llamabarn/models.ini` | Updated to Q4_K_M (unused now, kept for reference) |
| `output/evaluations/local-providers-*` | Archived to `.q8-backup` suffixes |

## Git state (pre-restart)

```
Uncommitted in examples/local-providers/:
  M STATUS.md                      (this file — restart plan)
  M shared/models.ts               (Q4 + drop llamabarn + qwen3.6)
  M llama-swap.yaml                (Q4_K_M paths + qwen3-6-27b)
  ?? run-quality.ts                (unchanged since Q8 run)
```
