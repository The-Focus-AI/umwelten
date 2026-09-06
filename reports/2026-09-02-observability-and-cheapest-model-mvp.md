# Observability, evals, and "what is the cheapest model that works?"

Design proposal, 2026-09-02. Compares umwelten's current recording of model
calls against Arize Phoenix / OpenInference, OpenRouter's Activity dashboard,
and Langfuse-style tagging, then proposes an MVP that answers three questions
about any agentic session we push through the runner:

1. What did each call cost, how much of it was cache, and where did the money go?
2. Which app / user / session / tag was responsible?
3. Given a task the agent actually did, which cheaper model would have done it
   acceptably?

> **Headline:** umwelten already computes most of the numbers and then drops
> them on the floor. `BaseModelRunner.makeResult` produces tokens + cost per
> call; nothing persists it for native sessions, cache tokens are never
> normalized, pricing ignores cache rates, and there is no per-call record
> keyed by session/app/tag to aggregate over. The MVP is a single append-only
> `CompletionRecord` JSONL stream written from the one choke point that already
> exists, plus a CLI that aggregates it and a `frontier` report over
> `EvalSuite` runs. No new storage engine, no web UI, no new dependency.

## 1. What the platforms do (the model to copy)

### Arize (Phoenix / OpenInference)

Arize is the company. **Phoenix** is their open-source, self-hostable LLM
observability server (github.com/Arize-ai/phoenix); **Arize AX** is the hosted
enterprise platform on the same data model. **OpenInference** is the set of
OpenTelemetry attribute conventions Arize publishes for AI workloads; Phoenix
ingests standard OTel spans that carry them. Everything below applies to both
Phoenix and AX.

Every model call is an `LLM` span inside a trace; traces sharing `session.id`
form a session. The attribute names that matter:

| Concern | OpenInference key |
| --- | --- |
| model / provider | `llm.model_name`, `llm.provider` |
| tokens | `llm.token_count.prompt`, `.completion`, `.total` |
| cache | `llm.token_count.prompt_details.cache_read`, `.cache_write` |
| reasoning | `llm.token_count.completion_details.reasoning` |
| cost | `llm.cost.prompt`, `.completion`, `.total`, `llm.cost.prompt_details.*` |
| grouping | `session.id`, `user.id`, `tag.tags`, `metadata` |
| kind | `openinference.span.kind` = `LLM | TOOL | AGENT | CHAIN | EVALUATOR` |

Three design choices worth copying verbatim:

- **Cost is derived from a versioned pricing table, cache-aware.** Cache
  read/write tokens are priced at their own rate and *subtracted* from the
  prompt count before the remainder is priced as input. Fallback to the input
  rate when a cache rate is unknown.
- **Eval scores are separate records, not span attributes.** A
  `span_annotation` is `{name, label, score, explanation, annotator_kind}`
  pointing at a span. Human feedback and LLM judges use the same shape.
- **Experiments = dataset × task × evaluators.** A dataset example is
  `{input, output (reference), metadata}`. An experiment run is one
  `(experiment, example, repetition)` with `output, error, trace_id,
  start_time, end_time, prompt_tokens, completion_tokens`. The comparison UI
  shows mean evaluator score, latency, tokens, and cost side by side per
  experiment — "one experiment per model" is how you compare models.

### OpenRouter

Attribution is done with request headers and a body field:

- `HTTP-Referer` (required for an app page) + `X-OpenRouter-Title`
  (`X-Title` still accepted). Add `X-OpenRouter-App-Visibility: hidden` to
  keep the app out of public rankings while still getting analytics.
- `user` body field = end-user id (we already send this from
  `Interaction.userId`).
- The response `id` is a generation id; `GET /api/v1/generation?id=` returns
  native token counts, `cache_discount`, and exact cost after the fact.

Their Activity dashboard is a good spec for the *minimum* aggregate view:
total spend, requests, tokens, **cache hit rate**, **blended $/Mtok**, grouped
by model / app / user / session / API key, with drill-down to individual
generations and a per-message token flamegraph showing where the cache prefix
broke.

