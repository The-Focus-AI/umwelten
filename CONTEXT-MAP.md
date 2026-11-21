# CONTEXT-MAP.md — Bounded Contexts & Dependencies

Umwelten consists of four bounded contexts layered cleanly atop `@earendil-works/pi-*` and `@earendil-works/pi-durable`:

1. **Sensemaking & Pi Extension** (`@umwelten/sessions` → `@umwelten/pi`)
   - Ingests `SourceSession`s from Pi JSONL v3, Pi Durable SQLite, Claude Code, and Cursor; projects `Exploration`s; runs ripgrep search; promotes knowledge into `FACTS.md` and `AGENTS.md`.
   - `@umwelten/pi` also provides the thin, uncapped `runPiTurn` / `runPiStructuredObject` helpers over `@earendil-works/pi-ai`.
2. **Evaluation & Calibration** (`@umwelten/evaluation` → `@umwelten/pi`)
   - `EvalSuite`, `PairwiseRanker` (Elo), `Jev` probability judgments, and `combine` / `Reporter` scorecards.
3. **Durable Habitats & Protocols** (`@umwelten/protocols`, `@umwelten/habitat`)
   - `@umwelten/protocols`: OAuth 2.1 `mcp-serve` server framework, `@earendil-works/pi-mcp` `RemoteMcpClient` (preserving `ui://` `EmbeddedResource`s), and `@leocavalcante/pi-a2a`.
   - `@umwelten/habitat`: Host-agnostic `DurableHabitat` and `HabitatHost` over `pi-durable` `Storage` + `ExecutionEnv`.
4. **The Token Exchange** (`@umwelten/substrate` → `@umwelten/mycel`, plus `@umwelten/supplier` → `@umwelten/pi`)
   - `@umwelten/mycel` is strictly isolated from `@umwelten/pi`, `@umwelten/evaluation`, and `@umwelten/habitat`.
   - `@umwelten/supplier` talks to `@umwelten/mycel` exclusively over HTTP and outbound WebSockets (`WSS /suppliers/connect`), keeping database drivers off GPU machines.
