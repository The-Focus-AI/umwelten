# CONTEXT.md — Domain Language

Shared domain vocabulary for Umwelten on Pi and Pi Durable.

## Sessions & Sensemaking (`@umwelten/sessions`, `@umwelten/pi`)

- **Source Session**: An immutable persisted conversation produced by an external or durable harness (`pi` JSONL v3 tree, `pi-durable` SQLite conversation, `claude-code`, or `cursor`). Read non-destructively via a `SessionAdapter`.
- **Exploration**: A queryable grouping of one or more `SourceSession` references (`default` per discovered session/fork, `virtual` from a search query, or `saved` under `.umwelten/explorations/`).
- **Conversation Beat**: A deterministic turn boundary (`user` prompt → tool calls → `assistant` answer) extracted without an LLM call.
- **Promotion (`PromotionRouter`)**: Routing distilled session insights into durable repository files: declarative truths → `FACTS.md`, imperative guidance → `AGENTS.md` (`<!-- umwelten:reflections:start/end -->`), and dated notes → `.umwelten/reflections/`.

## Durable Habitats (`@umwelten/habitat`)

- **DurableHabitat**: A stateful agent backed by `@earendil-works/pi-durable`'s transactional `Harness` over generic `Storage` (`openNodeSqliteStorage`, `MemoryStorage`, or Postgres) and optional `ExecutionEnv` (`undefined` for zero-container API Habitats, `NodeExecutionEnv` or `pi-env` for coding Habitats).
- **HabitatHost**: A single Node process multiplexing many `DurableHabitat` SQLite stores on demand (`/habitats/:id/a2a`), evicting idle Harnesses from RAM while keeping scheduled wake timers armed.
- **Owned vs. Mounted Repository**: Each coding Habitat has at most one **Owned** read/write repository and zero or more **Mounted** read-only repositories, enforced by `createRepoScopeExtension` (`ToolTask` `beforeTool` hook).
- **Turn Fan-out (`Annotation`)**: Post-turn `GenerationTask` `afterRun` child tasks that compute structured sidecar annotations stored in `ConversationAnnotationsDoc`.

## Evaluation & Judgment (`@umwelten/evaluation`)

- **EvalSuite**: Declarative multi-model runner executing deterministic `VerifyTask`s and LLM-scored `JudgeTask`s over uncapped `@earendil-works/pi-ai` `models.stream()` calls with disk caching and watchdog `AbortSignal` propagation.
- **PairwiseRanker**: Head-to-head Swiss or round-robin LLM judge comparisons producing rating-conserving Elo standings.
- **Judgment (`Jev`)**: Bounded probability estimation (`binary`, `choice`, `ordinal`) evaluated on calibration and proper scoring rules (Brier score, Ranked Probability Score, reliability bins, selective risk).

## The Exchange (`@umwelten/mycel`, `@umwelten/supplier`)

- **Mycel (the Exchange)**: Buys inference wholesale from Vendors and GPU **Suppliers** and resells it retail to **Applications** on behalf of **Clients** and **End Users**.
- **Offer / Guarantee / Capability**: What a Supplier serves. Dispatch hard-filters on required **Guarantees** (e.g. `on-premise`, `no-training`) and probed **Capabilities** (`chat`, `streaming`, `tool-calling`) before ranking by price and **Headroom**.
- **Micro-dollar**: Exact integer currency unit (`$1.00 = 1_000_000` micro-dollars) used for every **Cost**, **Charge**, and **Balance**.
