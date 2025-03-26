
# 🧠 Model Evaluation Tool — Developer Specification

## ✅ Objective

A local tool + web dashboard to systematically evaluate models (OpenRouter, Olama, etc.) via the Vercel AI SDK. It measures:

- **Response Speed**
    
- **Response Quality**
    
- **Cost**
    

And stores structured results in per-run directories with visual exploration via a lightweight web dashboard.

---

## 🛠️ Tech Stack

### Runtime & Tooling

- **Node.js** (v20+)
    
- **TypeScript** (strict mode)
    
- **pnpm** (for package management)
    
- **Vercel AI SDK** (model interface layer)
    
- **OpenRouter, Olama** model APIs (extensible)
    
- **Express.js** or **Next.js API Routes** (optional local server backend)
    
- **React + Vite** for dashboard (alternatively, a static HTML/JS dashboard if no framework is desired)
    
- **Tailwind CSS** for dashboard styling
    
- **Zod** for schema validation
    
- **Lowdb / SQLite / JSON files** for lightweight data storage
    
- **Bunyan / Pino** for logging
    
- **dotenv** for secrets & API keys
    

---

## 🗂 Directory Layout

```
model-eval/
├── apps/
│   ├── cli/              # Command-line interface for launching runs
│   └── dashboard/        # Local web UI (Vite + React)
├── packages/
│   ├── core/             # Shared logic: model runner, scorer, data structures
│   ├── store/            # File system storage + metadata handling
│   └── metrics/          # Timing, cost, scoring, format validation
├── runs/
│   ├── run_001/
│   │   ├── prompt.json
│   │   ├── outputs.json
│   │   ├── metadata.json
│   │   └── index.html
│   └── ...
├── .env
└── pnpm-workspace.yaml
```

---

## 🧩 Core Components

### 1. **CLI Tool (apps/cli)**

The CLI launches a test run with a prompt and configuration:

```bash
pnpm cli --prompt "Explain LLMs to a 5th grader" --models gpt-4,together/llama3 \
         --format json --priority quality --variants 3
```

- Creates new `run_xxx/` directory
    
- Saves prompt, metadata, settings
    
- Executes Vercel AI SDK calls
    
- Logs: latency, token usage, output
    
- Runs a scorer (e.g. GPT-4) to evaluate responses
    
- Validates formatting if specified (`--format json`)
    
- Stores output and score in metadata.json
    

> Supports configuration via CLI flags or a config file.

---

### 2. **Model Runner (packages/core)**

- Abstraction over Vercel AI SDK
    
- Supports pluggable model configs (OpenRouter, Olama, local models)
    
- Tracks:
    
    - Request/response timestamps
        
    - Raw output
        
    - `usage` object from SDK (tokens, etc.)
        
- Handles retries with exponential backoff on transient errors
    

---

### 3. **Scoring Engine (packages/metrics)**

- Compares model output to expected key points or correct answers
    
- Uses either:
    
    - Rule-based matchers (exact match, keyword match)
        
    - LLM-based scoring (`gpt-4` gives 1-10 score with reason)
        
- Supports format validation:
    
    - JSON/YAML/XML schema match
        
    - Markdown presence
        
    - Image (base64) detection
        

---

### 4. **Data Storage (packages/store)**

- Saves all run data in:
    
    - `prompt.json`
        
    - `outputs.json`
        
    - `metadata.json`
        
- Creates:
    
    - `index.html` inside each run folder for quick review
        
    - main `index.html` at root to navigate all runs
        
- Metadata includes:
    
    - Model name & provider
        
    - Speed (ms)
        
    - Tokens used
        
    - Cost (calculated via lookup table per provider)
        
    - Quality score
        

---

### 5. **Web Dashboard (apps/dashboard)**

- Local Vite + React app
    
- Reads `/runs` directory and visualizes data
    
- Features:
    
    - List of runs with prompt and timestamp
        
    - Per-model comparison (output, speed, cost, score)
        
    - Sortable table
        
    - Graphs: bar chart (cost), line chart (latency), radar (quality)
        

---

## 🧪 Evaluation & Weighting

Prompt user for preference (e.g., cost vs quality vs speed):

```ts
type PriorityProfile = {
  costWeight: number;      // 0.0–1.0
  qualityWeight: number;
  speedWeight: number;
}
```

Scores normalized, weighted, and rolled up into a **composite score**.

---

## 🔐 Secrets & API Keys

`.env` file (not checked in):

```
OPENROUTER_API_KEY=...
OLAMA_API_KEY=...
VERCEL_AI_KEY=...
```

---

## 🧯 Error Handling

- Retry logic (3 times) for model errors (timeouts, 5xx)
    
- JSON parse & format validation errors logged per run
    
- Errors per model call don’t crash the whole run
    
- Dashboard marks failures in red with error info
    

---

## 🧪 Testing Plan

### Unit Tests

- Model runner: mocks SDK, asserts latency & token tracking
    
- Scorer: expected vs actual results
    
- Format validators: JSON, Markdown, image base64
    

### Integration Tests

- CLI can run end-to-end and output to correct directory
    
- Dashboard can load and render output properly
    

### Manual QA

- Run a batch against 3 models with known prompt and expected answers
    
- Compare scores, costs, and formats in dashboard
    

---

## 📦 Optional Enhancements

- Add Git versioning to runs for traceability
    
- Sync metadata to SQLite if preferred over JSON
    
- Deploy dashboard with GitHub Pages or use Electron for desktop GUI
    
- Web-based prompt editor with batch test mode
    
- Authenticated dashboard (for team use)
    

---

Let me know if you want me to generate the initial folder structure, baseline `pnpm` workspace, or any starter code!