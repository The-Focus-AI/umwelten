# Umwelten System Map — August 2026

Current-state architecture review as of 2026-08-29. This is a map of the code
that exists, not a promise that every accepted ADR is complete. The earlier
[May 2026 system map](./system-map-2026-05.md) remains useful as cleanup
history, but predates Mycel, Supplier, the Substrate, and the present Gaia/SaaS
boundary.

## Executive map

There are roughly **nine architectural systems** in and around this repository:

1. **Core cognition and Interaction** — Stimulus, model context, runners,
   providers, costs, and compaction.
2. **Habitat** — the executable agent environment: tools, skills, agents,
   sessions, secrets, runtimes, and channels.
3. **Gaia** — fleet provisioning, registry, vaults, Docker lifecycle,
   wake/reap, routing, and operations.
4. **Habitats SaaS** — the external product/control plane for identity, Runs,
   rooms, registry, and fleet UI. This repo implements its contracts and
   runtime clients, not the SaaS application itself.
5. **Substrate and Shell** — the new Component/Service composition runtime,
   self-authored interfaces, UI Resources, and Foreign components.
6. **Protocols** — A2A and MCP transport, task projection, OAuth, clients, and
   servers.
7. **Sessions, Explorations, and knowledge** — Source Session adapters,
   browsing, search, digestion, Reflection, fan-out, and promotion.
8. **Evaluation and reporting** — `EvalSuite`, ranking, aggregation, benchmark
   reports, and research harnesses.
9. **Exchange ecosystem** — Mycel dispatch/metering/balances plus the Supplier
   agent and connected model capacity.

CLI, Discord, Telegram, web adapters, examples, and documentation are
cross-cutting interfaces into those systems rather than a tenth domain.

Separately, the repository defines **two bounded domain contexts**. That is a
vocabulary/dependency statement, not a system count:

- **Umwelten** contains systems 1–8 and gives agents perceptual and operational
  worlds.
- **The Exchange**, deployed as **Mycel**, is system 9 and buys model capacity
  from `Supplier`s for applications. It shares identity and HTTP integration
  with Umwelten, but not its domain model. See
  [CONTEXT-MAP.md](../../CONTEXT-MAP.md).

```text
                              external Habitats SaaS
                       identity · Runs · rooms · fleet UI
                                     │
                     registry/JWT/A2A│(contracts live here;
                                     │ app does not)
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Gaia — an ordinary Habitat with fleet tools                          │
│ registry · vaults · provisioning · Docker · wake/reap · proxy        │
└───────────────────────┬──────────────────────────────────────────────┘
                        │ creates and operates
                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Habitat                                                              │
│ Shell / web / Discord / Telegram / CLI                               │
│                  │                                                   │
│             ChannelBridge                                            │
│                  │                                                   │
│       Interaction + Stimulus + tools ────────────┐                    │
│                  │                               │                    │
│          model runner or                         │                    │
│          native runtime                          │                    │
│                  │                               │                    │
│                  ▼                               ▼                    │
│              Provider                    Source Sessions / Tasks      │
│                                                                      │
│ Network projections: /a2a · /mcp · /api/chat · /shell               │
└──────────────────────────────────────────────────────────────────────┘
                  │ optional model-provider HTTP
                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Mycel (the Exchange)                                                  │
│ Applications → dispatch → connected Supplier → upstream model        │
│                 metering · charges · settlement                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Ecological model

The biological idea of an *Umwelt* is not decorative naming. An organism does
not receive an objective world; it receives a world filtered through its
senses and action possibilities. The code models the same separation:

| Ecological idea | Code-level expression |
| --- | --- |
| Perceptual frame | `Stimulus`: role, instructions, tools, model options |
| Continuing organism/world exchange | `Interaction`: messages plus model execution |
| Local environment and affordances | `Habitat`: work directory, tools, skills, agents, secrets, sessions |
| Persisted observation | `Source Session` |
| Related lines of inquiry | `Exploration` |
| Self-observation | digests, `Reflection`, fan-out `Probe`s, promotion into durable knowledge |
| Organism community | Gaia's fleet and Habitat-to-Habitat A2A calls |
| Resource exchange network | Mycel and Supplier |
| Dynamic ecological composition | Substrate `Component`s providing and consuming `Service`s |

The glossary and invariants are in [CONTEXT.md](../../CONTEXT.md). In
particular, `Interaction`, `Source Session`, `Exploration`, `Task`, and SaaS
`Run` are related records, not synonyms.

## Package ownership

There are eleven package directories:

| Package | Owns |
| --- | --- |
| `@umwelten/substrate` | Zero-dependency composition runtime: contexts, reversible effects, Services, Components, isolation, loader, Shell serving |
| `@umwelten/core` | Stimulus, Interaction, model runners/providers, costs, context/compaction, Source Session adapters and records, reflection/promotion/knowledge primitives |
| `@umwelten/protocols` | MCP and A2A clients, servers, OAuth support, protocol task storage |
| `@umwelten/habitat` | Agent environment, tools, sessions, runtime runners, ChannelBridge, unified container server, Shell, Gaia |
| `@umwelten/sessions` | Session/search/browse/digest application commands |
| `@umwelten/ui` | CLI interface, Ink TUI, Discord, and Telegram adapters |
| `@umwelten/evaluation` | `EvalSuite`, ranking, suite aggregation, and evaluation report rendering |
| `@umwelten/mycel` | Exchange HTTP service, dispatch, metering, balances, and hosted client surface |
| `@umwelten/supplier` | Supplier discovery, probing, publishing, and serving |
| `@umwelten/cli` | Commander composition root |
| `umwelten` | Published compatibility/meta-package bundling the internal packages |

The intended dependency shape is foundation-first:

```text
substrate ──▶ habitat, mycel
core ───────▶ protocols, habitat, sessions, ui, evaluation, supplier
protocols ──▶ habitat
habitat ────▶ ui
feature packages ──▶ cli ──▶ published umwelten bundle
```

One current violation is the `sessions ↔ ui` cycle: sessions commands lazy-load
TUI implementations from `@umwelten/ui`, while
`packages/ui/src/tui/introspect/browse.tsx` imports an application builder from
`@umwelten/sessions`. Wildcard deep exports in most package manifests make
other ownership leaks possible even where no cycle exists.

## Principal runtime paths

### Direct model interaction

```text
CLI/example
  → Stimulus + Interaction
  → BaseModelRunner
  → provider adapter
  → Vercel AI SDK/provider API
  → ModelResponse with usage/cost metadata
