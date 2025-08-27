You’re right—there’s already a whole src/evaluation/ area to build on. Let’s wire that into first-class CLI commands and retire the ad-hoc scripts.

What I see & how to use it
	•	The repo exposes a clear “evaluation” surface separate from the CLI and providers (the src/evaluation/ directory), which we can treat as the programmatic API.  ￼
	•	The README also promises batch/eval and a local report/dashboard—perfect to hook as reporters.  ￼
	•	There’s a scripts/ folder (recent) that looks like where you’ve been running evals manually; we’ll keep thin wrappers there for backward compatibility but move logic into CLI.  ￼

The plan: promote src/evaluation into CLI

Add an eval command family that delegates to your existing src/evaluation/* modules:

1) New CLI surface

umwelten eval run \
  --cases ./cases/*.jsonl \
  --providers openrouter,google,ollama,lmstudio \
  --models 'openrouter:gpt-4o-mini,google:gemini-1.5-flash,ollama:llama3.1' \
  --judge 'openrouter:gpt-4o' \
  --metrics exact,contains,regex \
  --concurrency 4 --timeout 30s \
  --out ./output/eval-$(date +%F) \
  --report jsonl,csv,html --resume

Other helpful subcommands:
	•	umwelten eval report --in ./output/eval-2025-08-25 --format html
	•	umwelten eval diff --a ./output/eval-a --b ./output/eval-b (compare models/runs)
	•	umwelten eval serve --in ./output/eval-2025-08-25 (static viewer)

2) CLI glue (minimal code you need)

Create src/cli/commands/eval.ts that only parses flags → calls your evaluation API:

// src/cli/commands/eval.ts
import { runEvaluation, makeReport, diffRuns, serveReport } from "../../evaluation/api";
import { parseMatrix, parseDuration, parseReporters } from "../../evaluation/cli-helpers";

export default {
  command: "eval <action>",
  describe: "Run and inspect evaluations",
  builder(y) {
    return y
      .positional("action", { choices: ["run", "report", "diff", "serve"] })
      .option("cases", { type: "string" })
      .option("providers", { type: "string" })
      .option("models", { type: "string" })
      .option("judge", { type: "string" })
      .option("metrics", { type: "string", default: "exact" })
      .option("concurrency", { type: "number", default: 2 })
      .option("timeout", { type: "string", default: "30s" })
      .option("out", { type: "string", default: "./output/eval" })
      .option("report", { type: "string", default: "jsonl,csv" })
      .option("resume", { type: "boolean", default: false })
      .option("in", { type: "string" })
      .option("a", { type: "string" })
      .option("b", { type: "string" });
  },
  async handler(argv) {
    const action = argv.action;
    if (action === "run") {
      await runEvaluation({
        casesGlob: argv.cases!,
        providers: argv.providers!.split(","),
        models: parseMatrix(argv.models!),
        judge: argv.judge,
        metrics: argv.metrics!.split(","),
        concurrency: argv.concurrency!,
        timeoutMs: parseDuration(argv.timeout!),
        outDir: argv.out!,
        reporters: parseReporters(argv.report!),
        resume: argv.resume!,
      });
    } else if (action === "report") {
      await makeReport({ inDir: argv.in!, formats: parseReporters(argv.report!) });
    } else if (action === "diff") {
      await diffRuns({ a: argv.a!, b: argv.b!, outDir: argv.out! });
    } else if (action === "serve") {
      await serveReport({ inDir: argv.in! });
    }
  }
};

3) Light refactor inside src/evaluation/

Without changing your existing logic, add a thin API layer so the CLI can call it:

src/evaluation/
  api.ts            // exports runEvaluation/makeReport/diffRuns/serveReport
  loaders.ts        // JSON/JSONL/CSV/YAML case loaders + templating
  metrics.ts        // exact/contains/regex/... (plug existing)
  judge.ts          // LLM-as-judge via SmartModelRunner
  matrix.ts         // expand providers×models×params
  runner.ts         // orchestrates runs; reuses SmartModelRunner + costs + rate-limit
  reporters/
    jsonl.ts csv.ts md.ts html.ts  // hook your existing web dashboard here
  cache.ts          // hash (provider, model, case) for --resume

Key point: reuse your SmartModelRunner, costs, and rate-limit code already present in the repo; don’t duplicate any provider logic. The README confirms those components exist and are intended for evaluation workflows.  ￼

4) Migrate recent scripts/ usage
	•	Replace complex shell/TS scripts with tiny shims that forward to the CLI:
	•	scripts/eval-run.sh → exec umwelten eval run "$@"
	•	scripts/eval-report.sh → exec umwelten eval report "$@"
	•	Keep them for muscle memory; mark as deprecated in a comment.  ￼

5) Docs & discoverability
	•	Extend README.cli.md with an “Evaluation” section: inputs (cases format), metrics, judges, reporters, resume, and CI examples.  ￼
	•	In the main README, under “Advanced Features,” add concrete umwelten eval invocations and a one-liner about the HTML report/dashboard.  ￼

6) CI & tests
	•	Add a minimal Vitest that runs a 1-case matrix against LM Studio (as in your current tests) to verify the CLI path end-to-end. The README explicitly mentions LM Studio fallback and dynamic model selection—lean on that to keep tests hermetic.  ￼

⸻

If you want, I can draft the exact api.ts (glue that calls your existing runner/metrics/judge) and a tiny reporters/html.ts that reuses the current dashboard code so --report html just drops a self-contained file alongside JSONL/CSV.
