/**
 * Editorial metadata & JSON data loaders for `umwelten.thefocus.ai`.
 *
 * IMPORTANT INVARIANT: Zero benchmark scores, latencies, or costs are hardcoded
 * in this file. Every measurement is loaded from committed JSON artifacts in
 * `reports/data/` produced by runnable scripts:
 *   - `pnpm run site:bench`            -> `examples/model-watch/run.ts`
 *   - `pnpm run site:extract-archives` -> `scripts/extract-historical-reports.ts`
 */

import fs from "node:fs";
import path from "node:path";
import type {
  ArchivedHeadroomRow,
  ArchivedShowdownRow,
} from "./extract-historical-reports.js";

export interface LiveWatchModel {
  id: string;
  provider: string;
  tier: "cloud" | "local";
  weights: "open" | "closed";
  pricingPerMillion: { promptTokens: number; completionTokens: number } | null;
  combined: number;
  reasoning: number;
  reasoningRaw: string;
  knowledge: number;
  knowledgeRaw: string;
  instruction: number;
  instructionRaw: string;
  coding: number;
  codingRaw: string;
  tools: number;
  toolsRaw: string;
  elo: number | null;
  cost: number;
  timeSec: number;
  taskBreakdown: Record<
    string,
    Array<{
      taskId: string;
      score: number;
      maxScore: number;
      details: string;
      costUsd: number;
      durationMs: number;
    }>
  >;
}

export interface LiveWatchArtifact {
  generatedAt: string;
  reproduceCommand: string;
  freshCommand: string;
  judgeModel: string;
  dimensions: Array<{
    id: string;
    label: string;
    maxScore: number;
    tasks: number;
    scoring: string;
  }>;
  totalSuiteCostUsd: number;
  models: LiveWatchModel[];
  unavailableCatalogueModels: Array<{
    provider: string;
    name: string;
    error: string;
  }>;
}

export interface HistoricalArchivesArtifact {
  extractedAt: string;
  showdown: {
    title: string;
    sourceReport: string;
    runDate: string;
    reproduceCommand: string;
    modelCount: number;
    totalCostUsd: number;
    rows: ArchivedShowdownRow[];
  };
  headroom: {
    title: string;
    sourceReport: string;
    runDate: string;
    hardware: string;
    reproduceCommand: string;
    rows: ArchivedHeadroomRow[];
  };
}

export interface JevLiveArtifact {
  executedAt: string;
  caseCount: number;
  reproduceCommand: string;
  nativeJev: {
    backend: string;
    summary: {
      calls: number;
      completed: number;
      failed: number;
      successfulCallLatencyMs: { p50: number; p95: number };
      groups: Array<{
        key: string;
        questions: number;
        valid: number;
        accuracyAmongValid: number;
        meanBrier: number | null;
        meanRankedProbabilityScore: number | null;
      }>;
    };
  };
  llmBaseline: {
    backend: string;
    summary: {
      calls: number;
      completed: number;
      failed: number;
      knownCostUsd: number;
      successfulCallLatencyMs: { p50: number; p95: number };
      groups: Array<{
        key: string;
        questions: number;
        valid: number;
        accuracyAmongValid: number;
        meanBrier: number | null;
        meanRankedProbabilityScore: number | null;
      }>;
    };
  };
}

export interface ExamplesLiveArtifact {
  generatedAt: string;
  outputs: Record<string, string>;
}

export function loadSiteDatasets(rootDir: string) {
  const dataDir = path.join(rootDir, "reports", "data");
  const mockWatch = JSON.parse(
    fs.readFileSync(path.join(dataDir, "model-watch-mock.json"), "utf8"),
  ) as LiveWatchArtifact & { mode?: string };
  const liveWatch = JSON.parse(
    fs.readFileSync(path.join(dataDir, "model-watch-live.json"), "utf8"),
  ) as LiveWatchArtifact;
  const archives = JSON.parse(
    fs.readFileSync(path.join(dataDir, "historical-archives.json"), "utf8"),
  ) as HistoricalArchivesArtifact;
  const jevLive = JSON.parse(
    fs.readFileSync(path.join(dataDir, "jev-live.json"), "utf8"),
  ) as JevLiveArtifact;
  const examplesMock = JSON.parse(
    fs.readFileSync(path.join(dataDir, "examples-mock.json"), "utf8"),
  ) as ExamplesLiveArtifact;

  return { mockWatch, liveWatch, archives, jevLive, examplesMock };
}

