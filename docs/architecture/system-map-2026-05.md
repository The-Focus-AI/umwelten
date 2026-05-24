# Umwelten System Map — May 2026

A system-architect-level audit of the codebase: what the fundamental pieces are, how they fit together, where reality has drifted from the documented design, and what to do about it. Based on a parallel deep-dive across six subsystems.

## 0. Second pass — what the first pass missed

The six parallel subagents mapped subsystems against CLAUDE.md as the reference. On re-examination, the bigger problem is that CLAUDE.md itself is more broken than reported, and several artifacts didn't come up at all. Five additions:

### 0.1 The package layout in CLAUDE.md is wrong about which packages exist

CLAUDE.md lists six packages: `core`, `server`, `evaluation`, `habitat`, `ui`, `cli`. Reality: `cli`, `core`, `evaluation`, `habitat`, **`protocols`**, **`sessions`**, `ui`, **`umwelten`**.

- `@umwelten/server` **does not exist** — renamed to `@umwelten/protocols` (commit 8f44b16 "Aggressive package-layout simplification"). CLAUDE.md still references `@umwelten/server` four times.
- `@umwelten/sessions` — **not in CLAUDE.md at all**. It owns `sessionsCommand`, `browseCommand`, `introspectCommand`, and the introspection data layer; the CLI depends on it.
- `@umwelten/protocols` — **not mentioned at all**, despite being where MCP / A2A / OAuth all live.
- `umwelten` meta-package — mentioned in passing; its actual job (re-export everything for backwards compat) isn't described.

The documented DAG (`core ← server ← evaluation ← habitat ← ui ← cli`) is missing two nodes. True DAG is closer to: `core ← protocols ← (sessions, evaluation) ← habitat ← ui ← cli`, with `umwelten` as a meta-barrel.

### 0.2 The Exploration pipeline isn't undocumented — it's in CONTEXT.md, not CLAUDE.md

The first pass flagged `interaction/{projection,promotion,reflection,knowledge}/` as a "hidden feature pipeline." In fact, **CONTEXT.md** at the repo root is the formal domain glossary and defines every term these directories implement: *Interaction*, *Source Session*, *Exploration*, *Saved Exploration*, *Project Fact*, *Memory*, *Reflection*, *Saved Reflection*, *Exploration Browser*. ADR-0001 (`docs/adr/0001-project-pi-session-trees-as-explorations.md`) commits to the model.

So the drift is the opposite of what was reported: the code is right, the language is documented — but CLAUDE.md (the doc agents read) doesn't reference any of it. Two domain docs (CONTEXT.md + CLAUDE.md) describing the same system in different vocabularies is the actual problem.

### 0.3 There are at least four canonical architecture documents, all stale in different ways

