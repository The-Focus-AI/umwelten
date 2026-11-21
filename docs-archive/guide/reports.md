# Reports and Artifacts

Umwelten has several output concepts with different ownership and lifecycles.
Choose the one that matches what you are producing instead of treating every
Markdown file as the same kind of report.

| Output | Owner | Location | Purpose |
| --- | --- | --- | --- |
| Evaluation report | `@umwelten/evaluation` | caller-selected file, usually `output/` | Reproducible benchmark metrics, comparisons, cost, and latency |
| Knowledge Artifact | reflection/promotion pipeline | `.umwelten/artifacts/YYYY-MM-DD-slug.{md,html}` | Human-facing output derived from an Exploration |
| Habitat artifact | running Habitat | `{workDir}/artifacts/` plus `.meta.json` | A file produced during an agent session and exposed through `/files/artifacts/...` |
| Architecture/research review | repository maintainers | `reports/` or `docs/architecture/` | Dated codebase research, decisions, and drift analysis |

There is **no `umwelten eval` CLI command**. Evaluation and report workflows
are script-driven.

## Evaluation reports

The canonical evaluation path is:

```text
EvalSuite scripts → cached result JSON → loadSuite()
  → buildSuiteReport() → Reporter (console / Markdown / JSON)
  or buildNarrativeReport() → standalone Markdown article
```

The complete reference is
[`examples/model-showdown`](https://github.com/The-Focus-AI/umwelten/tree/main/examples/model-showdown).

```bash
# Run the suite (requires configured providers)
dotenvx run -- pnpm tsx examples/model-showdown/run-all.ts

# Render cached results as structured Markdown
pnpm tsx examples/model-showdown/generate-report.ts --format md \
  --output output/model-showdown-results.md

# Render a prose report with methodology and detailed analysis
pnpm tsx examples/model-showdown/generate-report.ts --format narrative \
  --output output/model-showdown-narrative.md

# Machine-readable structured report
pnpm tsx examples/model-showdown/generate-report.ts --format json \
  --output output/model-showdown-results.json
```

`generate-report.ts` also supports `--focus <model...>` and
`--exclude <dimension...>`. It is ordinary TypeScript: copy it with your suite
configuration when building a new benchmark workflow.

### Programmatic suite reporting

```ts
import {
  Reporter,
  loadSuite,
  buildSuiteReport,
  buildNarrativeReport,
  type EvalDimension,
} from "@umwelten/evaluation";

const dimensions: EvalDimension[] = [
  {
    evalName: "my-reasoning-eval",
    label: "Reasoning",
    maxScore: 20,
    extractScore: (result) => result.score ?? 0,
    hasResultsSubdir: true,
  },
];

const suite = loadSuite(dimensions);
const reporter = new Reporter({ outputDir: "./output" });

const structured = buildSuiteReport(suite, { title: "My Evaluation" });
reporter.toConsole(structured);
await reporter.toFile(structured, "my-evaluation.md", "md");
await reporter.toFile(structured, "my-evaluation.json", "json");

const narrative = buildNarrativeReport(suite, {
  title: "My Evaluation — Full Analysis",
});
```

`Reporter` renders structured `Report` values to console, Markdown, or JSON.
It does not currently render HTML or CSV. `buildNarrativeReport()` returns a
Markdown string; writing that string is the caller's responsibility.

### Tool-test reports

`Reporter.fromToolTest()` adapts tool-test results to the same structured
report model:

```ts
import { Reporter } from "@umwelten/evaluation";

const reporter = new Reporter({ outputDir: "./output" });
const report = reporter.fromToolTest(results, "Tool Contract Tests");
reporter.toConsole(report);
await reporter.toFile(report, "tool-contract-tests.md");
```

## Knowledge Artifacts

An **Artifact** is a dated output produced from an Exploration for human use or
publication. The reflection promotion pipeline writes it through
`writeArtifact()` under `.umwelten/artifacts/`:

```ts
import { writeArtifact } from "@umwelten/core";

await writeArtifact(".umwelten/artifacts", {
  title: "Authentication exploration",
  content: "# Findings\n\n...",
  format: "md",
});
```

Use this for a durable output derived from project exploration. Use
`.umwelten/reflections/` for a saved answer that has not yet been promoted.

## Habitat artifacts

A running Habitat exposes `publish_artifact` and `list_artifacts` tools. The
publisher copies an existing file into the Habitat's `artifacts/` directory,
writes metadata including the producing Source Session, and returns a
`/files/artifacts/...` URL. The container server turns that into an absolute
public URL when a public origin is configured.

Use Habitat artifacts for files produced during an agent run: images, PDFs,
exports, generated HTML, and other user-downloadable outputs. This is a runtime
delivery mechanism, not an evaluation schema or project knowledge store.

## Architecture and research reviews

Repository research reports use dated names under `reports/`. Architecture
maps that become maintained documentation live under `docs/architecture/`.
Examples:

- `reports/2026-07-29-mcp-spec-2026-07-28-deep-dive.md`
- `docs/architecture/system-map-2026-08.md`

This category is currently human/agent-authored. It does not yet have a
generator or recurring command. A future review toolkit should produce:

1. a dated Markdown review;
2. a machine-readable sidecar with commit SHA, timestamp, scopes, checks, and
   previous-report baseline;
3. deterministic inventories for packages, imports/exports, examples, docs
   links, and ADR implementation status;
4. explicit human/agent judgments kept separate from mechanical findings.

Do not force this into the evaluation `Report` type: architecture drift,
source citations, and benchmark leaderboards have different contracts. A
review may cite an evaluation report or be promoted as a knowledge Artifact,
but those relationships should remain explicit.

## Publishing outside the repository

Files in any of these categories can be published after generation. Publication
is a transport step and should not change the report's domain type. Follow the
repository's artifact publishing instructions in `CLAUDE.md`; never publish
secrets, tokens, private transcripts, or unredacted environment data.

## Related guides

- [Creating evaluations](/guide/creating-evaluations)
- [Model Showdown walkthrough](/walkthroughs/model-showdown)
- [Pairwise ranking](/guide/pairwise-ranking)
- [Reflections and knowledge](/guide/reflections-and-knowledge)
- [Current architecture map](/architecture/system-map-2026-08)
