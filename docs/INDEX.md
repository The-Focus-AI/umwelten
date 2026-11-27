# Umwelten — Modular Specifications & Verification Index

Multi-model evaluation suites, cross-harness **Explorations** and knowledge promotion, host-agnostic **Durable Habitats**, composable **Substrate** interfaces, and the **Mycel** token Exchange — built strictly on top of `@earendil-works/pi-*` and `@earendil-works/pi-durable`.

Historical VitePress documentation and numbered ADRs (`0001–0036`) are preserved in [`../docs-archive/`](../docs-archive/).

---

## Operational Defaults & Port Map (`74xx` Block)

| Surface / Setting | Default | Contract |
| :--- | :--- | :--- |
| **Node.js / Package Manager** | `Node.js >= 22.19` (`24 LTS` in CI), `pnpm@11.0.8` | Required for `@earendil-works/pi-*` (`node:sqlite`) and `--experimental-strip-types` |
| **HabitatHost (`habitat serve`)** | Port `7430` | `/health`, `/habitats/:id/.well-known/agent-card.json`, `/habitats/:id/a2a` (A2A 1.0) |
| **Mycel (the Exchange)** | Port `7438` (`MYCEL_URL`) | `POST /v1/chat/completions`, `GET /v1/models`, `WSS /suppliers/connect` |
| **Supplier Managed Runtime** | Port `7439` | `llama-swap` supervised local GGUF serving |
| **Project Working Data** | `.umwelten/` | `explorations/`, `reflections/`, `artifacts/` |

---

## External Standards (`docs/standards/`)

Protected, repository-agnostic rules shared across **TheFocus.AI** projects:

- [`standards/portable-agent-skills`](./standards/portable-agent-skills.md) — Kebab-case skill identity and zero-dependency self-contained skill scripts across harnesses.
- [`standards/uncapped-benchmark-generation`](./standards/uncapped-benchmark-generation.md) — No hidden default output-token caps in shared runners; explicit per-task `maxTokens` only.
- [`standards/per-speaker-agent-identity`](./standards/per-speaker-agent-identity.md) — Per-speaker authentication/isolation across A2A/MCP and mandatory `X-Mycel-End-User` attribution.

---

## Conceptual Spec Layers (`docs/specs/`)

### Foundation Layer
- [`foundation/pi-model-runtime`](./specs/foundation/pi-model-runtime.md) — Direct `@earendil-works/pi-ai` `builtinModels()` + `~/.pi/agent/models.json` resolution, uncapped `models.stream()` execution (`runPiTurn`), and constrained structured output (`@umwelten/pi`).
- [`foundation/substrate-composition`](./specs/foundation/substrate-composition.md) — Zero-dependency spatiotemporal component/service runtime and `ui://` MCP-UI resource projection (`@umwelten/substrate`, `@umwelten/habitat`).

### Orchestration Layer
- [`orchestration/durable-habitats`](./specs/orchestration/durable-habitats.md) — Host-agnostic `DurableHabitat` and multi-agent `HabitatHost` on `@earendil-works/pi-durable` (`Storage` + optional `ExecutionEnv`), Owned/Mounted repo write guards, durable cron schedules, and Turn Fan-out (`@umwelten/habitat`).
- [`orchestration/explorations-and-reflection`](./specs/orchestration/explorations-and-reflection.md) — Cross-harness `SourceSession` adapters (Pi JSONL v3, `pi-durable` SQLite, Claude Code, Cursor), ripgrep `searchSessions`, `Exploration` projection, deterministic beats, and knowledge promotion (`@umwelten/sessions`).
- [`orchestration/evaluation-and-ranking`](./specs/orchestration/evaluation-and-ranking.md) — `EvalSuite` (`VerifyTask`, `JudgeTask`), `PairwiseRanker` Elo tournaments, calibrated `Jev` probability judgments, caching, and multi-dimension scorecards (`@umwelten/evaluation`).

### Exchange Layer
- [`exchange/mycel-and-suppliers`](./specs/exchange/mycel-and-suppliers.md) — Closed-membership Mycel Exchange, integer micro-dollar boundary metering, Guarantee/Capability hard-filtered dispatch, and outbound WebSocket GPU Supplier dial-in (`@umwelten/mycel`, `@umwelten/supplier`).

### Interfaces Layer
- [`interfaces/protocols-and-extensions`](./specs/interfaces/protocols-and-extensions.md) — A2A v1.0 (`@leocavalcante/pi-a2a`), MCP client/server on the official SDK 2.x (protocol `2026-07-28`) preserving `ui://` resources, the MCP Skills extension (server catalog, host approval/verification, pi-durable `skill_load`), A2A↔MCP skill mapping, `mcp-serve` OAuth 2.1 server, published `umwelten` CLI bundle, and installable `@umwelten/pi` extensions (`@umwelten/protocols`, `@umwelten/pi`, `@umwelten/cli`, `umwelten`).

---

## Ledgers & Immutable Verification Runs

- [`decisions.jsonl`](./decisions.jsonl) — Append-only JSONL record of architectural choices and simplifications (`D-1`..`D-12`).
- [`runs/`](./runs/) — Immutable timestamped verification outputs (`<YYYY-MM-DDTHH-MM-SSZ>_<short-sha[-dirty]>/`).
