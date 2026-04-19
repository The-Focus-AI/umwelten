# Status — pause point (2026-04-19)

Paused for battery. Everything on disk is resume-safe.

## What's running

- `llama-swap` proxy on `:8090` (no model loaded — PID 83403)
- `Ollama.app` daemon (no model loaded)
- `LlamaBarn.app` coordinator (~6 MB idle stub — PID 84082)
- **No benchmark processes running**

Safe to close the lid / unplug.

## What's been measured

### Matrix: runtime × model × thinking

17 of 20 cells complete with full scores across all 4 quality suites
(instruction /30, reasoning /20, coding write /126, coding fix /25).

| # | Provider | Model | Status |
|---|---|---|---|
| 1 | ollama | gemma4:26b | ✅ full |
| 2 | ollama | glm-4.7-flash:latest | ✅ full |
| 3 | ollama | gpt-oss:latest | ✅ full |
| 4 | ollama | nemotron-3-nano:4b | ✅ full |
| 5 | llamabarn | gemma-4-26b-a4b | ✅ full |
| 6 | llamabarn | glm-4.7-flash | ✅ full |
| 7 | llamabarn | gpt-oss-20b | ✅ full |
| 8 | llamabarn | unsloth/...Nemotron-3-Nano-4B...Q8_0 | ✅ full |
| 9 | llamaswap | gemma-4-26b-a4b | ✅ full |
| 10 | llamaswap | glm-4-7-flash | ✅ full |
| 11 | llamaswap | gpt-oss-20b | ✅ full |
| 12 | llamaswap | nvidia-nemotron-3-nano-4b | ✅ full |
| 13 | **llamabarn-nothink** | gemma-4-26b-a4b | ✅ full |
| 14 | **llamabarn-nothink** | glm-4.7-flash | ✅ full |
| 15 | **llamabarn-nothink** | gpt-oss-20b | ✅ full |
| 16 | **llamaswap-nothink** | gemma-4-26b-a4b | ✅ full |
| 17 | **llamaswap-nothink** | glm-4-7-flash | ✅ full |
| 18 | llamaswap-nothink | gpt-oss-20b | ⚠ missing 2 coding + all 5 bugfix |
| 19 | llamabarn-nothink | nemotron-4b | ⌛ not started |
| 20 | llamaswap-nothink | nemotron-4b | ⌛ not started |

### Why 18 is partial

llama-server (the llamaswap child for gpt-oss) exited with status 1 mid-run
on the Zigzag Rail Cipher Go task. Single observation — could be transient.
The AI SDK's retry loop hung waiting for restart, which is what prompted
the pause. Resume should either retry cleanly or reproduce the crash.

## Live leaderboard from what's done

Full table in any earlier conversation message or via:

```bash
dotenvx run -- pnpm run cli eval combine \
  --config examples/local-providers/suite-config.ts \
  --format md --output output/local-providers-report.md
```

**Top results so far:**

- Tied at 100%: `gpt-oss-20b` / llamabarn
- 98.5%: `gpt-oss-20b` / llamaswap, `gpt-oss:latest` / ollama
- 97%: `gemma4:26b` / ollama
- 95-96%: `gemma-4-26b-a4b` / llamaswap + both nothink variants

**Thinking on/off findings** (same weights, same runtime):

| Model family | thinking ON | thinking OFF | Delta |
|---|---:|---:|---:|
| gemma-4-26b-a4b on llamabarn | 86.1% | **95.0%** | +8.9% (nothink wins) |
| gemma-4-26b-a4b on llamaswap | 96.5% | 94.0% | -2.5% |
| glm-4.7-flash on llamabarn | **87.6%** | 74.1% | -13.5% (thinking wins) |
| glm-4-7-flash on llamaswap | 85.6% | 80.6% | -5.0% |
| gpt-oss-20b on llamabarn | **100.0%** | pending full | — |
| gpt-oss-20b on llamaswap | 98.5% | partial | — |

**Time savings from nothink** (full suite per model):
- 114-219× faster on instruction for gemma/glm on llamaswap
- 25-43× faster on coding for gemma/glm on llamaswap
- 20-25× faster on coding for gemma/glm on llamabarn

## Known issues / open questions

1. **LlamaBarn gpt-oss was flaky** — in the earlier thinking-on run, it
   returned "Compute error" on many tasks. In the nothink run it worked
   fine. Might be a LlamaBarn version issue or a template issue.
2. **llama-server crash on gpt-oss Zigzag Go** — unverified if reproducible.
   Could be related to Zigzag specifically (it's been in the top outliers
   list) or unrelated.
