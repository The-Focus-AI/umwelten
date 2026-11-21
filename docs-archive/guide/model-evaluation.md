# Model Evaluation

Evaluation is a first-class Umwelten system. Use the CLI for quick, unscored
comparisons and executable suites for repeatable, scored methodology.

## Which entry point to use

| Need | Supported entry point |
| --- | --- |
| Compare one prompt ad hoc | `umwelten eval run` |
| A focused benchmark | `EvalSuite` |
| Standard language + coding + tool benchmark | `runFullEval()` |
| Relative preference between responses | `PairwiseRanker` |
| Aggregate independently-run dimensions | `loadSuite()` + report builders |
| Local runtime matrix with watchdog/eviction | `examples/local-providers` harness |

The CLI and first four APIs are supported core surfaces. The local-provider and Dagger/container
workflows are useful research infrastructure, not the default abstraction.

## Ad-hoc comparison

```bash
npx umwelten eval run \
  --prompt "Write a haiku about recursion" \
  --models "ollama:qwen3:30b-a3b,openrouter:openai/gpt-5.4" \
  --id "local-vs-cloud" --concurrent
```

Responses are cached under `output/evaluations/{id}/`. Use `--new` to bypass
the cache, `--json` for machine-readable output, and `--max-concurrency N` to
bound parallel model calls. This path does not score responses; move the prompt
into an `EvalSuite` when it becomes a benchmark.

## Focused suite

```typescript
import { EvalSuite } from '@umwelten/evaluation';

const suite = new EvalSuite({
  name: 'arithmetic',
  stimulus: {
    role: 'precise assistant',
    instructions: ['Return only the answer'],
    temperature: 0,
  },
  models: [{ provider: 'ollama', name: 'gemma3:4b' }],
  tasks: [{
    id: 'two-plus-two',
    prompt: 'What is 2 + 2?',
    maxScore: 1,
    verify: response => ({
      score: response.trim() === '4' ? 1 : 0,
      details: response.trim(),
    }),
  }],
});

await suite.run();
```

Run the suite itself:

```bash
dotenvx run -- pnpm tsx path/to/arithmetic.ts
dotenvx run -- pnpm tsx path/to/arithmetic.ts --new
```

Use deterministic `verify()` scoring whenever the criterion can be encoded.
Use a `JudgeTask` only when quality requires interpretation. Both paths save
scored task records under `output/evaluations/{suite}/runs/{NNN}/` and resume
cached work.

## Standard full benchmark

`runFullEval()` is the canonical composition used by the local-provider matrix.
It runs selected suites sequentially while each `EvalSuite` controls its own
task concurrency.

```typescript
import { runFullEval } from '@umwelten/evaluation';

const result = await runFullEval(
  { provider: 'ollama', name: 'qwen3:8b' },
  {
    only: ['language', 'coding', 'tool-calling'],
    perTaskTimeoutMs: 300_000,
    signal: abortController.signal,
  },
);
```

The abort signal reaches the underlying model call, so a harness timeout does
not leave generation running after a model is evicted.

## Ranking and aggregation

`PairwiseRanker` consumes existing responses and ranks them through cached,
position-randomized judge comparisons. See [Pairwise Ranking](./pairwise-ranking.md).

Multi-dimension reporting is also post-processing: each benchmark runs and
caches independently, then an executable report script loads `EvalDimension[]`:

```typescript
import {
  loadSuite,
  buildSuiteReport,
  Reporter,
  type EvalDimension,
} from '@umwelten/evaluation';

const dimensions: EvalDimension[] = [{
  evalName: 'arithmetic',
  label: 'Arithmetic',
  maxScore: 10,
  extractScore: result => result.score ?? 0,
}];

const report = buildSuiteReport(loadSuite(dimensions), {
  title: 'Capability report',
});

console.log(new Reporter().toMarkdown(report));
```

The reference implementation is
`examples/model-showdown/generate-report.ts`; it renders console, Markdown,
JSON, or a narrative writeup from cached suite results.

## Evaluation best practices

1. Keep prompts, scoring, model selection, and report dimensions in versioned
   TypeScript—not shell history.
2. Prefer deterministic verification; document judge rubrics and pin the judge
   model when an LLM judge is necessary.
3. Preserve raw model responses and usage metadata before deriving scores.
4. Resume cached runs by default and use `--new` only when methodology or model
   configuration changes.
5. Run dimensions independently; aggregate only models with comparable data.
6. Label hardware-specific watchdogs and container builders as harness policy,
   not evaluation semantics.

## Examples

- `examples/evals/` — smallest supported suites.
- `examples/model-showdown/` — independent dimensions and report generation.
- `examples/local-providers/` — experimental local runtime matrix.

See [Creating Evaluations](./creating-evaluations.md) for task definitions and
[Evaluation architecture](../architecture/evaluation-framework.md) for the
core/auxiliary boundary.