```

The load-bearing code is in `packages/core/src/{stimulus,interaction,cognition,providers}`.
This is the smallest toolkit layer and does not require a Habitat.

### Habitat interaction

```text
CLI / web / Discord / Telegram / A2A
  → ChannelBridge.handleMessage()
  → channel route and Source Session
  → main agent or managed HabitatAgent
  → Interaction, Claude SDK, pi, or configured CLI runtime
  → streamed response + transcript persistence
```

`Habitat.create()` assembles config, secrets, tool sets, work-directory tools,
skills, agents, and session storage. `startContainerServer()` exposes one
runtime over `/mcp`, `/a2a`, `/api/chat`, `/shell`, files, sessions, and
artifacts. `Task` lifecycle is durable on the A2A path; the accepted MCP Tasks
projection is not yet implemented.

### Gaia and managed Habitats

Gaia is composition, not a separate agent framework. `Gaia.start()` creates a
normal Habitat and adds registry, vault, Docker, credential, wake/reap, proxy,
and fleet tools. Managed containers provision `/data`, then run
`umwelten habitat serve`.

The canonical lifecycle function is `startHabitatContainer()` in
`packages/habitat/src/tools/gaia/gaia-tools/habitats.ts`. Wake and AI-tool
starts use it. The REST start/rebuild routes still duplicate a smaller start
sequence, so different interfaces can currently inject different credentials
and side effects.

The production SaaS is **outside this repository**. This repo contains its
integration contracts: registry announcement, JWT/JWKS verification, room
history, storage-token relay, A2A, and Shell/resource projection. It does not
contain the production workspace UI, Clerk integration, Run store, registry
receiver, or primary frontend.

### Mycel and Supplier

Mycel is a separate bounded context and remains one-way from Umwelten over
HTTP. Applications request a model/capability envelope; the Exchange filters
eligible offers, dispatches to a connected Supplier, measures what crossed its
own boundary, records charges/costs, and returns an OpenAI-compatible response.
`@umwelten/core` can address Mycel as a provider but must not import Exchange
implementation code.

## Composition and “plugins”

The new architectural term is **Component**, not plugin. A Component performs
reversible effects on the **Substrate**, declares the **Services** it needs,
and activates only while those Services exist. The **Shell** is a minimal host
that loads Components. A persistent Component can project over MCP as a
`ui://shell/...` **UI Resource**; a **Foreign component** mounts that projection
behind an iframe.

Implemented now:

- context/effect lifecycle, Services, isolation, Component fibers, and loader;
- Habitat and Mycel Shell assemblies;
- agent-authored work-directory Components;
- persistent Shell resource publication and Gaia peer mounting;
- a Substrate-backed atomic swap for work-directory tools.

Still separate extension systems:

- Habitat `ToolSet`s and the runtime `ToolRegistry`;
- `TOOL.md` handlers;
- `SKILL.md` discovery and `SkillsRegistry`;
- `RuntimeRunner`s (base, Claude SDK, pi, configured CLIs);
- connectors and public MCP-agent manifests.

These are not all accidental duplicates. A Skill and a Tool are different
domain objects. The useful migration is to make Components own their
registration and teardown through adapters, not rename every extension object
to Component.

## Old, new, and deliberate parallel paths