3. **Q4 vs Q8 is a confound** we haven't isolated yet. Ollama is serving
   Q4_K_M across the board; llamaswap/llamabarn are serving Q8_0 (for
   gemma/glm/gpt-oss) or Q8_0 (for nemotron). Need Q4 entries on
   llamaswap/llamabarn to make apples-to-apples claims.

## Next steps (when we resume)

### Immediate (finish what we started)

1. **Resume the nothink run** — picks up model 18 (missing gpt-oss coding)
   + runs models 19-20 (both nemotron-4b nothink). Cached tasks skip.
   ```bash
   dotenvx run -- pnpm tsx examples/local-providers/run-quality.ts --matrix nothink
   ```
   Expected: ~20-30 min.

2. **Regenerate combined report** including all the nothink data:
   ```bash
   dotenvx run -- pnpm run cli eval combine \
     --config examples/local-providers/suite-config.ts \
     --format md --output output/local-providers-report.md
   dotenvx run -- pnpm run cli eval combine \
     --config examples/local-providers/suite-config.ts \
     --format narrative --output output/local-providers-narrative.md
   ```

### Quantization dimension (the Q4-vs-Q8 work we paused on)

3. **Generate a Q4-preferred llama-swap YAML** next to the current Q8 one,
   OR add `-q4` / `-q8` aliases to the existing YAML so both are served
   simultaneously. The library already supports `--prefer-quant`:
   ```bash
   umwelten models llamaswap-config --prefer-quant smallest \
     --output examples/local-providers/llama-swap-q4.yaml
   ```

4. **Add `-q4` / `-q8` entries to LOCAL_MATRIX** in `shared/models.ts`
   for gemma-4-26b + nemotron-4b. Needs corresponding LlamaBarn
   `models.ini` entries + llama-swap YAML aliases.

5. **Run the Q4-on-llama.cpp cells** — 4 new cells:
   - gemma-4-26b-a4b-q4 / llamabarn(-nothink)
   - gemma-4-26b-a4b-q4 / llamaswap(-nothink)
   - nemotron-4b-q4 / llamabarn(-nothink)
   - nemotron-4b-q4 / llamaswap(-nothink)

6. **Compare scores** — if Q4 scores ≥ Q8 scores, we've refuted the claim
   that llama.cpp needs Q8 to be "faithful to the weights."

### Outlier rerun (skipped when we paused)

7. **Verify the biggest outlier** — llamabarn/glm-4.7 "constrained-list"
   at 332s (199× median). Fire the same prompt 3× and see if it's
   reproducible or transient. Script already staged at
   `examples/local-providers/rerun-outlier.ts`.

### Still-scaffolded suites (never run)

8. **Tool-math** — deterministic scoring via calculator + statistics tools
9. **Soul.md** — 8-turn conversation + file-tools sandbox, LLM-judged

## Files in play

| Path | Purpose | State |
|---|---|---|
| `examples/local-providers/README.md` | Main doc — dimensions, claims-under-test | Up-to-date |
| `examples/local-providers/STATUS.md` | This file | Up-to-date |
| `examples/local-providers/shared/models.ts` | `LOCAL_MATRIX`, `LOCAL_MATRIX_NOTHINK`, `LOCAL_MATRIX_ALL` | Up-to-date |
| `examples/local-providers/run-quality.ts` | Model-major driver w/ 90-min watchdog | Up-to-date |
| `examples/local-providers/quality/*.ts` | 4 suites as `makeSuite(models)` factories | Up-to-date |
| `examples/local-providers/rerun-outlier.ts` | Staged, not run | Ready |
| `examples/local-providers/eviction-spike.ts` | Single-model invariant verifier | Works |
| `examples/local-providers/memory-log.sh` | 60s memory sampler | Works |
| `examples/local-providers/suite-config.ts` | `EvalDimension[]` for `eval combine` | Core 4 suites only |
| `output/evaluations/local-providers-*` | 17/20 model-cells cached | Resume-ready |
| `/tmp/quality-nothink.log` | Nothink run log | Preserved |
| `/tmp/memory-nothink.log` | Memory trajectory | Preserved |

## Git state

All code is committed. Recent relevant commits:

```
f060425 docs: document sleepingrobots + willschenk claims under test
83fb6e9 docs: rewrite README with 4-dimensional framing
2176b34 fix: preserve provider identity through validateModel
427d38e feat: add thinking on/off dimension
74ab88f feat: 90-min suite watchdog + memory logger + report aliases
```

Uncommitted tree:
- `examples/local-providers/rerun-outlier.ts` (new, not yet committed — it's a one-off)
- Other unrelated work in `examples/oura-mcp/` and `examples/twitter-mcp/`

Not blocking resume — the rerun-outlier script is useful but not
referenced elsewhere yet.