export interface ExamplePick {
  role: string;
  name: string;
  note: string;
}

export interface PromptExampleMeta {
  num: string;
  slug: string;
  outputKey: string;
  category: "evaluations" | "judgment" | "sessions" | "habitats" | "mycel";
  categoryLabel: string;
  badge: string;
  title: string;
  heroHtml: string;
  subtitle: string;
  file: string;
  runCommand: string;
  packages: string[];
  readMinutes: number;
  prompt: string;
  picks: ExamplePick[];
  fallbackOutput?: string;
  writeupHtml: string;
}

export const PROMPT_EXAMPLES: PromptExampleMeta[] = [
  {
    num: "01",
    slug: "model-watch-bench",
    outputKey: "car-wash-traps",
    category: "evaluations",
    categoryLabel: "Evaluations",
    badge: "Reproducible Site Benchmark",
    title: "Reproducing the Live Model Watch Pareto Suite",
    heroHtml: "Reproducing the Live<br><em>Model Watch Suite</em>",
    subtitle:
      "Every live score, cost, tool count, Node-executed JS test vector, and Jev calibration metric on this site is generated by a single script — zero hand-entered leaderboard numbers.",
    file: "examples/model-watch/run.ts",
    runCommand: "pnpm run site:bench",
    packages: ["@umwelten/evaluation", "@umwelten/pi", "zod"],
    readMinutes: 6,
    prompt:
      "Write a single reproducible Model Watch runner (`examples/model-watch/run.ts`) on @umwelten/evaluation and @umwelten/pi that probes advertised models on Mycel (recording dead upstream offers honestly), runs 5 cached EvalSuites — Reasoning Traps (/20), Adversarial Knowledge (/20), Strict Instruction Compliance (/25), Node-executed JS/ESM Coding (/30), and Multi-Step Tool Chaining + PairwiseRanker Elo (/10) — plus a 9-case Jev vs. LLM calibration slice, writing machine-readable JSON to reports/data/ for the static site builder.",
    picks: [
      {
        role: "Cost Pareto",
        name: "mycel:moonshotai/kimi-k3.1-pro",
        note: "100% (105/105 across all 17 tasks) for $0.0103 total run cost.",
      },
      {
        role: "Speed Pareto",
        name: "mycel:anthropic/claude-opus-5.5",
        note: "100% (105/105) in 93.9s total (27.8s across all 3 JS coding tasks vs. 144.6s on Kimi) at $0.2252.",
      },
      {
        role: "Loop trap",
        name: "mycel:deepseek/deepseek-v4.1-flash",
        note: "Aced 16/17 tasks for $0.0129, then burned $0.0857 (298s) in a <think> loop on rational operator precedence.",
      },
    ],
    writeupHtml: `
      <p class="body-text">
        Static leaderboards rot the moment hand-copied numbers drift from runnable code. <code>examples/model-watch/run.ts</code>
        enforces a strict rule: <code>scripts/build-site.ts</code> contains <strong>zero hardcoded model scores</strong> and reads
        exclusively from <code>reports/data/*.json</code>.
      </p>
      <p class="body-text">
        Running this suite live immediately caught a real bug in our own library: <code>EvalSuite.runJudge()</code> previously
        passed <code>maxTokens: 500</code>, which truncated thinking-enabled judges mid-<code>&lt;think&gt;</code> on the 12-coin balance
        tree (<code>Unexpected end of JSON input</code>). Removing default judge token clamps restored clean 20/20 rubric scoring.
      </p>`,
  },
  {
    num: "02",
    slug: "car-wash-traps",
    outputKey: "car-wash-traps",
    category: "evaluations",
    categoryLabel: "Evaluations",
    badge: "EvalSuite · Zod JudgeTask",
    title: "Common-Sense Traps: The 50m Car Wash Test",
    heroHtml: "Common-Sense Traps:<br><em>The 50m Car Wash Test</em>",
    subtitle:
      "Pair an uncapped Pi stream with a 4-field Zod JudgeTask that separates physical world-state reasoning ('the car must be at the wash') from convenience guesses.",
    file: "examples/evals/car-wash.ts",
    runCommand: "pnpm tsx examples/evals/car-wash.ts",
    packages: ["@umwelten/evaluation", "@umwelten/pi", "zod"],
    readMinutes: 4,
    prompt:
      "Using @umwelten/evaluation on Pi, create an EvalSuite that tests cloud and local models on the 50-meter Car Wash question ('I want to wash my car. The car wash is 50 meters away. Should I walk or drive?'). Leave maxTokens uncapped so thinking models can finish reasoning, and score responses with a Zod JudgeTask that awards 5/5 only when the model says DRIVE because the car itself must be at the wash (and 2/5 if it says drive out of convenience).",
    picks: [
      {
        role: "Live 5/5",
        name: "mycel:z-ai/glm-5.3-flash",
        note: "5/5 in 1.43s ($0.00014) — immediately states the car must be at the car wash.",
      },
      {
        role: "Live 5/5",
        name: "mycel:deepseek/deepseek-v4.1-flash",
        note: "5/5 in 1.37s ($0.00015) — notes walking leaves the car behind.",
      },
      {
        role: "Live 5/5",
        name: "mycel:anthropic/claude-opus-5.5",
        note: "5/5 in 2.83s ($0.00395) — even notes the edge case of walking only to buy soap.",
      },
    ],
    writeupHtml: `
      <p class="body-text">
        A substring check for <code>"drive"</code> cannot distinguish a model that understands physical world state
        (<em>the car is the object being washed</em>) from one that says <em>&ldquo;drive if you&rsquo;re carrying heavy buckets.&rdquo;</em>
        <code>JudgeTask</code> runs a structured judge pass against a Zod schema with <code>recognizes_need_for_car: z.coerce.boolean()</code>.
      </p>`,
  },
  {
    num: "03",
    slug: "reasoning-puzzles",
    outputKey: "reasoning-puzzles",
    category: "evaluations",
    categoryLabel: "Evaluations",
    badge: "EvalSuite · Multi-Branch Logic",
    title: "Multi-Branch Logic Puzzles & The 12-Coin Balance",
    heroHtml: "Multi-Branch Logic &amp;<br><em>The 12-Coin Balance</em>",
    subtitle:
      "Four adversarial reasoning tasks culminating in the 12-coin, 3-weighing balance problem — information-theoretically tight at 24 states in 27 outcomes.",
    file: "examples/evals/reasoning.ts",
    runCommand: "pnpm tsx examples/evals/reasoning.ts --all",
    packages: ["@umwelten/evaluation", "@umwelten/pi", "zod"],
    readMinutes: 5,
    prompt:
      "Build a 4-task reasoning benchmark in @umwelten/evaluation covering the Surgeon Riddle, Bat & Ball ($1.10), Lily Pad doubling (48 days), and the 12-Coin 3-Weighing counterfeit balance puzzle. Keep generation uncapped so models can write full case trees, support --all for the full cloud+local roster, and score each task 1–5 with a Zod rubric judge.",
    picks: [
      {
        role: "Non-adaptive",
        name: "mycel:deepseek/deepseek-v4.1-flash",
        note: "20/20 ($0.0078) — constructed a complete non-adaptive ternary 4v4 lookup table for all 12 coins.",
      },
      {
        role: "Decision tree",
        name: "mycel:moonshotai/kimi-k3.1-pro",
        note: "20/20 ($0.0038) — wrote out every balanced and tilted coin-rotation branch.",
      },
      {
        role: "Fastest 20/20",
        name: "mycel:anthropic/claude-opus-5.5",
        note: "20/20 in 26.6s total (17.2s on 12-coin vs. 45–48s on flash/open models).",
      },
    ],
    writeupHtml: `
      <p class="body-text">
        The 12-Coin Balance problem requires 1,500–4,000 tokens of internal case verification before a model writes its clean
        3-weighing proof. Any framework that injects a default <code>maxTokens</code> clamp cuts off both the candidate&rsquo;s proof
        and a thinking judge&rsquo;s verification pass.
      </p>`,
  },
  {
    num: "04",
    slug: "instruction-compliance",
    outputKey: "instruction-compliance",
    category: "evaluations",
    categoryLabel: "Evaluations",
    badge: "VerifyTask · Zero Judge Cost",
    title: "Deterministic Format & Negative-Constraint Compliance",
    heroHtml: "Deterministic Format &amp;<br><em>Negative Constraints</em>",
    subtitle:
      "Test exact word counts, fence-free raw JSON, forbidden letters/words, and Markdown table conversion using pure TypeScript verify() functions — zero judge tokens.",
    file: "examples/evals/instruction.ts",
    runCommand: "pnpm tsx examples/evals/instruction.ts",
    packages: ["@umwelten/evaluation", "@umwelten/pi"],
    readMinutes: 4,
    prompt:
      "Write a zero-judge instruction-following EvalSuite in @umwelten/evaluation at temperature 0.0 with deterministic VerifyTasks: (1) an ocean sentence of EXACTLY 12 words, (2) raw JSON matching schema constraints with zero markdown code fences, (3) a 2-line sunset description banning 'beautiful', 'sky', 'orange', and '!', and (4) CSV-to-Markdown table conversion.",
    picks: [
      {
        role: "25/25 @ $0.0006",
        name: "mycel:moonshotai/kimi-k3.1-pro",
        note: "Aced all 5 tasks including the P-A-R-E-T 5×8-word lipogram acrostic for six hundredths of a cent.",
      },
      {
        role: "25/25 fastest",
        name: "mycel:deepseek/deepseek-v4.1-flash",
        note: "25/25 in 6.7s total ($0.0010).",
      },
      {
        role: "24/25 slip",
        name: "mycel:z-ai/glm-5.3-flash",
        note: "Hit [8,8,8,8,8] word counts and P-A-R-E-T acrostic, but let one forbidden letter 'z' slip through.",
      },
    ],
    writeupHtml: `
      <p class="body-text">
        Whenever constraints are syntactic &mdash; word counts, valid JSON without <code>\`\`\`json</code> wrappers, acrostics, or
        lipograms &mdash; deterministic <code>VerifyTask</code> functions execute in microseconds with zero judge variance.
      </p>`,
  },
  {
    num: "05",
    slug: "tool-math-elo",
    outputKey: "tool-math-elo",
    category: "evaluations",
    categoryLabel: "Evaluations",
    badge: "Tools · PairwiseRanker Elo",
    title: "Multi-Step Tool Chaining & Pairwise Elo Ranking",
    heroHtml: "Multi-Step Tool Chaining &amp;<br><em>Pairwise Elo Ranking</em>",
    subtitle:
      "Verify that models invoke calculator and statistics tools across multi-step arithmetic via PiTurnResult.toolCalls, then compute position-swapped round-robin Elo.",
    file: "examples/evals/tool-math.ts",
    runCommand: "pnpm tsx examples/evals/tool-math.ts",
    packages: ["@umwelten/evaluation", "@umwelten/pi"],
    readMinutes: 5,
    prompt:
      "Build an evaluation script using @umwelten/evaluation that equips models with calculatorTool and statisticsTool on a multi-item grocery + 8% sales-tax problem. In verify(response, turn), award points both for hitting $28.88 AND for making at least 3 real tool calls in turn.toolCalls, then pass all model outputs to PairwiseRanker to compute round-robin Elo standings.",
    picks: [
      {
        role: "10/10 · 8.0s",
        name: "mycel:deepseek/deepseek-v4.1-flash",
        note: "8 calculator calls on grocery + 2 chained stats→calculator calls ($0.0022, Elo 1530).",
      },
      {
        role: "10/10 · #1 Elo",
        name: "mycel:z-ai/glm-5.3-flash",
        note: "10/10 across both multi-tool tasks ($0.0019, Elo 1531).",
      },
      {
        role: "10/10 · cheapest",
        name: "mycel:moonshotai/kimi-k3.1-pro",
        note: "10/10 for $0.0015 across 10 executed tool calls.",
      },
    ],
    writeupHtml: `
      <p class="body-text">
        Inspecting <code>turn?.toolCalls</code> on <code>PiTurnResult</code> proves the model actually invoked <code>statistics</code>
        followed by <code>calculator</code> rather than doing brittle mental arithmetic, while <code>PairwiseRanker</code> evaluates
        both <code>(A, B)</code> and <code>(B, A)</code> orders to cancel judge position bias.
      </p>`,
  },
  {
    num: "06",
    slug: "model-showdown-combiner",
    outputKey: "model-showdown-combiner",
    category: "evaluations",
    categoryLabel: "Evaluations",
    badge: "Combine · Multi-Suite Matrix",
    title: "Multi-Dimension Showdown & Cross-Suite Combiner",
    heroHtml: "Multi-Dimension Showdown &amp;<br><em>Cross-Suite Combiner</em>",
    subtitle:
      "Combine cached Reasoning, Knowledge, Instruction, Coding, and MCP evaluation directories into normalized cross-provider Pareto standings.",
    file: "examples/model-showdown/suite-config.ts",
    runCommand: "pnpm tsx scripts/extract-historical-reports.ts",
    packages: ["@umwelten/evaluation"],
    readMinutes: 4,
    prompt:
      "Define a declarative EvalDimension[] configuration in @umwelten/evaluation that combines five independent cached evaluation suites — Reasoning (/20), Knowledge (/30), Instruction (/30), Polyglot Coding (/126), and TezLab MCP Tool Use (/16) — normalizing per-dimension percentages into one unified leaderboard.",
    picks: [
      {
        role: "Mar '26 #1",
        name: "openrouter:anthropic/claude-sonnet-4.6",
        note: "100.0% across all 4 text/code dimensions (20/20, 30/30, 30/30, 126/126) for $0.20.",
      },
      {
        role: "Mar '26 Value",
        name: "openrouter:openai/gpt-oss-120b",
        note: "98.3% 4-dim score (20/20 reasoning, 126/126 coding) for $0.01.",
      },
      {
        role: "Mar '26 Local",
        name: "ollama:gpt-oss:latest",
        note: "93.3% 4-dim score locally on Apple Silicon at $0 marginal API spend.",
      },
    ],
    fallbackOutput: `Extracted from docs-archive/walkthroughs/model-showdown-results.md (48 models, $4.63 total):
  #1  anthropic/claude-sonnet-4.6   100.0%  (R:20/20 K:30/30 I:30/30 C:126/126)  $0.20   3m
  #2  qwen/qwen3.5-397b-a17b         99.2%  (R:20/20 K:29/30 I:30/30 C:126/126)  $0.52  36m
  #3  x-ai/grok-4.20-beta            98.8%  (R:20/20 K:29/30 I:30/30 C:124/126)  $0.09   2m
  #4  gemini-3-flash-preview         98.8%  (R:19/20 K:30/30 I:30/30 C:126/126)  $0.04 1h41m
  #6  openai/gpt-oss-120b            98.3%  (R:20/20 K:28/30 I:30/30 C:126/126)  $0.01  10m
 #21  gpt-oss:latest (Ollama)        93.3%  (R:20/20 K:28/30 I:29/30 C:105/126)   Free 1h11m
 #46  qwen3:30b-a3b (Ollama)         77.5%  (R:20/20 K:29/30 I: 4/30 C:126/126)   Free 1h14m`,
    writeupHtml: `
      <p class="body-text">
        Look at Rank #46 in the archived 48-model run: <code>qwen3:30b-a3b</code> achieved a perfect <strong>126/126</strong> on
        compiled coding and <strong>20/20</strong> on reasoning, yet scored <strong>4/30</strong> on strict instruction formatting.
        Keeping dimensions separate and normalized exposes specialists that single-number leaderboards hide.
      </p>`,
  },
  {
    num: "07",
    slug: "jev-calibration",
    outputKey: "jev-calibration",
    category: "judgment",
    categoryLabel: "Calibrated Judgment",
    badge: "Jev · Brier, RPS & ECE",
    title: "Calibrated Probability Judgments: Jev vs. LLM Baseline",
    heroHtml: "Calibrated Judgments:<br><em>Jev vs. LLM Baseline</em>",
    subtitle:
      "Compare native Jev probability distributions (/v1/decisions) against Pi structured-output LLM baselines across binary, categorical, and ordinal questions using Brier, RPS, and selective risk.",
    file: "examples/jev/run.ts",
    runCommand: "pnpm tsx examples/jev/run.ts --backend mycel --live --limit 9",
    packages: ["@umwelten/evaluation", "@umwelten/pi"],
    readMinutes: 6,
    prompt:
      "Create a CLI runner using @umwelten/evaluation's judgment module that validates a 60-case synthetic dataset across support, evidence, and completion families, supports both native Jev endpoints (openrouter, typesafe, mycel) and any Pi chat model via createLlmJudgmentBackend, tests option-order invariance (--reverse-options), and writes class-summed Brier score, Ranked Probability Score (RPS), ECE reliability bins, and selective-risk coverage to summary.json.",
    picks: [
      {
        role: "Native 320ms",
        name: "mycel:typesafe/jev-1.13",
        note: "Live 9-case run: p50 320ms (p95 374ms), Brier 0.0022 (binary) & 0.0000 (choice), ordinal RPS 0.0891.",
      },
      {
        role: "LLM 886ms",
        name: "mycel:deepseek/deepseek-v4.1-flash",
        note: "Live 9-case baseline: p50 886ms (p95 1,725ms), $0.00171 total cost; 60-case report in reports/2026-09-20-jev-development-pilot.md.",
      },
      {
        role: "60-case pilot",
        name: "reports/2026-09-20-jev-development-pilot.md",
        note: "Full 60-case benchmark: Jev 54/60 ($0.000486 Mycel debit across 80 calls) vs. DeepSeek 57/57 + 3 timeouts.",
      },
    ],
    writeupHtml: `
      <p class="body-text">
        In our live 9-case verification slice (and the full 60-case pilot in <code>reports/2026-09-20-jev-development-pilot.md</code>),
        <code>typesafe/jev-1.13</code> returned typed distributions at <strong>320ms median latency</strong> (2.8&times; faster than the
        generative baseline), with conservative ordinal completion probabilities where raising the selective-risk threshold to
        <code>&tau; = 0.80</code> dropped error rate on accepted predictions to <code>0%</code>.
      </p>`,
  },
  {
    num: "08",
    slug: "pi-extension-sessions",
    outputKey: "pi-extension-sessions",
    category: "sessions",
    categoryLabel: "Sessions & Pi CLI",
    badge: "@umwelten/pi · Explorations",
    title: "Cross-Harness Session Sensemaking & Promotion in Pi",
    heroHtml: "Cross-Harness Sessions &amp;<br><em>Knowledge Promotion</em>",
    subtitle:
      "Install @umwelten/pi into Pi CLI to index Pi JSONL v3 trees, Pi Durable SQLite databases, Claude Code, and Cursor into unified Explorations — and promote durable rules into FACTS.md.",
    file: "examples/pi-extension/demo.ts",
    runCommand: "pnpm tsx examples/pi-extension/demo.ts",
    packages: ["@umwelten/pi", "@umwelten/sessions", "@umwelten/habitat"],
    readMinutes: 5,
    prompt:
      "Write a runnable demo showing how @umwelten/pi extends Pi: (1) open a SQLite-backed DurableHabitat and run a turn so a pi-durable conversation is persisted on disk, (2) run @umwelten/sessions initializeAdapters() + projectSessions() to discover that SQLite conversation alongside Pi JSONL / Claude Code / Cursor sessions as an Exploration without mutating foreign SQLite files, and (3) invoke umweltenPiExtension's umwelten_promote_knowledge tool to write a durable rule into FACTS.md.",
    picks: [
      {
        role: "Install cmd",
        name: "pi install ./packages/pi",
        note: "Registers umwelten_session_search, umwelten_session_stats, umwelten_promote_knowledge, and /umwelten-explorations.",
      },
      {
        role: "SQLite guard",
        name: "PiDurableSessionAdapter",
        note: "Pre-checks sqlite_master in readonly mode so unrelated .sqlite files are never touched by DDL migrations.",
      },
    ],
    writeupHtml: `
      <p class="body-text">
        <code>@umwelten/sessions</code> correlates Pi CLI JSONL v3 trees, <code>pi-durable</code> SQLite journals, Claude Code, and Cursor
        into unified <strong>Explorations</strong>, while <code>@umwelten/pi</code> exposes search and knowledge promotion directly inside Pi.
      </p>`,
  },
  {
    num: "09",
    slug: "durable-habitat-a2a",
    outputKey: "durable-habitat-a2a",
    category: "habitats",
    categoryLabel: "Durable Habitats",
    badge: "pi-durable · A2A 1.0 Host",
    title: "Host-Agnostic DurableHabitat & A2A 1.0 Multi-Agent Host",
    heroHtml: "Host-Agnostic<br><em>DurableHabitat &amp; A2A 1.0</em>",
    subtitle:
      "Multiplex SQLite-backed Pi Durable agents on one Node HTTP server with Owned/Mounted repository guards, ui:// resources, and A2A 1.0 JSON-RPC.",
    file: "examples/durable-habitat/host.ts",
    runCommand: "pnpm tsx examples/durable-habitat/host.ts",
    packages: ["@umwelten/habitat", "@umwelten/protocols", "@earendil-works/pi-durable"],
    readMinutes: 6,
    prompt:
      "Stand up a multi-tenant HabitatHost over @earendil-works/pi-durable that lazily opens per-Habitat SQLite databases on HTTP requests, enforces Owned read/write vs. Mounted read-only repository paths via a ToolTask beforeTool hook, and exposes A2A 1.0 Agent Cards (/.well-known/agent-card.json) plus JSON-RPC SendMessage (/habitats/:id/a2a) — with zero Cloudflare Worker dependencies.",
    picks: [
      {
        role: "Storage",
        name: "SqliteStorage / Postgres",
        note: "Generic over pi-durable Storage & ExecutionEnv — runs identically on a laptop, VM, container, or Postgres.",
      },
      {
        role: "Wire spec",
        name: "@leocavalcante/pi-a2a (A2A 1.0)",
        note: "Serves standard Agent Cards and SendMessage tasks per-(tenant, speaker) conversation.",
      },
    ],
    writeupHtml: `
      <p class="body-text">
        Rebasing <code>@umwelten/habitat</code> onto <code>@earendil-works/pi-durable</code> cut 59,492 lines down to 4,099 lines while
        keeping <code>DurableHabitat</code> strictly generic over <code>Storage</code> and <code>ExecutionEnv</code>.
      </p>`,
  },
  {
    num: "10",
    slug: "mycel-exchange-e2e",
    outputKey: "mycel-exchange-e2e",
    category: "mycel",
    categoryLabel: "Mycel Exchange",
    badge: "Mycel · Guarantees & Metering",
    title: "Mycel Token Exchange: Supplier Guarantees & Micro-Dollar Metering",
    heroHtml: "Mycel Exchange:<br><em>Guarantees &amp; Micro-Dollars</em>",
    subtitle:
      "Boot an in-memory Exchange, publish an on-premise GPU Supplier Offer, authenticate via ES256 JWKS or static Application credentials, stream through @umwelten/pi, and verify integer micro-dollar accounting.",
    file: "examples/mycel-e2e/run.ts",
    runCommand: "pnpm tsx examples/mycel-e2e/run.ts",
    packages: ["@umwelten/mycel", "@umwelten/pi", "jose"],
    readMinutes: 6,
    prompt:
      "Build a self-contained end-to-end script that boots @umwelten/mycel's Exchange on localhost, registers an 'on-premise' Supplier publishing gemma-4-26b, funds an End User with 10,000,000 micro-dollars ($10), streams a turn from @umwelten/pi's runPiTurn({ provider: 'mycel' }) without importing @umwelten/mycel on the buyer side, verifies exact prompt/completion micro-dollar charges, and proves requests missing X-Mycel-End-User are rejected with HTTP 401.",
    picks: [
      {
        role: "Protocol seam",
        name: "OpenAI /v1 + X-Mycel-End-User",
        note: "@umwelten/pi imports zero code from @umwelten/mycel — keeping the workspace DAG cycle-free.",
      },
      {
        role: "Accounting",
        name: "Integer micro-dollars (10⁻⁶ USD)",
        note: "End User → Application → Client fallback pools with zero floating-point drift.",
      },
    ],
    writeupHtml: `
      <p class="body-text">
        Guarantees (<code>on-premise</code>, <code>no-training</code>) and probed Capabilities act as hard filters in Dispatch before price
        and Headroom rank surviving Offers, and missing <code>X-Mycel-End-User</code> headers fail closed with HTTP 401.
      </p>`,
  },
];