| Area | Older path | Current direction | Assessment |
| --- | --- | --- | --- |
| Architecture map | May system map and `docs/architecture/overview.md` | This map + current glossary | Older docs describe valuable history but not current topology |
| UI composition | static/legacy Gaia UI | shared Substrate Shell + Components | Migration active; legacy Gaia chat/UI still has callers |
| MCP client | hand-rolled `MCPClient` | official SDK `RemoteMcpClient` | Compatibility debt; publish a deprecation/removal boundary |
| MCP serving | local Habitat MCP server | unified container server; hosted OAuth MCP is separate | Some legitimate deployment differences, plus duplicated local assembly |
| Session browser | session-first DTOs | Exploration-first domain model | Intentional migration seam |
| Channel routing | legacy `discord.json` | `routing.json` and `ChannelBridge` | Fallback remains for migration |
| REPL | non-Habitat `CLIInterface` | Habitat-aware `runRepl` | Deliberate parallel contracts |
| Evaluation | removed monolithic CLI stack | thin `eval run` + `EvalSuite` + script-driven reporting | Ad-hoc comparison is restored without reviving obsolete runner/report commands |
| Public package | internal workspace packages | bundled `umwelten` facade | Deliberate compatibility architecture |

## Highest-value gaps

### Correctness and security

1. **Unify Gaia lifecycle entry points.** REST start/rebuild bypass the canonical
   vault, required-secret, model-credential, activity, and SaaS-announcement
   path.
2. **Enforce the Foreign component origin boundary.** The iframe enables both
   `allow-scripts` and `allow-same-origin` but code only assumes that the
   projection URL is cross-origin. Reject same-origin/non-HTTP projections and
   test redirects.
3. **Retire shared bearer authority.** Per-user audience-bound JWTs are the
   intended identity path; the transitional Habitat API key still collapses
   attribution and is sent to the SaaS registry.
4. **Make invocation correlation explicit.** `Task`, SaaS `Run`, and Source
   Session are intentionally separate, but no durable local envelope ties
   `runId`, `taskId`, `contextId`, `sessionId`, habitat, user, and channel
   together.
5. **Make registry synchronization durable.** Gaia announcement is best-effort
   on start and has no outbox/reconciliation loop.

### Boundaries and maintainability

6. Break the `sessions ↔ ui` cycle and make package manifests match source
   imports.
7. Replace wildcard deep exports with explicit supported subpaths over time.
8. Correct `Loader.apply()` or its transactional claim: changed entries retire
   the old fiber before importing the replacement; only `reload()` preserves
   the old fiber on import failure.
9. Define one internal UI Resource projection model. One-shot mcp-ui resources
   and persistent Shell projections currently use parallel representations.
10. Finish or clearly bound the legacy MCP, Gaia UI, session DTO, and routing
    migrations.

### Product learning, examples, and reports

11. Classify examples as canonical, supported, experimental, prototype, or
    fixture, then add canonical examples to typecheck/smoke gates.
12. Add an end-to-end Gaia example covering create → start → call → Task poll
    → Source Session → dormancy/wake, with identity and correlation visible.
13. Add a SaaS-contract example without pretending the SaaS is local: JWT
    issuance/verification, registry receiver stub, A2A call, and polling.
14. Keep four report concepts distinct:
    - evaluation reports (`@umwelten/evaluation`),
    - reflected knowledge Artifacts (`.umwelten/artifacts/`),
    - runtime Habitat artifacts,
    - dated architecture/research reviews (`reports/` and `docs/architecture/`).
15. Add a deterministic architecture-review command later. It should inventory
    packages, exports/imports, examples, docs links, accepted ADR status, and
    the previous snapshot, then write Markdown plus a machine-readable sidecar.
    It should not reuse evaluation leaderboard types.

## Recommended cleanup sequence

1. **Truthful map and docs:** package map, examples matrix, report guide, ADR
   implementation notes. Low runtime risk and immediately improves future work.
2. **Boundary fixes:** Gaia canonical start path and Foreign origin validation,
   each with focused tests.
3. **Dependency hygiene:** break `sessions ↔ ui`, correct manifests, then narrow
   exports without a big-bang public API change.
4. **Complete migrations:** MCP client, Gaia legacy UI/chat, session-first DTOs,
   and legacy routing, one independently verified slice at a time.
5. **Substrate adoption:** create one server-side Substrate root per Habitat and
   wrap existing registries with lifecycle adapters before deleting them.
6. **Review toolkit:** automate inventories and drift checks; schedule it in the
   deployment/workspace that owns cadence, not inside the evaluation framework.

## What should be preserved

- Stimulus / Interaction / ModelRunner separation.
- Gaia as a Habitat with additional capabilities.
- Task, Run, and Source Session as correlated—not collapsed—records.
- Mycel as a separate bounded context with a one-way HTTP boundary.
- Substrate's small zero-dependency lifecycle core.
- `ChannelBridge` as the common channel/session/runtime path.
- Script-driven `EvalSuite` examples and report builders.
- Human-readable project-local knowledge under `.umwelten/`.

This review intentionally does not label every parallel implementation as
duplication. Cleanup should remove competing ownership, not legitimate
differences in trust boundary, protocol generation, or Habitat dependency.