### Langfuse / Helicone / LangSmith (common denominator)

Every request carries `session_id`, `user_id`, `tags[]`, and free-form
`metadata`. Cost comes from a pricing table keyed by model with separate input
/ output / cache rates. "Cheapest model that passes" is always done the same
way: capture production traces → promote selected traces to a dataset →
re-run the dataset against N models → score with the same evaluator → plot
score against cost.

## 2. Where umwelten is today

### What exists

| Capability | Where | Status |
| --- | --- | --- |
| Per-call tokens + cost | `packages/core/src/cognition/runner.ts` `makeResult` → `ModelResponse.metadata` | Works. Prompt/completion only. |
| Usage normalization across providers | `packages/core/src/cognition/usage-extractor.ts` | Reads `cachedInputTokens` into the raw snapshot, **then discards it** — `normalizeTokenUsage` returns only prompt/completion/total. |
| Pricing | `ModelDetails.costs {promptTokens, completionTokens}`; `packages/core/src/costs/costs.ts` | No cache rates. OpenRouter `pricing.input_cache_read` / `input_cache_write` are available in `/models` but `packages/core/src/providers/openrouter.ts` ignores them. |
| End-user attribution | `Interaction.userId` → `buildUserProviderOptions` (`provider-options.ts`) | Sent to OpenRouter `user` and Anthropic `metadata.userId`. No `sessionId`, no `tags`, no app headers. |
| App attribution headers | — | Not set anywhere. |
| Imported session stats (Claude Code, pi, cursor) | `packages/sessions/src/sessions/inspect.ts` `stats`; `NormalizedTokenUsage {input, output, cacheRead, cacheWrite}` | Works, including cache cost breakdown — **for imported sessions only.** |
| Native/habitat transcripts | `session-record/transcript-write.ts` | JSONL entries have an `usage?: TokenUsage` slot (`interaction/types/types.ts:158`) that is **never filled**. `HabitatAgent.ask()` calls `generateText()` and throws `response.metadata` away. |
| Evals | `packages/evaluation/src/evaluation/suite.ts` | `TaskResultRecord` already has `score, maxScore, cost, durationMs, tokenUsage` per `(task, model)`; runs persist to `output/evaluations/<suite>/runs/`. `combine/` aggregates across runs. `replay.ts` rebuilds an `Interaction` from a transcript sidecar. |
| Exchange metering | `packages/mycel` `RequestRecord` (ADR 0013, 0017) | Bills at the exchange boundary; deliberately independent of `ModelResponse.metadata`. Not a tracing store. |

### The gaps, in order of pain

1. **Nothing persists per-call records for native runs.** You cannot answer
   "what did this habitat session cost yesterday" unless the session was
   produced by Claude Code.
2. **Cache is invisible** on the native path. Cache read/write counts are
   dropped in `normalizeTokenUsage`, and even if kept, `calculateCost` would
   price them as full input tokens.
3. **No grouping keys beyond `userId`.** There is no `sessionId`, `app`, or
   `tags` on the `Interaction`, so there is nothing to `GROUP BY`.
4. **No cost-vs-quality view.** `EvalSuite` records everything needed but no
   report ranks models by "cheapest that clears the bar."
5. **No path from a real session to an eval.** Production transcripts and
   eval transcripts are different shapes (`transcript.jsonl` vs
   `*.transcript.json`), so a real task the agent did cannot be re-run against
   other models without hand work.

Mycel's `RequestRecord` is *not* the answer to (1): per ADR 0017 it meters what
the exchange sold, on the exchange's own count, and only for traffic routed
through the exchange. Observability wants what the *runner* saw, for every
provider, including direct OpenRouter/Anthropic/Ollama calls.

## 3. MVP

Demo-first ordering: each step is independently useful and observable.

### Step 1 — `CompletionRecord`, one line per model call