- **CLAUDE.md** — agent instructions + module map. Wrong about packages (§0.1), wrong about `bridge/`, wrong about `reporting/` and `introspection/` locations.
- **CONTEXT.md** — domain language. Internally consistent but unreferenced from CLAUDE.md.
- **docs/architecture/overview.md** — another high-level map. Uses broken `@umwelten/...` link syntax (`[habitat](@umwelten/habitat/habitat.ts)` isn't a valid link), but otherwise mostly aligned with reality.
- **AGENTS.md** — thin pointer to GitHub Issues + CONTEXT.md.

Plus eight more architecture docs under `docs/architecture/` of varying staleness. `session-record-introspection.md` exists and accurately describes `session-record/` — the module CLAUDE.md fails to mention.

### 0.4 Tooling artifacts not surveyed

- `knip.json` is configured. `pnpm knip` would catch the dead-code items mechanically. **Run it.**
- `vitest.config.ts` uses `singleThread: true`. Test counts: core 65, habitat 18, evaluation 15, ui 6, sessions 2, cli 2, **protocols 0**. Protocols has zero tests despite holding OAuth-bearing modern code.
- `mise.toml` defines `habitat-build` / `habitat-run` / `habitat-serve` / `gaia` tasks the CLI doesn't document. These are the recommended entry points.
- Root `package.json` declares `docs:dev` / `docs:build` — there's a **VitePress site under `docs/`** (`homepage: umwelten.thefocus.ai`). Not mentioned in CLAUDE.md or the first-pass report.

### 0.5 The `umwelten` meta-package is doing real work that nobody flagged

`packages/umwelten/src/index.ts` is 349 lines of curated re-exports across every package — the public API for the npm-published `umwelten` package. When CLAUDE.md's "public barrel" is mentioned, that's `packages/core/src/index.ts`, but the *npm-published* barrel is the meta-package. Anything missing from `packages/umwelten/src/index.ts` is invisible to `npm install umwelten` users.

`packages/umwelten/src/mcp-serve.ts` is a backwards-compat re-export shim explicitly acknowledging a recent rename from `@umwelten/server` to `@umwelten/protocols`. Evidence the package rename is incomplete in the docs.

### Things still not investigated in depth

- **16 examples under `examples/`**, several non-trivial (`local-providers` 5272 LoC, `memorization` 3075, `mcp-chat` 2812, `model-showdown` 2780, `jeeves-bot` 1357). Reference implementations / fixtures the subsystem passes didn't enter. If any deep-imports `memory/`, the legacy MCP client, or `discord-routing.ts`, those are real migration constraints.
- **`docs/architecture/electron-shell.md`** describes a planned desktop shell wrapping `container-server`. If active, the "collapse the 4 HTTP servers" recommendation has to preserve `container-server.ts` surface area.
- **`docs/architecture/promote-tools-to-mcp.md`** is an open plan to bridge habitat tools to standalone `mcp-serve` MCP servers. Directly affects the "habitat/mcp-local-server.ts duplicates mcp-serve/mcp-handler.ts" finding — actively planned work, not just drift.
- **Provider list incomplete in CLAUDE.md.** Lists 8 providers; the directory has 11 sources. Missing: `minimax.ts`, `nvidia.ts`, `fireworks.ts`.
- **Hooks & CI** not surveyed. No pre-commit hooks or GitHub Actions reviewed.

## 1. The 30,000-foot picture

The codebase is a **pnpm monorepo** organized around three load-bearing concepts:

```
┌─────────────────────────────────────────────────────────────┐
│  Stimulus  (config: role + instructions + tools + options)  │
│        ↓                                                     │
│  Interaction  (state: messages + model + runner + session)  │
│        ↓                                                     │
│  ModelRunner  (execution: AI SDK + costs + rate limits)     │
│        ↓                                                     │
│  Provider  (Google, OpenRouter, DeepInfra, Ollama, …)        │
└─────────────────────────────────────────────────────────────┘
```

Everything else is built on top:

- **Habitat** = a directory + config + sessions + tools + sub-agents, with a multi-protocol HTTP server (MCP, A2A, web chat) on top.
- **Gaia** = a habitat that orchestrates other habitats in Docker containers.
- **Evaluation** = batch / matrix runners over Stimulus × Models, plus ranking & combine.
- **Sessions / Introspection** = adapters that pull conversation history from Claude Code, Cursor, Pi, or habitat sessions, normalize them, digest them, and present them in a TUI.
- **CLI / UI** = Commander tree + React Ink TUIs + Telegram/Discord adapters wrapping `Interaction`.

The dependency DAG **as designed** (per CLAUDE.md): `core ← server ← evaluation ← habitat ← ui ← cli`. The DAG **as built** is mostly right, with two seams: `ui/index.ts` re-exports habitat internals, and `cli → sessions → ui` is a runtime path that side-steps the documented order.

## 2. Subsystem-by-subsystem

### 2.1 Cognition (`packages/core/src/cognition/`) — **healthy, one fat file**

The cleanest subsystem. `BaseModelRunner` is the workhorse; `Stimulus` is data; `Interaction` is state; providers plug in via a thin `BaseProvider`. The HARD RULE about not capping `maxTokens` is actively guarded by `request-options.test.ts`.

**Drift:** `runner.ts` is 876 LoC with a 320-line `streamText` containing a provider-specific usage-extraction cascade (Ollama / OpenRouter / Google / GitHub Models) that should live in `usage-extractor.ts`. `ModelResponse.messages?` is on the TS type but missing from the Zod schema (silent shape drift waiting to bite). `ModelRunner.interaction: any` is a forward-ref hack. `SmartModelRunner.RunnerModification` is deprecated dead code. An ASCII-strip regex (`runner.ts:264`) silently drops non-English reasoning traces.

### 2.2 Interaction + Stimulus (`packages/core/src/interaction/`, `stimulus/`) — **carrying a hidden feature pipeline**

`Interaction` (382 LoC) and `Stimulus` are tight and well-bounded. `load-interaction.ts` is the right single entry point for opening a session by id. The `SessionAdapter` + `AdapterRegistry` design is textbook.

**Drift:** Four top-level dirs — `projection/`, `promotion/`, `reflection/`, `knowledge/` — implement a self-contained "Exploration / knowledge-promotion" pipeline that's **not in CLAUDE.md** and has only two external callers (`@umwelten/sessions/introspect`, `@umwelten/cli/knowledge`). This is a feature surface masquerading as part of core. `persistence/` bundles two unrelated stores under one name (Claude-Code-specific session indexing + a generic `InteractionStore` whose `loadSession` doesn't persist metadata). `session-analyzer.ts` and `session-digester.ts` co-exist; the digester wraps the analyzer; CLAUDE.md's claim that "digests are the one source" is aspirational. `SessionSource` is declared twice (`normalized-types.ts` and `types/types.ts`).