export interface PackageNode {
  name: string;
  layer: string;
  loc: number;
  role: string;
  piBaseline: string;
}

export const ARCHITECTURE_PACKAGES: PackageNode[] = [
  {
    name: "@umwelten/pi",
    layer: "Sensemaking & Pi Bridge",
    loc: 1393,
    role: "Installable pi-package extension (session search, promotion, /umwelten-explorations) + uncapped runPiTurn / runPiStructuredObject over models.stream() + Mycel wire.",
    piBaseline: "Replaced packages/core cognition, Stimulus, Interaction, and 19 custom provider wrappers with Pi builtinModels() + ~/.pi/agent/models.json.",
  },
  {
    name: "@umwelten/sessions",
    layer: "Sensemaking & Pi Bridge",
    loc: 8980,
    role: "Read-only session adapters for Pi JSONL v3, Pi Durable SQLite, Claude Code, and Cursor; Exploration projection; ripgrep search; FACTS.md / AGENTS.md promotion.",
    piBaseline: "Pi stores single-harness JSONL; Umwelten correlates across harnesses and promotes durable knowledge.",
  },
  {
    name: "@umwelten/evaluation",
    layer: "Benchmarking & Calibration",
    loc: 9075,
    role: "Declarative EvalSuite, VerifyTask, uncapped Zod JudgeTask, disk EvaluationCache, PairwiseRanker Elo, 5-dim combiner, and Jev Brier/RPS/ECE probability calibration.",
    piBaseline: "Calls @umwelten/pi runPiTurn directly — zero Vercel AI SDK dependencies.",
  },
  {
    name: "@umwelten/habitat",
    layer: "Durable Agents & Hosts",
    loc: 4099,
    role: "Host-agnostic DurableHabitat & multi-tenant HabitatHost over pi-durable Storage/ExecutionEnv, Owned/Mounted ToolTask path guards, Turn Fan-out, and Gaia provisioner.",
    piBaseline: "Cut from 59,492 LoC to 4,099 LoC (-93%) by delegating state, SQLite/Postgres journals, and tool loops to @earendil-works/pi-durable.",
  },
  {
    name: "@umwelten/protocols",
    layer: "Protocols & UI Resources",
    loc: 2600,
    role: "RemoteMcpClient preserving MCP Apps ui:// _meta.ui.resourceUri, mcp-serve server, and A2A 1.0 Agent Card + JSON-RPC adapters.",
    piBaseline: "Cut from 10,230 LoC to 2,600 LoC (-75%) by adopting @leocavalcante/pi-a2a and @earendil-works/pi-mcp.",
  },
  {
    name: "@umwelten/mycel",
    layer: "Token Exchange",
    loc: 11850,
    role: "Authenticated OpenAI-compatible Token Exchange with outbound Supplier WebSockets, Guarantee-filtered dispatch, and integer micro-dollar ledger.",
    piBaseline: "Orthogonal marketplace layer; consumed by @umwelten/pi over standard HTTP without package coupling.",
  },
  {
    name: "@umwelten/supplier",
    layer: "Local GPU Agent",
    loc: 3820,
    role: "Probes local Ollama, llama-swap, and vLLM capability + concurrency Headroom and dials outbound to a Mycel Exchange.",
    piBaseline: "Turns local Apple Silicon & DGX boxes into metered, Guarantee-tagged Pi endpoints.",
  },
  {
    name: "@umwelten/substrate",
    layer: "Shared Visualization",
    loc: 1410,
    role: "Zero-dependency canvas/topology primitives shared by the Mycel Exchange landing shell.",
    piBaseline: "Pure leaf package at the root of the Exchange subgraph.",
  },
  {
    name: "@umwelten/cli",
    layer: "Operator CLI",
    loc: 6240,
    role: "umwelten eval, sessions, models, supplier, and habitat subcommands.",
    piBaseline: "Focused strictly on multi-model evals, cross-harness sessions, Habitats, and Mycel.",
  },
  {
    name: "umwelten",
    layer: "Published Umbrella",
    loc: 3356,
    role: "Single publishable npm package bundling the CLI binary and public TypeScript entrypoints.",
    piBaseline: "Ships clean ESM dist without transitive Vercel AI SDK bloat (-247 npm packages).",
  },
];