A new module `packages/core/src/observability/` with one record type, field
names lifted from OpenInference so an OTel exporter later is a rename, not a
redesign:

```ts
export interface CompletionRecord {
  id: string;                    // uuid
  traceId: string;               // interaction.id
  sessionId?: string;            // interaction.sessionId (habitat session, eval run, etc.)
  userId?: string;               // interaction.userId
  app?: string;                  // "habitat:<name>", "cli:run", "eval:<suite>", "dialogue"
  tags: string[];                // free-form, e.g. ["task:issue-123", "probe:title"]
  kind: "llm";                   // room for "tool" in phase 2
  provider: string;
  model: string;
  reasoningEffort?: string;
  startedAt: string;             // ISO
  endedAt: string;
  durationMs: number;
  tokens: {
    prompt: number;
    completion: number;
    reasoning?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total: number;
  };
  cost?: {
    prompt: number;
    completion: number;
    cacheRead?: number;
    cacheWrite?: number;
    total: number;
    source: "pricing-table" | "provider-reported";
  };
  finishReason?: string;
  toolCallCount: number;
  steps: number;                 // agent-loop steps in this call
  error?: string;
  providerRequestId?: string;    // OpenRouter generation id → /api/v1/generation for reconciliation
  usageRaw?: Record<string, unknown>; // exact provider usage object, for reconciliation
}
```

A `CompletionSink` interface (`record(r: CompletionRecord): void`) with one
implementation for the MVP: `JsonlCompletionSink`, appending to
`.umwelten/completions/YYYY-MM-DD.jsonl` in the project. Project-local,
human-readable, hand-editable — matches CONTEXT.md. Streams that are not tied
to a project (bare `umwelten run`) fall back to `~/.umwelten/completions/`.

**Emit point:** `BaseModelRunner.makeResult` (`runner.ts` ~L651). It is the
single place every `generateText` / `streamText` / `generateObject` /
`streamObject` result passes through and already has the interaction, usage,
cost, and timings in hand. Error paths (`handleError`) emit a record with
`error` set and whatever partial usage exists — a burned-prompt call is still
spend.

Wiring: `ModelRunnerConfig.sink?: CompletionSink`; `Interaction.createRunner()`
passes a process-wide default sink resolved once (env `UMWELTEN_TRACE=0`
disables). Tests use an in-memory sink.

Also fill the existing `usage` slot on assistant entries in
`transcript-write.ts` from the same data, so `sessions stats` works on native
habitat transcripts for free.

### Step 2 — cache-aware tokens and pricing

- `TokenUsageSchema` (`costs.ts`) gains `cacheReadTokens?`,
  `cacheWriteTokens?`, `reasoningTokens?`.
- `normalizeTokenUsage` (`usage-extractor.ts`) maps
  `cachedInputTokens` / `cache_read_input_tokens` / `prompt_tokens_details.cached_tokens`
  → `cacheReadTokens`, and `cache_creation_input_tokens` → `cacheWriteTokens`.
- `ModelDetails.costs` gains `cacheReadTokens?`, `cacheWriteTokens?` (per
  million). `openrouter.ts` reads `pricing.input_cache_read` /
  `input_cache_write`; Anthropic direct uses the published 0.1× / 1.25×
  multipliers when the provider returns nothing.
- `calculateCost` follows Phoenix: price cache tokens at their rate, subtract
  them from prompt before pricing the remainder, fall back to input rate when a
  cache rate is missing. Existing `cost.promptCost` stays as the sum so no
  caller changes.

This is the one step that changes an existing schema; every current consumer
of `TokenUsage` and `costs` keeps working because the new fields are optional.

### Step 3 — grouping keys and provider attribution

- `Interaction` gains `sessionId?: string`, `app?: string`, `tags: string[]`
  alongside `userId`. Habitat sets `sessionId` from its session dir and
  `app = "habitat:<name>"`; `EvalSuite` sets `sessionId = runId`,
  `app = "eval:<suite>"`, `tags = ["task:<id>"]`; the CLI sets `app = "cli:run"`.
