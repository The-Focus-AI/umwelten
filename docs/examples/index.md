# Examples

Start from the **two canonical examples** in the repo; everything else is optional or exploratory.

## Canonical (copy these first)

| Example | Use it for |
|---------|------------|
| **[`examples/habitat-minimal`](https://github.com/The-Focus-AI/umwelten/tree/main/examples/habitat-minimal)** | Smallest Habitat work-dir layout, `habitat` CLI, native `sessions habitat` introspection |
| **[`examples/model-showdown`](https://github.com/The-Focus-AI/umwelten/tree/main/examples/model-showdown)** | Multi-dimension evaluations, `suite-config.ts`, **`eval combine`**, suite reports |

Clone the repo, `pnpm install`, set `.env`, then follow each README from the repo root (use **`dotenvx run --`** before CLI commands that need keys).

## I want to…

| Goal | Doc or script |
|------|----------------|
| Install & first commands | [Getting started](/guide/getting-started) |
| Habitat agents & interfaces | [Habitat](/guide/habitat), [Habitat interfaces](/guide/habitat-interfaces) |
| Model evaluation & combine | [Model evaluation](/guide/model-evaluation), [Creating evaluations](/guide/creating-evaluations), [Model showdown walkthrough](/walkthroughs/model-showdown) |
| Tool calling & Stimulus | [Tool calling](/guide/tool-calling) |
| Structured output | [Structured output](/guide/structured-output) |
| MCP chat pattern | [MCP chat](/guide/mcp-chat) |
| Programmatic API | [API overview](/api/overview) |
| Runner / strategy details | [Evaluation framework (architecture)](/architecture/evaluation-framework) |

## More topic guides (sidebar)

The VitePress **Examples** sidebar lists narrative pages: text generation, creative writing, batch/matrix evaluations, PDF/images, cost optimization, etc. Those pages supplement the canonical repos above; they are not separate git examples.

## Script demos (repo)

From the **umwelten** repo root:

```bash
pnpm tsx scripts/examples/simple-evaluation-example.ts
pnpm tsx scripts/examples/matrix-evaluation-example.ts
pnpm tsx scripts/examples/batch-evaluation-example.ts
pnpm tsx scripts/examples/complex-pipeline-example.ts
pnpm tsx scripts/examples/comprehensive-analysis-example.ts
```

For **integration-style / manual test scripts** (Dagger, tool conversations, reasoning streams), see [**TESTING.md**](https://github.com/The-Focus-AI/umwelten/blob/main/TESTING.md) in the repo.