### 2.3 Habitat (`packages/habitat/`) — **sprawling, four HTTP servers, two routing systems**

**The biggest concentration of drift.** ~20.5K LoC. Heavy hitters: `tools/gaia/gaia-tools.ts` (1347), `tools/agent-runner-tools.ts` (1183), `container-server.ts` (1128).

What's clean: `Habitat` factory + `ToolRegistry`, the `identity/` module, `ChannelBridge` as the unified chat plumbing, `serve.ts` as the single boot entry, and "Gaia = habitat + extra ToolSet" as a composition principle.

**Drift:**

- **Four HTTP servers**, three of which independently re-implement `parseRoute` / `matchRoute` / `serveStatic` / `sendJson`: `container-server.ts`, `web/server.ts`, `tools/gaia/routes.ts`. `mcp-local-server.ts` duplicates `registerAiTool` verbatim from container-server. `gaia-server.ts` is self-labeled legacy but still live on port 7421.
- **Two routing systems** for channel-→agent mapping: legacy `discord-routing.ts` + `discord-provision.ts` (the latter imports `discord.js` and arguably belongs in `@umwelten/ui/discord/`) vs modern `bridge/routing.ts`, which already reads the legacy file as fallback.
- **Two slash-command systems**: `slash-commands.ts` (CLI REPL) vs `bridge/commands.ts` (channel bridge), different lists, different consumers.
- **CLAUDE.md is wrong about `bridge/`**: it claims `bridge/diagnosis-agent.ts`, `bridge/monitor-agent.ts`, and `bridge_diagnose` / `bridge_monitor` tools exist. None do. The Tool Sets table mentions `bridge_*` tools that are only error strings now.
- **Implicit cross-cutting state**: `Habitat._currentSessionId` is accessed via `(habitat as any)._currentSessionId` casts.

### 2.4 Evaluation + Sessions + Protocols — **three eval systems, one is live**

**Evaluation — deeper look (post second-pass).** On closer inspection there are *three distinct evaluation systems* in the package, and only one is actively maintained:

- **System A — the CLI path** (`cli/eval.ts` → `api.ts:runEvaluation` → `Evaluation` → `EvaluationRunner` → `FunctionEvaluationRunner`). Output layout: `output/evaluations/<id>/responses/`. **Frozen since the monorepo split** (last meaningful commit on `cli/eval.ts` and `api.ts` is the extraction commit itself; no feature work since). Total: `cli/eval.ts` 871 LoC, `api.ts` 825, `base.ts` 76, `runner.ts` 31, `evaluate.ts` 42, `ui/EvaluationApp.tsx` 215 = **~2060 LoC of obsolete surface**.
- **System B — the strategy classes** (`SimpleEvaluation`, `MatrixEvaluation`, `BatchEvaluation`). Only `SimpleEvaluation` has any consumer (used by `EvalSuite` and the model-showdown examples). `MatrixEvaluation` (235 LoC) and `BatchEvaluation` (218 LoC) have **zero source consumers** — only their own tests. Last touched at extraction commit.
- **System C — `EvalSuite` + `llm-eval/`**. This is the live spine. `llm-eval/runFullEval(model, opts)` composes three sub-suites (language / coding / tool-calling), each an `EvalSuite`. Propagates `AbortSignal` down to the AI SDK call so a watchdog can actually cancel an HTTP request. Driven by `examples/local-providers/run-matrix.ts` through a 2-layer harness (eviction + preflight + AbortController watchdog). Commits like `9548bf9` (partial-response salvage + transcript replay), `93bb375` (watchdog + undici timeout), and the local-providers fleet are the recent activity.