- `createOpenRouterModel` sends default headers
  `HTTP-Referer: https://umwelten.thefocus.ai`,
  `X-OpenRouter-Title: <app ?? "umwelten">`,
  `X-OpenRouter-App-Visibility: hidden` (configurable via
  `UMWELTEN_OPENROUTER_PUBLIC=1`). Cheap, and it makes OpenRouter's own
  Activity dashboard a second, independent view of the same spend.
- Capture the OpenRouter generation id from `response.response.id` into
  `providerRequestId`.

### Step 3b — opt-in Phoenix, without writing an exporter

Recommendation: **do not hand-roll an OTLP/OpenInference exporter** from
`CompletionRecord`. AI SDK 7 emits OpenTelemetry GenAI spans natively
(`gen_ai.usage.input_tokens`, `gen_ai.usage.cache_read.input_tokens`, …) once
`registerTelemetry(new OpenTelemetry({ usage: true }))` from `@ai-sdk/otel` is
called, and Arize maintains `@arizeai/openinference-vercel` (3.1.x, AI SDK 7)
whose span processor maps those to OpenInference — including
`cache_read → llm.token_count.prompt_details.cache_read`.

One setup module, `packages/core/src/observability/phoenix.ts`, gated on
`PHOENIX_COLLECTOR_ENDPOINT` (the env Phoenix's own clients use):

```ts
const provider = new NodeTracerProvider({
  spanProcessors: [
    new OpenInferenceBatchSpanProcessor({
      exporter: new OTLPTraceExporter({ url: process.env.PHOENIX_COLLECTOR_ENDPOINT }),
    }),
  ],
});
provider.register();
registerTelemetry(new OpenTelemetry({ usage: true, runtimeContext: true }));
```

In `BaseModelRunner`, wrap the model call in OpenInference's `setSession` /
`setUser` context helpers so `session.id` / `user.id` come from the same
`Interaction` fields as `CompletionRecord`. Deps: `@ai-sdk/otel`,
`@opentelemetry/sdk-trace-node`, `@opentelemetry/exporter-trace-otlp-proto`,
`@arizeai/openinference-vercel`. ~0.5 day.

Division of labor: the JSONL `CompletionRecord` is umwelten's source of truth
and the input to `usage` / `frontier` / `to-dataset`; Phoenix is an optional
viewer that adds per-step tool spans, message contents, and the trace-tree /
session UI for free. Both see only calls through `BaseModelRunner`; sessions
from `claude-sdk-runner` / `pi-runner` arrive via the sessions import path.
Phoenix's datasets/experiments API is deliberately not used — `EvalSuite`
already fills that role.

### Step 4 — `umwelten usage` CLI

Reads the JSONL stream (no index; `rg`-and-parse is fine at this volume, same
stance as ADR 0002).

```
umwelten usage summary [--since 7d] [--by model|app|user|session|tag|day]
  → requests, prompt/completion/cache tokens, cache hit %, cost, blended $/Mtok

umwelten usage session <sessionId>
  → one row per call: time, model, tokens, cache %, cost, tools, duration
  → where the cache prefix broke (cacheRead dropped between consecutive calls)

umwelten usage top [--by model] [--limit 10]
```

`--json` on all of them. This gives the OpenRouter Activity view over every
provider, project-locally.

### Step 5 — `eval frontier`: cheapest model that clears the bar

New report in `packages/evaluation/src/evaluation/combine/` reading existing
`TaskResultRecord`s:

```
umwelten eval frontier <suite> [--min-score 0.8] [--metric mean|pass-rate]
```

Per model: mean normalized score, pass rate, total cost, p50 latency, cost per
passing task. Output the Pareto frontier (no model is both cheaper and better)
and the single answer: **cheapest model with pass rate ≥ threshold**. Markdown
table + `--json`. Nothing new is recorded; this is a pure function of data
`EvalSuite` already writes.

### Step 6 — from a real session to an eval dataset

`umwelten usage to-dataset <sessionId> --out evals/<name>.ts`:

- For each `CompletionRecord` in the session with a persisted transcript,
  build an `EvalTask` whose `prompt` is the last user turn, whose stimulus is
  the interaction's system context (via `replay.ts`), and whose reference
  output is what the original (expensive) model produced.
- Default `judge`: "does the candidate reach the same conclusion / produce an
  equivalent result as the reference" — `JudgeTask` already supports this
  shape.

Then `umwelten eval run <dataset> --all` + `eval frontier` closes the loop the
user asked for: *we used Fable for this; would Terra have done?* This is the
Phoenix "traces → dataset → experiment" path with our existing pieces.

## 4. What it costs to build

| Step | Touches | Size |
| --- | --- | --- |
| 1 CompletionRecord + JSONL sink + emit from `makeResult` + fill transcript `usage` | `core/observability/*` (new), `runner.ts`, `interaction.ts`, `transcript-write.ts` | ~1 day |
| 2 cache-aware usage + pricing | `costs.ts`, `usage-extractor.ts`, `types.ts`, `providers/openrouter.ts`, tests in `usage-extractor.test.ts` | ~0.5 day |
| 3 sessionId/app/tags + OpenRouter headers | `interaction.ts`, `provider-options.ts`, `providers/openrouter.ts`, habitat/eval/cli call sites | ~0.5 day |
| 4 `usage` CLI | `packages/cli/src/usage.ts` (new), register in `cli.ts` | ~1 day |
| 5 `eval frontier` | `evaluation/combine/frontier.ts` (new), `cli/eval.ts` | ~0.5 day |
| 6 `to-dataset` | `cli/usage.ts`, reuse `replay.ts` | ~1 day |

Roughly a week for the whole loop; Steps 1–2 alone (~1.5 days) already make
cost and cache visible for every native session.

Verification per step:

- 1: run `umwelten run -p "hi" --stats` and a habitat turn; assert one JSONL
  line each with matching tokens; unit test with in-memory sink covering
  success, error, and aborted stream.
- 2: extend `usage-extractor.test.ts` with Anthropic cache-shaped and OpenAI
  `prompt_tokens_details.cached_tokens` fixtures; assert `calculateCost`
  prices cache below input rate.
- 4/5: golden-file tests over a fixture `completions/*.jsonl` and a fixture
  eval run dir.

## 5. Deliberately out of the MVP

- **A custom OTel exporter.** Phoenix is reached via AI SDK telemetry +
  `@arizeai/openinference-vercel` (Step 3b); we never map fields ourselves.
- **Phoenix as the only store.** It is a server; the CLI and habitat
  containers must keep working without one.
- **SQLite or a server of our own.** JSONL + `rg` suffices at project scale and
  keeps the `.umwelten/` "hand-editable" promise. Revisit if `usage summary`
  gets slow.
- **Tool spans in `CompletionRecord`.** `toolCallCount` and `steps` cover the
  MVP; per-step tool spans come free from the AI SDK telemetry when Phoenix
  is enabled.
- **Web UI.** The TUI/`browse` surface can render `usage session` later.
- **Reconciling against OpenRouter `/generation`.** We store
  `providerRequestId` so a batch reconciler can be added; the mycel exchange
  keeps its own metering per ADR 0017 and is unaffected.

## 6. Decisions to veto

- Store under `.umwelten/completions/` as daily JSONL (vs one file per session).
  Daily files make `--since` cheap and keep any one file small.
- Emit from `makeResult` rather than a `StreamObserver`: observers are
  per-call and optional; `makeResult` is unconditional and already has cost.
- `sessionId`/`app`/`tags` live directly on `Interaction` rather than a
  nested `attribution` object, matching where `userId` already lives.
- OpenRouter app visibility defaults to `hidden`.
- Cost `source` is recorded so a later provider-reported (exact) cost can
  coexist with table-estimated cost without ambiguity.
