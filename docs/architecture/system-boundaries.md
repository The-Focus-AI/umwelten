# System Boundaries and Working Conventions

This page answers two practical questions for each architectural system:

1. What is the load-bearing core, and what is auxiliary or transitional?
2. Which pattern should new code and examples copy?

“Core” means the supported ownership path, not necessarily a low-level package.
“Auxiliary” means useful adapters, tooling, or research around that path.
“Transitional” means a compatibility seam that should not seed new designs.

## Boundary map

| System | Core | Auxiliary | Transitional / avoid for new work | Working convention | Canonical example | Example gap |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Cognition and Interaction | `Stimulus`, `Interaction`, model runners/providers in `@umwelten/core` | cost tables, compaction, provider diagnostics | old static helpers and historical `Interaction.chat()` snippets | Keep provider details behind runners; keep the perceptual contract in `Stimulus`; use one continuing `Interaction` per model context | `examples/simple-agent`, `examples/provider-comparison` | A minimal tested package-consumer example |
| 2. Habitat runtime | `Habitat.create()`, `ChannelBridge`, runtime runners, unified container server | channel adapters, work-directory discovery, artifacts | legacy Discord routing and non-Habitat REPL | Construct through `Habitat`; route interfaces through `ChannelBridge`; expose network surfaces through `startContainerServer()` | `examples/habitat-minimal`, `examples/umwelten-web-demo` | One tested lifecycle example covering sessions, tools, and shutdown |
| 3. Gaia orchestration | `Gaia.start()`, registry/vault, canonical `startHabitatContainer()` lifecycle | fleet UI, wake/reap policies, Docker diagnostics | REST start/rebuild's duplicated start sequence | Every interface must call the same lifecycle service; Gaia adds fleet capabilities to a normal Habitat rather than defining another agent runtime | Gaia implementation in `packages/habitat` | No canonical provision → wake → interact → reap example |
| 4. Habitats SaaS boundary | JWT/JWKS, registry announcement, room history, storage-token, A2A and Shell integration contracts | local mocks and deployment wiring | shared Habitat API key | Keep SaaS records (`Run`, identity, rooms) external and correlate them with local `Task`/session IDs; do not recreate the SaaS domain in this repo | Web demo exercises part of the boundary | No contract-test fixture showing SaaS ↔ Gaia ↔ Habitat |
| 5. Substrate, Shell, Components | `@umwelten/substrate` lifecycle, Services, Components, Shell, UI Resources | loaders, authored work-directory components, Foreign components | static Gaia UI and specialized registries pretending to be Components | Components own reversible registration/teardown; dependencies are named Services; Shell stays a minimal host | Shell assemblies in Habitat/Mycel | No small authored Component tutorial or Foreign-component security example |
| 6. A2A and MCP | `@umwelten/protocols` clients/servers plus Habitat projections | OAuth deployment adapters and hosted MCP examples | hand-rolled `MCPClient`; duplicate local server assembly | Keep protocol DTOs and transport here; adapt them to Habitat domain records at the boundary | `examples/agent-browser`, `examples/oura-mcp` | No single local example exposing and consuming both A2A and MCP |
| 7. Sessions, Explorations, Reflection, knowledge | Source Session adapters/records in core; browse/digest commands in sessions; Reflection/promotion primitives | TUI browse/search views and import adapters | session-first UI DTOs; `sessions ↔ ui` dependency cycle | Preserve `Interaction`, Source Session, Exploration, Task, and Run as distinct correlated records; dependencies point from UI to application services, never back | `examples/context-explorer`, `examples/dialogue-debate` | No end-to-end source session → exploration → reflection → promoted knowledge example |
| 8. Evaluation and reporting | `eval run` for ad-hoc comparisons; `EvalSuite`; standard `runFullEval`; ranking; combine/report APIs | local-provider harness, Dagger/container experiments, one-off benchmark scripts | removed `EvaluationRunner`, `MatrixEvaluation`, `BatchEvaluation`, and old report/combine CLI docs | Use CLI for exploration; put repeatable methodology in executable suites; prefer deterministic verification; generate reports from scripts | `examples/evals`, `examples/model-showdown` | `runFullEval` has contract tests but no provider-backed CI fixture |
| 9. Mycel / Supplier Exchange | Exchange dispatch/metering/balances in `@umwelten/mycel`; discovery/probe/publish/serve in `@umwelten/supplier` | diagnostics and deployment adapters | importing Exchange internals into Umwelten domain packages | Cross the bounded-context boundary over OpenAI-compatible HTTP; meter only observable traffic; keep offers and application demand explicit | `examples/supplier-agent`, `examples/mycel-metering`, `examples/mycel-e2e` | Existing examples are strongest here; deployment failure-mode coverage remains limited |

## Cross-system rules

These rules make ownership visible even before package exports are tightened:

1. **Import from package roots for supported APIs.** A deep import identifies an
   internal or experimental dependency and needs a reason.
2. **One composition root per process.** CLI, Habitat container, Gaia, and Mycel
   may assemble systems; domain packages should not assemble applications.
3. **One lifecycle path per resource.** HTTP, tools, and scheduled operations
   call the same start/stop implementation.
4. **Keep records distinct and correlated.** Do not solve navigation by merging
   `Interaction`, Source Session, Exploration, Task, and Run.
5. **Examples are executable contracts.** Each core system should have one
   minimal example, one realistic composition, and at least a typecheck or
   smoke test.
6. **Research is labeled, not hidden.** Experimental harnesses can live beside
   supported code when their README names assumptions and they are not exported
   as the default API.

## Cleanup sequence

1. Fix correctness boundaries: unified Gaia lifecycle and Foreign-component
   origin enforcement.
2. Break the `sessions ↔ ui` cycle and narrow wildcard package exports.
3. Finish the evaluation documentation/API cleanup and gate its canonical
   examples.
4. Add the missing lifecycle examples above, beginning with Habitat/Gaia and
   session-to-knowledge flow.
5. Only then consolidate extension registries behind Component adapters; do
   not rename distinct Skill, Tool, Runtime, and Component concepts into one.

See the [current system map](./system-map-2026-08.md) for detailed evidence and
the [examples index](../examples/index.md) for support levels.
