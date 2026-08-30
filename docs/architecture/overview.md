# Architecture Overview

Umwelten models an agent's **perceptual and operational world**. A `Stimulus`
defines what a model is asked to perceive and which actions it can take; an
`Interaction` carries the continuing model context; a `Habitat` adds durable
state, tools, skills, identities, channels, and other agents.

The architecture has roughly nine substantial systems:

1. core cognition and Interaction;
2. the Habitat agent runtime;
3. Gaia fleet orchestration;
4. the external Habitats SaaS and its local integration boundary;
5. Substrate, Shell, and Component composition;
6. A2A and MCP protocols;
7. Source Sessions, Explorations, Reflection, and knowledge;
8. evaluation and reporting;
9. the Mycel/Supplier Exchange ecosystem.

CLI/UI adapters, examples, and documentation cut across these systems.

Those nine systems occupy **two bounded domain contexts**—Umwelten and the
Exchange. “Two” describes vocabulary and dependency boundaries, not the number
of products or architectural subsystems.

Read [CONTEXT.md](../../CONTEXT.md) for canonical terminology and
[CONTEXT-MAP.md](../../CONTEXT-MAP.md) for the bounded-context rules.

## Runtime shape

```text
Interfaces (CLI · web · Discord · Telegram · A2A)
                         │
                         ▼
                    ChannelBridge
                         │
                route · session · agent
                         │
                         ▼
            Interaction + Stimulus + tools
                         │
               model runner / native runtime
                         │
                         ▼
                      Provider

Gaia (a Habitat) ──provisions/wakes/reaps──▶ managed Habitats

Application ──OpenAI-compatible HTTP──▶ Mycel ──dispatch──▶ Supplier
```

`packages/habitat/src/container-server.ts` projects one Habitat through
`/a2a`, `/mcp`, `/api/chat`, and `/shell`. Gaia composes the same Habitat with
fleet capabilities; it is not a second agent framework. The production
Habitats SaaS is external to this repository—this repo contains integration
contracts and clients, not its main frontend/backend.

## Package layers

| Layer | Packages |
| --- | --- |
| Foundation | `@umwelten/substrate`, `@umwelten/core` |
| Protocol/runtime | `@umwelten/protocols`, `@umwelten/habitat` |
| Application surfaces | `@umwelten/sessions`, `@umwelten/ui`, `@umwelten/evaluation` |
| Exchange context | `@umwelten/mycel`, `@umwelten/supplier` |
| Composition/publication | `@umwelten/cli`, bundled `umwelten` meta-package |

The intended direction is foundations → feature packages → CLI/public bundle.
The current `sessions ↔ ui` import cycle is a known boundary violation.

## Composition architecture

The newer extension model uses domain terms from ADRs 0031–0033:

- **Substrate** — the shared reversible lifecycle runtime.
- **Component** — performs reversible effects and declares required Services.
- **Service** — a named binding a Component provides or consumes.
- **Shell** — minimal page hosting Components.
- **UI Resource** — a Component or one-shot view projected over MCP/A2A.
- **Foreign component** — another Habitat's projection behind an iframe trust
  boundary.

The browser Shell, Gaia fleet composition, Mycel client surface, persistent
`ui://shell/...` resources, and agent-authored Components are implemented.
Habitat internals such as ToolSets, runtime runners, connectors, and skills
still use specialized registries; server-side Substrate adoption is partial.

## Durable records

- **Interaction** — model-facing context.
- **Source Session** — persisted tool/runtime conversation artifact.
- **Exploration** — related line of inquiry across Source Sessions.
- **Task** — Habitat-owned invocation lifecycle, projected over A2A today.
- **Run** — SaaS-owned cost/attribution record.

These records should be correlated, not collapsed into one type.

## Current review

See the [August 2026 system map](./system-map-2026-08.md) for:

- exact package and runtime ownership;
- Gaia, SaaS, Mycel, and Supplier boundaries;
- old/new and deliberate parallel paths;
- plugin/Component implementation status;
- examples and reporting gaps;
- risk-ranked cleanup recommendations.

Use [System boundaries and working conventions](./system-boundaries.md) as the
short core/auxiliary map and default-pattern checklist for each of the nine
systems.

The [May 2026 map](./system-map-2026-05.md) is retained as cleanup history.
