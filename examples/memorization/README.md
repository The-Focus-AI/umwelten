# Memorization Extraction Pipeline

Recreating ["Alignment Whack-a-Mole"](https://arxiv.org/abs/2406.xxxxx) (Liu et al., 2026) — finetuning LLMs on plot summaries causes verbatim reproduction of held-out copyrighted text.

## The Idea

Take a language model. Finetune it on plot summaries of books (not the actual text — just summaries). Then ask it to write passages about a book it wasn't finetuned on. The paper found that 85-90% of the held-out book comes out verbatim. The finetuning "unlocks" text the model memorized during pretraining.

The key metric is **bmc@k** (Best Match Coverage at k) — what fraction of the original book can you reconstruct from the model's outputs by finding consecutive word spans that match.

## Two Ways to Run This

### Option A: Local (Apple Silicon with MLX)

Free, runs on your Mac. Good for small models (4B-9B). Unlikely to reproduce the paper's 85-90% results because small models memorize less.

### Option B: Google Colab (GPU in the cloud)

$10/month for Colab Pro gets you an A100 GPU. Can finetune larger models (up to 30B) which memorize more. Use the included Jupyter notebook.

---

## Local Setup (MLX)

### Prerequisites

- **Node.js** + **pnpm**
- **mlx-lm** for LoRA finetuning on Apple Silicon
- **Ollama** for summary generation (Stage 2)

```bash
# Install mlx-lm
uv tool install mlx-lm

# Pull a local model for generating summaries
ollama pull nemotron-3-nano:4b
```

### Step 1: Add books

Place `.epub`, `.pdf`, or `.txt` files in `input/memorization/books/`.

### Step 2: Convert to plain text (if epub/pdf)

```bash
pnpm tsx examples/memorization/00-convert-books.ts
```

### Step 3: Configure

Edit `input/memorization/config.json`:

```json
{
  "trainBooks": ["book1", "book2"],
  "testBooks": ["held-out-book"],
  "platform": "mlx",
  "baseModel": "mlx-community/NVIDIA-Nemotron-3-Nano-4B-4bit",
  "samplesPerExcerpt": 100,
  "temperature": 1.0,
  "epochs": 5,
  "loraRank": 8,
  "batchSize": 4,
  "summaryModel": "nemotron-3-nano:4b",
  "summaryProvider": "ollama",
  "maxTokens": 600
}
```

Book IDs are filenames without extension (e.g., `little-women.txt` → `"little-women"`).

`trainBooks` are finetuned on (summaries only). `testBooks` are held out — we measure how much the model reproduces them verbatim.

### Step 4: Run the pipeline

```bash
# Segment books into ~400-word chunks
pnpm tsx examples/memorization/01-segment.ts

# Generate plot summaries per chunk (slow — ~1hr per 1000 chunks)
dotenvx run -- pnpm tsx examples/memorization/02-summarize.ts

# Format summaries + text into training JSONL
pnpm tsx examples/memorization/03-prepare-data.ts

# Finetune with MLX LoRA (free, local)
pnpm tsx examples/memorization/04-finetune-mlx.ts

# Run inference — generates text from finetuned + baseline models
# Use --samples 5 for a quick test, or 100 for full replication
dotenvx run -- pnpm tsx examples/memorization/06-inference.ts --samples 5

# Compute bmc@k metrics
pnpm tsx examples/memorization/07-measure.ts

# Generate report
pnpm tsx examples/memorization/08-report.ts --format md --output report.md
```

The finetune script auto-resumes from checkpoints if interrupted.

### MLX Models (Nemotron-3 family, March 2026)

| Model | Params | Memory | HuggingFace ID |
|-------|--------|--------|----------------|
| Nemotron-3 Nano 4B | 4B (dense) | ~3 GB | `mlx-community/NVIDIA-Nemotron-3-Nano-4B-4bit` |

Other MLX models that work: `mlx-community/Qwen3.5-9B-MLX-4bit` (9B, ~5 GB).

---

## Colab Setup (GPU)

Use the included notebook to finetune larger models on a cloud GPU.

### What you need

1. **Google Colab** account — https://colab.research.google.com
2. **Colab Pro** ($10/month) for A100 GPU access — free tier T4 works for 4B only

### What's in the notebook

The file `colab-finetune.ipynb` is a self-contained Jupyter notebook that:

1. Installs Unsloth (a library that makes LoRA finetuning fast on NVIDIA GPUs)
2. Uploads your training data (the JSONL files from Stage 3)
3. Loads a Nemotron-3 model with QLoRA (4-bit quantized weights + LoRA adapters)
4. Trains for 5 epochs
5. Runs inference on test prompts (finetuned vs baseline)
6. Computes bmc@k right in the notebook
7. Downloads results as a zip

### How to use it

1. Open https://colab.research.google.com
2. File → Upload notebook → select `examples/memorization/colab-finetune.ipynb`
3. Runtime → Change runtime type → select **A100** GPU
4. Run cells top to bottom
5. When prompted, upload these files from your local machine:
   - `output/evaluations/memorization-data/runs/001/train.jsonl`
   - `output/evaluations/memorization-data/runs/001/valid.jsonl`
   - `output/evaluations/memorization-data/runs/001/test-prompts.jsonl`
   - `input/memorization/books/little-women.txt` (or whichever test book)
6. Choose which model to run — **run one of the two option cells** (not both):
   - **Option A**: Nemotron-3 Nano 4B — fast (~15 min), same as local but on GPU
   - **Option B**: Nemotron-3 Nano 30B-A3B — bigger MoE model, needs A100

### Nemotron-3 models on Colab

| Model | Total Params | Active Params | GPU Needed | Released |
|-------|-------------|---------------|------------|----------|
| Nano 4B | 4B | 4B (dense) | T4 or A100 | Mar 2026 |
| Nano 30B-A3B | 31.6B | 3.5B (MoE) | A100 (40GB) | Dec 2025 |
| Super 120B-A12B | 124B | 12B (MoE) | 8x H100 | Mar 2026 |

The Super 120B is too large for Colab — it needs multi-GPU cloud instances (RunPod, Lambda Labs, ~$8-15/hr).

### Colab vs Unsloth vs MLX — what's what

- **Colab** is a rented computer with a GPU in Google's cloud. You open a browser, it runs Python.
- **Unsloth** is a Python library that makes LoRA finetuning fast on NVIDIA GPUs. The notebook installs it automatically.
- **MLX** is Apple's framework for running models on Apple Silicon. The local pipeline uses it. Colab uses NVIDIA GPUs instead.

---

## Pipeline Stages

| # | Stage | What | Needs API? | Time |
|---|-------|------|------------|------|
| 0 | Convert | epub/pdf → txt | No | seconds |
| 1 | Segment | Split books into 300-500 word chunks | No | seconds |
| 2 | Summarize | Generate plot summaries per chunk | Ollama | ~1hr / 1000 chunks |
| 3 | Prepare | Format train/test JSONL for finetuning | No | instant |
| 4 | Finetune | LoRA finetuning (MLX local or Colab) | No | 15min-3hr |
| 6 | Inference | Generate from finetuned + baseline models | No | 5min-hours |
| 7 | Measure | Compute bmc@k memorization metrics | No | seconds |
| 8 | Report | Generate report (console/markdown/JSON) | No | instant |

Every stage caches its output. If interrupted, re-run the same command to resume.

## How bmc@k Works

From Algorithm 1 in the paper:

1. Tokenize the book and each model generation into word arrays
2. Find all contiguous spans of ≥ k words (default k=5) where the generation matches the book verbatim
3. Filter out spans that overlap with the instruction/summary (those words were prompted, not memorized)
4. Coverage = fraction of book words covered by matching spans

If bmc@5 = 0.85, that means 85% of the book's words appear in runs of 5+ consecutive matching words across all generations.

Additional metrics: longest matching span, count of long spans (>20 words), total span count.

## File Structure

```
examples/memorization/
  colab-finetune.ipynb  # Colab notebook for GPU finetuning
  shared/
    types.ts            # All pipeline types
    text-utils.ts       # Segmentation, tokenization, n-grams
    bmc.ts              # bmc@k algorithm (Algorithm 1)
    metrics.ts          # Per-book/model metric computation
    env.ts              # dotenv loading
    *.test.ts           # Unit tests (28 tests)
  00-convert-books.ts   # epub/pdf -> txt
  01-segment.ts         # txt -> chunks JSONL
  02-summarize.ts       # chunks -> summaries JSONL
  03-prepare-data.ts    # chunks + summaries -> training JSONL
  04-finetune-mlx.ts    # MLX LoRA finetuning (local)
  04-finetune-hf.ts     # HuggingFace PEFT alternative
  06-inference.ts       # Run finetuned + baseline inference
  07-measure.ts         # Compute bmc@k metrics
  08-report.ts          # Generate report
  suite-config.ts       # eval combine integration
  run-all.ts            # Full pipeline orchestrator

input/memorization/
  books/                # Place .txt/.epub/.pdf files here
  config.json           # Pipeline configuration

output/evaluations/memorization-*/
                        # All stage outputs (auto-created)
```

## Tests

```bash
pnpm vitest run --config <(echo 'import { defineConfig } from "vitest/config"; export default defineConfig({ test: { include: ["examples/memorization/**/*.test.ts"], globals: true } })') --reporter verbose
```
