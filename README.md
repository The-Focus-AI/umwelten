# Umwelten

Multi-model evaluations, cross-harness session sensemaking, host-agnostic **Durable Habitats**, and the **Mycel** Token Exchange — built directly on [**Pi**](https://github.com/earendil-works/pi) (`@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-mcp`) and **Pi Durable** (`@earendil-works/pi-durable`).

Umwelten deliberately avoids re-implementing what Pi already provides (model catalogs, streaming, coding tools, interactive CLI chat, compaction, `models.json`). Instead, it focuses strictly on the capabilities **not built into Pi**:

1. **Installable Pi Extension (`@umwelten/pi`)** — Plug cross-harness session search (`umwelten_session_search`), knowledge promotion (`umwelten_promote_knowledge` → `FACTS.md` / `AGENTS.md` / `.umwelten/reflections/`), and `/umwelten-explorations` straight into `pi`.
2. **Multi-Model Evaluations & Ranking (`@umwelten/evaluation`)** — Declarative `EvalSuite` (`VerifyTask` + LLM `JudgeTask` + multi-step tool benchmarks with uncapped `models.stream()`), Swiss/round-robin `PairwiseRanker` Elo tournaments, calibrated probability judgments (`Jev` / Brier / ECE), and multi-suite cost/speed scorecards.
3. **Cross-Harness Session Sensemaking (`@umwelten/sessions`)** — Read-only adapters for **Pi JSONL v3**, **Pi Durable SQLite** (`habitat.sqlite`), **Claude Code**, and **Cursor**, projecting trees and forks into queryable **Explorations** with fast `ripgrep` search and deterministic conversation beats.
4. **Host-Agnostic Durable Habitats (`@umwelten/habitat` + `@umwelten/protocols`)** — Multiplex SQLite- or Postgres-backed `DurableHabitat` instances in a single Node process (`HabitatHost`) over `@earendil-works/pi-durable` (`Storage` + optional `ExecutionEnv`), with Owned R/W vs. Mounted R/O repo guards, durable cron tasks, Turn Fan-out `Annotation` probes, `ui://` MCP-UI resources, A2A 1.0 serving (`@leocavalcante/pi-a2a/durable`), and OAuth 2.1 `mcp-serve`.
5. **The Mycel Token Exchange & GPU Suppliers (`@umwelten/mycel` + `@umwelten/supplier`)** — Wholesale-to-retail token Exchange (`mycel.thefocus.ai`) metered in integer micro-dollars with hard `Guarantee` / `Capability` dispatch filters and outbound WebSocket GPU Supplier dial-in (`umwelten supplier dial`).

---

## Quick Start

### 1. Install the Pi Extension (`@umwelten/pi`)

```bash
pi install ./packages/pi
```

Inside `pi`, you gain:
- `umwelten_session_search` — ripgrep across Pi, Pi Durable SQLite, Claude Code, and Cursor sessions
- `umwelten_promote_knowledge` — route distilled facts and instructions to `FACTS.md`, `AGENTS.md`, or `.umwelten/reflections/`
- `/umwelten-explorations` — inspect projected Explorations for the current workspace

For custom or local OpenAI-compatible endpoints (Mycel, Ollama, vLLM, llama-swap), configure Pi's native `~/.pi/agent/models.json`.

### 2. Run Multi-Model Evaluations (`@umwelten/evaluation`)

```ts
import "@umwelten/pi";
import { z } from "zod";
import { EvalSuite } from "@umwelten/evaluation";

const suite = new EvalSuite({
  name: "car-wash",
  systemPrompt: "Think carefully and give a clear recommendation.",
  temperature: 0.2,
  // Leave maxTokens undefined on benchmarks so models.stream() stays uncapped
  models: [
    { provider: "google", name: "gemini-3-flash-preview" },
    { provider: "openrouter", name: "anthropic/claude-sonnet-4.6" },
  ],
  tasks: [
    {
      id: "car-wash",
      prompt: "The car wash is 50 meters away. Should I walk or drive?",
      maxScore: 5,
      judge: {
        schema: z.object({
          reasoning_quality: z.coerce.number().min(1).max(5),
          explanation: z.string(),
        }),
        instructions: ["Score 5 only if the model says DRIVE because the car must be at the wash."],
      },
    },
  ],
});

await suite.run();
```

### 3. Host Durable Habitats Over A2A 1.0 (`@umwelten/habitat`)

```bash
# Serve lazy-opened SQLite DurableHabitats at /habitats/:id/{.well-known/agent-card.json,a2a}
dotenvx run -- pnpm run cli -- habitat serve --port 7430 --data-dir ./habitats-data
```

### 4. Search Sessions & Promote Knowledge (`@umwelten/sessions`)

```bash
pnpm run cli -- sessions explorations
pnpm run cli -- sessions search "micro-dollars"
pnpm run cli -- sessions promote "Always run pnpm test:run in CI." --target agent-instruction
```

---

## Examples (`examples/`)

Every example in `examples/` is typechecked in CI and demonstrates capabilities built **on top of** Pi:

- [`examples/pi-extension/demo.ts`](./examples/pi-extension/demo.ts) — `@umwelten/pi` extension tools + projecting `pi-durable` SQLite conversations into Explorations
- [`examples/durable-habitat/host.ts`](./examples/durable-habitat/host.ts) — `HabitatHost` multiplexing SQLite `DurableHabitat`s over A2A 1.0 HTTP
- [`examples/evals/`](./examples/evals/) — `car-wash.ts` (`JudgeTask`), `instruction.ts` (`VerifyTask`), `reasoning.ts`, and `tool-math.ts` (multi-step Pi tools + `PairwiseRanker` Elo)
- [`examples/jev/`](./examples/jev/) — Calibrated probability judgments (`Jev` vs. LLM constrained-sampling baseline, Brier & ECE)
- [`examples/model-showdown/`](./examples/model-showdown/) — Aggregating multi-suite `EvalDimension` runs into scorecards
- [`examples/mycel-e2e/`](./examples/mycel-e2e/) — End-to-end Mycel Exchange + Supplier metering over `@earendil-works/pi-ai`

---

## Specifications & Verification

Active specifications, external standards, architectural decisions, and immutable verification runs are managed with [`session-spec-verify`](https://github.com/The-Focus-AI/session-spec-verify) under [`docs/INDEX.md`](./docs/INDEX.md) (historical VitePress docs are archived in [`docs-archive/`](./docs-archive/)).

```bash
pnpm run specs:check   # Validate standards, spec packs, decisions, and run verdicts
pnpm typecheck         # Typecheck all workspace packages + examples/**/*.ts
pnpm test:run          # Run offline contract test suite (~20s)
pnpm lint              # Lint packages and examples
pnpm -r build          # Build published umwelten and mycel bundles
```
