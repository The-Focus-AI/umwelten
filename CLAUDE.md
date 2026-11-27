# CLAUDE.md

Guidance for coding agents working in `The-Focus-AI/umwelten`.

## Architectural Principle

Umwelten builds **strictly what is not built into Pi (`@earendil-works/pi-*`) and Pi Durable (`@earendil-works/pi-durable`)**:
- **Never** re-introduce custom provider wrappers, model catalogs, custom agent loops (`cognition/`, `Stimulus`, `Interaction`, `BaseModelRunner`), custom MCP JSON-RPC clients or servers (use the official `@modelcontextprotocol/client` / `server` SDK 2.x), or custom terminal chat CLIs.
- Cloud providers come directly from `@earendil-works/pi-ai/providers/all` (`builtinModels()`); custom and local OpenAI-compatible endpoints configure through `~/.pi/agent/models.json` (`loadPiModelsJsonInto`).
- Interactive terminal coding sessions use `pi` (`@earendil-works/pi-coding-agent`) with `@umwelten/pi` installed (`pi install ./packages/pi`).

## Hard Rules

1. **No default output-token caps (`standards/uncapped-benchmark-generation`)**: `runPiTurn` in `packages/pi/src/models.ts` MUST call raw `models.stream()` (never `streamSimple()` or `completeSimple()`, which inject `clampMaxTokensToContext`) and MUST leave `maxTokens` `undefined` unless the caller explicitly sets `maxTokens` on that task.
2. **Package manager**: Always use `pnpm` (never `npm`).
3. **Tests**: Always run `pnpm test:run` (never watch-mode `pnpm test`). Prefer end-to-end verification in `docs/specs/` + `docs/runs/` (`session-spec-verify`) and concise contract tests over granular mock-heavy unit tests.
4. **Gemini models**: Never use `gemini-2` models; always use `gemini-3` (e.g. `gemini-3-flash-preview`).
5. **Environment variables**: Prefix live CLI/eval commands with `dotenvx run --` when reading keys from `.env`. `loadEnv()` automatically bridges `GOOGLE_GENERATIVE_AI_API_KEY` → `GEMINI_API_KEY`.
6. **Host-agnostic Durable Habitats**: Keep `DurableHabitat` and `HabitatHost` generic over `pi-durable` `Storage` and `ExecutionEnv` — never couple to Cloudflare Workers / `workerd`.

## Workspace DAG (10 Packages)

```text
@umwelten/substrate   (0 internal deps — isomorphic component/service runtime for Mycel Shell)
  └── @umwelten/mycel (Token Exchange: wholesale Suppliers → retail Applications, integer micro-dollars)

@umwelten/sessions    (0 internal deps — Pi JSONL, Pi Durable SQLite, Claude Code, Cursor → Explorations, search, promotion)
  └── @umwelten/pi    (Installable pi-package extension + thin @earendil-works/pi-ai turn/structured helpers)
        ├── @umwelten/evaluation (EvalSuite, PairwiseRanker Elo, calibrated Jev judgments, scorecards)
        ├── @umwelten/supplier   (GPU Supplier dial-in agent: discover, probe, headroom, WSS connect)
        └── @umwelten/habitat    (DurableHabitat & HabitatHost on pi-durable + A2A 1.0 + repo guards + ui://)
              ↑
@umwelten/protocols   (0 internal deps — OAuth 2.1 mcp-serve + RemoteMcpClient on MCP SDK 2.x, McpSkillHost, @leocavalcante/pi-a2a)

@umwelten/cli + umwelten (CLI entry `sessions | habitat serve | supplier | mycel` & published tsup bundle)
```

Note: `@umwelten/supplier` deliberately never imports `@umwelten/mycel` (keeping Postgres drivers off GPU hosts), and `@umwelten/mycel` never imports `@umwelten/pi`.

## Key Commands

```bash
pnpm run specs:check                                  # Validate docs/specs, standards, decisions, and runs
pnpm typecheck                                        # Typecheck all 10 packages + examples/**/*.ts
pnpm test:run                                         # Offline contract test suite (~20s)
pnpm lint                                             # ESLint across packages and examples
pnpm -r build                                         # Build packages/mycel/dist and packages/umwelten/dist

# Examples
pnpm tsx examples/pi-extension/demo.ts                # @umwelten/pi + PiDurableSessionAdapter Explorations
pnpm tsx examples/durable-habitat/host.ts             # HabitatHost + A2A 1.0 JSON-RPC over SQLite
dotenvx run -- pnpm tsx examples/evals/car-wash.ts    # Multi-model JudgeTask EvalSuite
dotenvx run -- pnpm tsx examples/evals/tool-math.ts   # Multi-step Pi tools + PairwiseRanker Elo
pnpm tsx examples/jev/run.ts                          # Calibrated judgment dry-run (--live for API calls)
pnpm tsx examples/mycel-e2e/run.ts                    # Full Exchange + Supplier metering E2E
pnpm run demo:mcp-skills                              # MCP skills chat host ↔ skill server E2E (examples/mcp-skills-chat)
```

## Specifications (`session-spec-verify`)

Active specs live in [`docs/INDEX.md`](./docs/INDEX.md), [`docs/standards/`](./docs/standards/), [`docs/specs/`](./docs/specs/), [`docs/decisions.jsonl`](./docs/decisions.jsonl), and [`docs/runs/`](./docs/runs/) using the skills in `.agents/skills/{spec-extract,spec-refactor,verify-deploy}/`. Whenever behavior or architecture changes, update the matching spec pack and `docs/decisions.jsonl`, then run `pnpm run specs:check`.

## Publishing Artifacts

To share generated HTML reports or walkthroughs with a human, publish via TheFocus.AI Artifacts (`npx @the-focus-ai/artifacts publish <file|dir>` with `THEFOCUS_ARTIFACTS_TOKEN`) rather than self-hosting.
