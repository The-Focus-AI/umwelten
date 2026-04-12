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

## EvalSuite examples (repo)

Working `EvalSuite` evaluations in [`examples/evals/`](https://github.com/The-Focus-AI/umwelten/tree/main/examples/evals):

```bash
dotenvx run -- pnpm tsx examples/evals/car-wash.ts          # common-sense reasoning
dotenvx run -- pnpm tsx examples/evals/instruction.ts       # instruction following
dotenvx run -- pnpm tsx examples/evals/reasoning.ts         # reasoning quality
```

## Script demos (repo)

From the **umwelten** repo root:

```bash
dotenvx run -- pnpm tsx scripts/examples/car-wash-test.ts
```

For **integration-style / manual test scripts** (Dagger, tool conversations, reasoning streams), see [**TESTING.md**](https://github.com/The-Focus-AI/umwelten/blob/main/TESTING.md) in the repo.
