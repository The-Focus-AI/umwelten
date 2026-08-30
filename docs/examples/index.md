# Examples

The repository examples have different support levels. “Present under
`examples/`” does not mean “canonical” or “CI-gated.” Start with a canonical
example, then use a supported specialized example when its architecture fits.

Run commands from the repository root after `pnpm install`; use
`dotenvx run --` for examples that need provider credentials.

## Canonical starting points

| Example | Use it for | Automated check |
| --- | --- | --- |
| [`habitat-minimal`](https://github.com/The-Focus-AI/umwelten/tree/main/examples/habitat-minimal) | Smallest Habitat work-directory layout | Manual |
| [`umwelten-web-demo`](https://github.com/The-Focus-AI/umwelten/tree/main/examples/umwelten-web-demo) | Reference `useChat` frontend, Habitat HTTP API, tool cards, generative UI | Own Vite build |
| [`model-showdown`](https://github.com/The-Focus-AI/umwelten/tree/main/examples/model-showdown) | Multi-dimension `EvalSuite`, cached aggregation, structured and narrative reports | Report/config typechecked |
| [`supplier-agent`](https://github.com/The-Focus-AI/umwelten/tree/main/examples/supplier-agent) | Supplier discover → probe → publish → serve workflow | Root lint + typecheck |
| [`mycel-metering`](https://github.com/The-Focus-AI/umwelten/tree/main/examples/mycel-metering) / [`mycel-e2e`](https://github.com/The-Focus-AI/umwelten/tree/main/examples/mycel-e2e) | Exchange metering and end-to-end dispatch | Root lint + typecheck |

```bash
# Minimal evaluation scripts
dotenvx run -- pnpm tsx examples/evals/car-wash.ts
dotenvx run -- pnpm tsx examples/evals/instruction.ts
dotenvx run -- pnpm tsx examples/evals/reasoning.ts

# Web reference
mise run web-demo
mise run web-demo-client

# Combined evaluation report from cached results
pnpm tsx examples/model-showdown/generate-report.ts --format md \
  --output output/model-showdown-results.md
```

Use `umwelten eval run` for ad-hoc prompt comparisons. Evaluation suites and
reports remain script-driven so scoring and methodology stay explicit.

## Coverage by architectural system

The examples directory does **not** yet mirror the architecture evenly:

| System | Current coverage | Missing canonical coverage |
| --- | --- | --- |
| Cognition / Interaction | `simple-agent`, `provider-comparison` | tested minimal consumer |
| Habitat | `habitat-minimal`, `umwelten-web-demo`, channel examples | full lifecycle smoke test |
| Gaia | legacy `gaia-ui`; implementation examples only | provision → wake → interact → reap |
| Habitats SaaS boundary | partial web and runtime clients | contract fixture for SaaS/Gaia/Habitat |
| Substrate / Components | package-level implementations | authored Component and Foreign-component tutorial |
| A2A / MCP | `agent-browser`, OAuth MCP examples | one local producer-and-consumer example |
| Sessions / knowledge | context and dialogue examples | Source Session → Exploration → Reflection → knowledge |
| Evaluation / reporting | `evals`, `model-showdown`, `local-providers` | provider-independent composition smoke test |
| Mycel / Supplier | `supplier-agent`, `mycel-metering`, `mycel-e2e` | mostly covered |

New examples should fill a missing row rather than adding another variation of
an already covered happy path. See the [system boundary map](/architecture/system-boundaries)
for the API and lifecycle convention each example should demonstrate.

## Supported specialized examples

| Area | Examples |
| --- | --- |
| Habitat configuration and channels | `basic-agent`, `help-habitat`, `jeeves-bot`, `pi-coder`, `twitter-habitat` |
| Direct Interaction/toolkit use | `simple-agent`, `bare-bones-memory`, `provider-comparison` |
| Reflection and multi-agent work | `context-explorer`, `dialogue-debate`, `connection-quiz`, `dialogue-web` |
| Protocol discovery and remote agents | `agent-browser` |
| Hosted OAuth MCP servers | `oura-mcp`, `twitter-mcp` |

These examples represent useful current patterns, but most are not included in
the root `examples/tsconfig.json` gate. Read their README and expect credentials
or external services where noted.

## Experimental and research workflows

| Example | Scope |
| --- | --- |
| `local-providers` | Local runtime benchmarking, eviction, watchdogs, quality matrices, and debug scripts |
| `memorization` | Conversion → fine-tuning → inference → evaluation research pipeline |
| `mcp-chat` | TezLab/Rivian OAuth MCP application and ranking experiment |

These are valuable research harnesses, not stable templates. Pin assumptions
before copying them into production code.

## Prototypes and fixtures

- `gaia-ui` is a static legacy/prototype UI, not the canonical Gaia/Shell
  implementation. Current Gaia composition lives in `packages/habitat`.
- `habitat-runtime-test` is test fixture infrastructure rather than a tutorial.
- `schemas` contains structured-output fixtures, not a runnable application.
- `docs/examples/interaction-interface-examples.md` is explicitly historical
  and does not use the current API.

## Known maintenance gaps

- The root examples gate now covers the minimal eval suites and the canonical
  model-showdown/local-provider report entry points, but not their full
  provider-backed execution.
- Several older narrative docs still describe options from the retired,
  larger evaluation CLI; only `eval run` is restored.
- `local-providers` mixes maintained harnesses and one-off debug scripts.
- Oura and Twitter MCP examples intentionally repeat deployment/OAuth
  scaffolding; a shared template has not yet been extracted.

The next maintenance step is to add canonical examples to typecheck and smoke
gates one at a time, fixing each example before opting it in. Do not switch the
gate to `examples/**/*.ts` and normalize existing failures by weakening checks.

## Related guides

- [Getting started](/guide/getting-started)
- [Habitat](/guide/habitat) and [Habitat interfaces](/guide/habitat-interfaces)
- [Creating evaluations](/guide/creating-evaluations)
- [Model Showdown walkthrough](/walkthroughs/model-showdown)
- [Reports and artifacts](/guide/reports)
- [MCP chat](/guide/mcp-chat)
- [Repository testing](https://github.com/The-Focus-AI/umwelten/blob/main/TESTING.md)