**The CLI `eval` command is no longer the canonical eval path — the examples are.** `umwelten eval run/batch/report` still works (it's wired) but every feature added in the past six months has gone into `EvalSuite` / `llm-eval/` / `examples/local-providers`, not `api.ts`. The CLI path can be retired.

**Verified dead code (zero source consumers):**

- `evaluation/codebase/` — 4 files, ~1620 LoC. "LLM modifies real codebases" framework that never landed.
- `evaluation/analysis/result-analyzer.ts` — 262 LoC, only its own test.
- `evaluation/scorer.ts` — 23 LoC, no subclasses.
- `evaluation/strategies/matrix-evaluation.ts` — 235 LoC.
- `evaluation/strategies/batch-evaluation.ts` — 218 LoC.
- `evaluation/tool-testing/types.ts` — keep only `ToolTestResult` (used by reporter), drop the other ~180 LoC.
- `evaluation/introspection/browse.ts` shim — pure re-export of `@umwelten/sessions/introspection/browse.js`.
- `ui/EvaluationUI.tsx` — 183 LoC, superseded by `EvaluationApp.tsx`, no importers.

**If you commit to phasing out the CLI eval path** (which the activity log says you already have), an additional ~2200 LoC becomes deletable: `api.ts`, `base.ts`, `runner.ts`, `evaluate.ts`, `types/evaluation-types.ts`, `cli/eval.ts`, `ui/EvaluationApp.tsx`.

**Total removable**: ~4600 LoC of ~12,100 = **~38% reduction**. The package distills to one coherent stack: `EvalSuite` + `llm-eval/runFullEval` + `ranking/` + `combine/` + `Reporter`, driven by scripts in `examples/`.

CLAUDE.md says `reporting/` lives in `packages/core/src/reporting/` — **it doesn't**; it lives in evaluation.

**Sessions**: A small Commander-command package. CLAUDE.md says `src/introspection/` is in core — **it isn't**; it's here. `introspection/storage.ts` + `types.ts` still encode the old `IntrospectionRun` / `DecisionLogEntry` model that CLAUDE.md says is gone. `sessions.ts` is 3640 LoC of inline command bodies.

**Protocols**: Two MCP clients (legacy hand-rolled `mcp/client/client.ts` vs `mcp/client/remote.ts` using the official SDK), two MCP servers (legacy `mcp/server/server.ts` vs `mcp-serve/`), exported as peers. `habitat/mcp-local-server.ts` re-implements `mcp-serve/mcp-handler.ts` instead of consuming it (acknowledged TODO at `container-server.ts:555`). `a2a/chat.ts` isn't A2A protocol — it talks to habitat's `/api/chat` and is misplaced.

**Digest persistence duplicated three ways**: `sessions/introspection/browse.ts` (`getDigestPath`/`saveDigest`/`loadDigest`), `core/interaction/analysis/extraction-engine.ts` (`persistDigest`, with a comment acknowledging the duplication).

### 2.5 CLI + UI — **dead UIs, double Telegram, business logic in CLI**

**CLI**: 11 top-level commands, mostly clean Command-re-export pattern in `cli.ts`. But `commonOptions.ts` is used by only 4 of 11 (the others redefine their own `-p/-m`). `eval.ts` is 871 LoC mostly of input validation that belongs in evaluation. `habitat.ts` is 943 LoC including secrets-command logic. `knowledge.ts` is undocumented in CLAUDE.md.

**UI**: Two REPL frameworks coexist (`cli/CLIInterface.ts` used only by `umwelten chat`; `cli/repl.ts` used by habitat). `EvaluationUI.tsx` is dead (no importers; superseded by `EvaluationApp.tsx`). `ExploreBrowseApp.tsx` is superseded by `DashboardApp.tsx` but still exists. `DiscordAdapter.tsx` is 2083 LoC of god-component. `ui/index.ts` re-exports habitat internals, blurring the dep DAG.

**Cross-cutting**: Telegram has two entry points (`cli/telegram.ts` math demo vs `cli habitat telegram` habitat-aware) with overlapping intent. `cli → sessions → ui` is a runtime path that side-steps the documented `cli → ui` dependency.

### 2.6 Core support modules — **two undocumented, one stale dir, missing exports**

`context/`, `costs/`, `markdown/`, `rate-limit/` are clean leaf utilities. `schema/` is fine but has an empty stale `schema-temp/` dir.

**Drift:**

- **`session-record/` and `env/` are not in CLAUDE.md** but both are real, actively-used core modules. `session-record/` is the storage substrate for Habitat / Telegram / Discord transcript resume and learnings (extracted from habitat to break a `habitat ↔ ui` cycle — the layering implication: core knows about habitat-specific filesystem conventions). `env/` is the `dotenv` side-effect import that makes API keys work — every consumer of core benefits.
- `memory/` is **not exported from `index.ts`** and has zero callers outside its own tests. Either promote it or move to `examples/`.
- `rate-limit/` is **not in `index.ts`** but `evaluation/suite.ts` deep-imports `clearAllRateLimitStates`. Pick one.
- `memory/determine_operations.ts` has leftover `console.log` debug output.
- `markdown/from_html.ts` exports an unused `fromHtmlViaModel`.
- Two `streammark` ambient declarations (`types.d.ts` and `types/streammark.d.ts`) — pick one.

## 3. The drift catalog (consolidated)

Sorted by likely return-on-cleanup:

### High-value cleanups (small surface, big clarity win)

1. **Fix CLAUDE.md's location claims.** It's wrong about `reporting/` (says core, is evaluation), `introspection/` (says core, is sessions), and the `bridge/` module entirely. Two real modules (`session-record/`, `env/`) are missing. The `bridge_diagnose`/`bridge_monitor` tools it advertises don't exist.
2. **Delete dead code.** `evaluation/codebase/` (~50KB, no consumers), `evaluation/analysis/result-analyzer.ts`, `evaluation/scorer.ts`, `ui/EvaluationUI.tsx`, `ui/tui/introspect/ExploreBrowseApp.tsx`, `schema/schema-temp/` (empty), `markdown/fromHtmlViaModel`, `test-utils/load-env.ts` (no callers), the leftover `console.log` in `memory/determine_operations.ts`, the deprecated `RunnerModification` in `SmartModelRunner`.
3. **De-duplicate digest persistence.** Move `loadDigest`/`saveDigest`/`getDigestPath` into `core/interaction/analysis/` next to `session-digester.ts`; re-export from `@umwelten/sessions`. Drop `extraction-engine.ts`'s duplicate `persistDigest` (the comment already acknowledges the duplication).
4. **Resolve `SessionSource` double declaration** between `normalized-types.ts` and `types/types.ts`.
5. **Consolidate the two `streammark` ambient declarations.**

### Medium-value (structural, but contained)

6. **Extract `streamText`'s provider-specific usage cascade** from `runner.ts:408-546` into `usage-extractor.ts`. Drops runner LoC ~140 with no behavior change.
7. **Collapse `web/server.ts` into `container-server.ts`** (or vice versa) — extract a small `HttpAppShell` so all three habitat HTTP entry points reuse one router/static/CORS/sendJson implementation.
8. **Make `mcp-local-server.ts` a mode of `container-server.ts`** (or a thin wrapper around it) instead of a parallel implementation. Resolves the `container-server.ts:555` TODO.
9. **Sunset legacy MCP code** in `@umwelten/protocols/mcp/{client/client.ts,server/server.ts}`. The only live consumer is one debug subcommand in `cli/mcp.ts`.
10. **Split `gaia-tools.ts`** (1347 LoC) into `gaia-tools/{habitats,secrets,skills,standards,index}.ts`. Split `agent-runner-tools.ts` (1183 LoC) one tool per file.
11. **Pick one REPL framework**: keep `ui/cli/repl.ts` (habitat-aware), delete `ui/cli/CLIInterface.ts` (or rebuild `umwelten chat` on top of `repl.ts`). Pick one slash-command system in habitat: `bridge/commands.ts` is the modern one.
12. **Pick one Telegram entry point**: kill `cli/telegram.ts` (the math-demo) or merge it into `cli habitat telegram`.
13. **Move `discord-provision.ts` to `@umwelten/ui/discord/`** — it imports `discord.js`. Delete `discord-routing.ts` once `bridge/routing.ts` has fully absorbed it (already reads the legacy file as fallback).
14. **Move evaluation input validation** from `cli/eval.ts` into `@umwelten/evaluation`. CLI should parse and dispatch, not validate domain rules.
15. **Move `Stimulus` test from `interaction/stimulus.test.ts` → `stimulus/`** (stray after a refactor).

### Bigger / structural

16. **The Exploration / knowledge pipeline** (`interaction/{projection,promotion,reflection,knowledge}/`) should either be split into its own package (`@umwelten/knowledge` or merged into `@umwelten/sessions`) or documented in CLAUDE.md as a first-class subsystem. Right now it lives anonymously inside core. Same for `domain-types.ts` (Exploration / SourceSession types misplaced under `interaction/types/`).
17. **Decide analyzer vs digester**. If digester is canonical, deprecate `analyzeSessionWithRetry` from the public surface. Right now both exist and the digester wraps the analyzer.
18. **Fix the DAG seams**: stop `ui/index.ts` from re-exporting habitat internals (`startWebServer`, `ChannelBridge`, etc.); rethink the `cli → sessions → ui` runtime path.
19. **`session-record/` layering**: core knows habitat filesystem conventions. Long-term, either accept this as "core hosts the cross-cutting session substrate" (and document it) or hoist `session-record` to its own package and pull both habitat and core to depend on it.
20. **`Habitat._currentSessionId`** — make it explicit (thread through tool contexts, the way `getSessionId` is already a callback in some tools) or rename / document.

## 4. The "what's actually clean" inventory

Worth preserving and emulating:

- `Stimulus` + `Interaction` core API (data / state split, single-runner delegate).
- `BaseModelRunner` HARD RULE compliance, guarded by `request-options.test.ts`.
- `request-options.ts` and `provider-options.ts` — table-driven, well-commented.
- `SessionAdapter` + `AdapterRegistry` pattern.
- `load-interaction.ts` as the source-agnostic entry point.
- `stimulus/tools/agent-kit.ts` factory chain (path-sandbox → fs-tools → bash-tool → agent-kit).
- `stimulus/skills/` progressive-disclosure design.
- `Habitat.create()` 8-step init + `ToolRegistry` late-bound stimulus.
- `identity/` module — vault + manifest + skill-inspector + call-context.
- `ChannelBridge` as the unified chat plumbing for every UI adapter.
- `serve.ts` as the single boot entry for habitat HTTP.
- Gaia-as-habitat composition (habitat + one extra ToolSet).
- `a2a/server.ts` and `a2a/client.ts` — small, sharp, no habitat coupling.
- `mcp-serve/` — the modern OAuth-backed framework with clean `UpstreamOAuthProvider` / `McpToolRegistrar` / `McpServeStore` interfaces.
- `EvalSuite`, `combine/`, `ranking/` in evaluation.
- The CLAUDE.md HARD RULES section itself — the prose plus regression tests is exemplary architectural discipline.

## 5. Documentation strategy

CLAUDE.md is the canonical map. Three classes of correction needed:

### Reality fixes (CLAUDE.md is wrong)

- `reporting/` is in `@umwelten/evaluation`, not core.
- `introspection/` is in `@umwelten/sessions`, not core.
- The `bridge/` description should list `channel-bridge.ts`, `commands.ts`, `routing.ts` — not `diagnosis-agent.ts` / `monitor-agent.ts`.
- The Tool Sets table should drop `bridge_diagnose` / `bridge_monitor` / `bridge_*` references.
- The user memory note that "File/time/URL tools are NOT in standardToolSets" contradicts `tool-sets.ts` — code is the truth.

### Additions (real modules absent from CLAUDE.md)

- **`src/session-record/`** — the storage substrate (transcripts, learnings, compaction events). Heavily used by habitat, Discord, Telegram, the digester.
- **`src/env/`** — the `dotenv` side-effect import.
- **`cli/knowledge.ts`** — the Exploration / knowledge-promotion command.
- **The Exploration pipeline** (`interaction/{projection,promotion,reflection,knowledge}/`) — if it's staying in core, document it as a first-class subsystem.

### Aspirational claims to remove or align

- "Digests are the one source of session analysis" — both the analyzer and digester are live; either align the code or soften the claim.
- "There is no longer a separate introspection LLM pipeline" — `IntrospectionRun` / `DecisionLogEntry` data model still lives in `sessions/src/introspection/storage.ts` and is read by `buildBrowse()`.

## 6. Cleanup progress & next passes

### Done

**Wave A — Evaluation package overhaul** (4 commits, ~−6800 LoC):

- `045c89d` — Delete verified dead code: `evaluation/codebase/` (~1620 LoC, never-landed), `analysis/result-analyzer`, `scorer.ts`, `strategies/matrix-evaluation`, `strategies/batch-evaluation`, `introspection/browse.ts` shim, `ui/EvaluationUI.tsx`.
- `f7c6ed3` — Remove obsolete CLI eval path: `cli/eval.ts`, `evaluation/api.ts`, `Evaluation` hierarchy, `evaluation-types.ts`, `ui/EvaluationApp.tsx`.
- `056c2e6` — Fix unresolved imports (caught by knip): inline types in `ranking/types.ts` and `strategies/simple-evaluation.ts`.
- `d74fc26` — Move digest persistence into core; break ui↔sessions cycle.

Evaluation package shrank from ~12,100 LoC to ~8K. Single coherent stack: `EvalSuite` + `llm-eval/runFullEval` + `ranking/` + `combine/` + `Reporter`, driven by scripts in `examples/`.

**Wave B — Mechanical sweep** (7 commits, −87 LoC + behavior fixes):

- `7bb2e53` — Delete `fromHtmlViaModel` (orphan LLM HTML→md converter).
- `3088ccf` — Strip debug `console.log`s + unused `zodToJsonSchema` from `memory/determine_operations.ts`.
- `9a66ab7` — Delete deprecated `RunnerModification` from `SmartModelRunner`.
- `32372e4` — Delete orphan `test-utils/load-env.ts`.
- `4dbd7cb` — Drop misleading-shape `streammark` shim.
- `dae6a28` — **Stop stripping non-ASCII from reasoning deltas** (was silently dropping Qwen/GLM/DeepSeek/nemotron non-Latin reasoning).
- `ab1bd8c` — Unify `SessionSource`; drop `SessionSourceForEntry` duplicate.

Tests: 1183 → 1182 (the one removed test was for `RunnerModification`).

**Wave C — Documentation sync** (7 commits, CLAUDE.md only, +193 / −96 lines):

- `19f1ffe` — Package map + DAG: drop dead `@umwelten/server` (renamed in 8f44b16), add `@umwelten/sessions` + `@umwelten/protocols`, flag the two DAG seams.
- `4aad868` — Retire `umwelten eval` CLI references; rewrite the evaluation section around `EvalSuite` + `llm-eval/runFullEval`.
- `489ef79` — Rewrite `bridge/` section (the `diagnosis-agent.ts` and `monitor-agent.ts` it claimed never existed); drop dead `bridge_*` tools from the Tool Sets table.
- `e1950b5` — Fix module locations: `mcp/` → `@umwelten/protocols`, `introspection/` → `@umwelten/sessions` + `@umwelten/core`, `reporting/` → `@umwelten/evaluation`.
- `0afc30e` — Add `CONTEXT.md` pointer, `src/session-record/`, `src/env/`, the Exploration pipeline, and three missing providers (`minimax`, `nvidia`, `fireworks`).
- `a744ba5` — Fix CLI command list (no more `eval`; add `knowledge`/`browse`/`introspect`), correct the `Interaction` usage example (no `.chat()` method), update `ui/` inventory.
- `b87ea22` — Mop-up: two leftover `@umwelten/server` references inside the habitat section.

CLAUDE.md: 507 → 604 lines. Grep-verified no remaining references to deleted symbols.

**Wave D — Cognition extractions** (2 commits, `runner.ts` 870 → 732 LoC):

- `a64a5de` — Extract `extractStreamUsage(response, initialUsage, provider)` from `runner.ts:402-551` into `usage-extractor.ts`. Provider-specific cascade (Ollama / OpenRouter / MiniMax / Google / GitHub Models) now lives next to `normalizeTokenUsage` and `calculateCostBreakdown`. Verified with unit tests + knip + a real `gemini-3-flash-preview` smoke test (`--debug-usage` confirmed all five token keys flowed through cleanly).
- `c473719` — Sync `ModelResponseSchema` with the `ModelResponse` TS type. Adds `messages: z.array(z.unknown()).optional()` to the schema; collapses the type-side intersection so the schema is the single source of truth.

Still on the cognition wish-list (not done this pass): `ModelRunner<I = Interaction>` generic so `interaction: any` can drop the cast.

### Next

**Wave E — UI/habitat "pick one"** (~half day each):

- One REPL framework (keep `ui/cli/repl.ts`, delete `CLIInterface.ts`).
- One Telegram entry (`cli/telegram.ts` vs `cli habitat telegram`).
- One channel-routing system (`bridge/routing.ts` is the modern; delete legacy `discord-routing.ts`; move `discord-provision.ts` to `@umwelten/ui/discord/`).
- One slash-command system (`bridge/commands.ts` vs `slash-commands.ts`).

**Wave F — HTTP server consolidation** (2-3 days):

- Extract `HttpAppShell` from `container-server.ts`.
- Migrate `web/server.ts`, `tools/gaia/routes.ts`, `mcp-local-server.ts` onto it.
- Make `mcp-local-server` a mode of `container-server` (resolves `container-server.ts:555` TODO).
- Sunset legacy MCP code in `protocols/mcp/{client,server}/`.
- Caveat: `docs/architecture/electron-shell.md` is a planned desktop shell wrapping `container-server` — preserve its surface.

**Wave G — Big files** (1-2 days, mechanical):

- Split `tools/gaia/gaia-tools.ts` (1347 LoC) by domain.
- Split `tools/agent-runner-tools.ts` (1183 LoC) one tool per file.
- Split `packages/sessions/src/sessions.ts` (3640 LoC) by subcommand.
- `DiscordAdapter.tsx` (2083 LoC) — finish moving ambient-gate/backfill out (siblings already started).

**Wave H — Structural decisions** (discussion first, then 1 week+):

- Exploration / knowledge pipeline location (split out vs document as core subsystem).
- Analyzer vs digester (deprecate analyzer or soften CLAUDE.md's claim).
- `session-record/` layering (stay in core with documentation, or hoist to own package).
- `Habitat._currentSessionId` cast-based state (thread explicitly or rename + document).
- DAG seams (`ui/index.ts` re-exporting habitat; `cli → sessions → ui` runtime path).

**Recommended next step**: Wave E (UI/habitat "pick one" decisions). Each is bite-sized, contained, and reversible — half-a-day-each work. Concretely: pick the REPL framework (`ui/cli/repl.ts` over `CLIInterface.ts`), pick the Telegram entry (`cli habitat telegram` over `cli/telegram.ts` math-demo), or finish the channel-routing migration. Wave F (HTTP server consolidation) is the bigger structural win after that.
