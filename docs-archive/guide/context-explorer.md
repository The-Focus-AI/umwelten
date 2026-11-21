# Context Explorer

An interactive page for **turn fan-out**: ask a question, watch the answer
stream in, then watch several probes run **in parallel over that same context** —
and pick a compacted baseline to continue from.

This is the hands-on surface for [`runFanout()`](./turn-fanout.md). The API and
probe design live there; this guide is how to run the app, choose models, read
the cards, and experiment.

## Quick start

From the repo root (API keys via `.env` / `dotenvx`; Ollama needs no cloud key):

```bash
dotenvx run -- pnpm tsx examples/context-explorer/server.ts
# → http://127.0.0.1:7432

PORT=7433 dotenvx run -- pnpm tsx examples/context-explorer/server.ts
```

Open the URL, type a question, press **Ask** (or ⌘/Ctrl+Enter). The answer
streams as markdown; when it finishes, six probe cards fill in as each probe
lands.

Default models are local:

| field | default |
|---|---|
| answer | `ollama/gemma4:26b` |
| fan-out | `ollama/gemma4:26b` |

Pull the model first if needed: `ollama pull gemma4:26b`.

## What you are looking at

After every turn the page does two things with the **same message snapshot**:

1. **Answer** — the normal chat turn (`Interaction.streamText()`), optionally
   with tools.
2. **Fan-out** — `runFanout()` runs a list of probes concurrently over that
   snapshot.

Probes come in two kinds:

| kind | color | purpose |
|---|---|---|
| **annotation** | orange | Information *about* the state (title, intent, done?, open loops). Does not change the conversation. |
| **baseline** | blue | A candidate *replacement* context from a compaction strategy. **Continue from this** swaps it in as the live history. |

Each card reports latency, prompt tokens (when available), cost, and whether the
probe **shared the prefix** or **rebuilt the prompt**. Annotations send the
history verbatim plus a short question, so a provider-side prefix cache can
apply. Compaction strategies build their own summarizer prompt, so they do not
share that prefix. That distinction is the measurement the page exists to make —
nothing is constrained to make the numbers flattering.

## Choosing models

Header fields use `provider/model` (split on the **first** `/`):

```text
ollama/gemma4:26b
ollama/gemma4:12b
google/gemini-3-flash-preview
openrouter/openai/gpt-5.4-nano
lmstudio/some-local-model
llamaswap/your-swap-name
```

- **answer** — model for the chat turn.
- **fan-out** — model for every probe (unless a probe overrides in code). Leave
  blank to match answer.
- **tools** — when checked, attaches `webTools` + `mathTools` to the answer
  path only (not to probes).

### Model lock (important)

Models are **locked when a run is created**. The page:

1. Creates a run on load with whatever is in the header.
2. Shows the **locked** models in the stats bar (not just the input fields).
3. On **Ask**, if the header no longer matches the live run, starts a **new**
   run automatically so typing `ollama/…` actually takes effect.

**New run** does the same explicitly and clears the transcript view.

Status text during a turn names the models in use, e.g. `Answering with
ollama/gemma4:26b…` then `Fanning out with ollama/gemma4:26b (6 probes)…`.

### Useful splits

Run a large or cloud model for answers and a cheap/local one for fan-out:

```text
answer:   google/gemini-3-flash-preview
fan-out:  ollama/gemma4:12b
```

Local-only (privacy / cost):

```text
answer:   ollama/gemma4:26b
fan-out:  ollama/gemma4:26b
```

Fan-out fires several probes in parallel. On a single GPU they will queue —
expect higher wall time than one isolated chat turn, even when each probe is
short.

Bare model names without a `provider/` prefix fall back to the default model;
always include the provider.

## Reading a turn

1. **You** bubble — plain text of the question.
2. **Assistant** bubble — streamed markdown (headings, lists, fenced code with a
   **Copy** button on each block).
3. Meta line — context tokens before → after, answer latency, answer cost.
4. **after this turn** — probe cards as they complete.

On a baseline card, **continue from this** replaces the live interaction
messages with that probe's `replacement`. The next Ask continues from the
compacted context, not the full history. Stats update; the chosen baseline is
marked on that turn.

## Session state on disk

Each run writes under:

```text
~/.umwelten/context-explorer/<runId>/
  transcript.jsonl   # conversation in the standard session format
  fanout.jsonl       # one JSON line per turn: models, answer, every probe result
```

Override the root with `CONTEXT_EXPLORER_DIR`. `transcript.jsonl` is readable by
the rest of the session tooling. `fanout.jsonl` is for later reporting
(cost, latency, `sharedPrefix` per probe).

In-memory runs are lost on server restart; the files remain.

## Experimenting with probes

Default probes live in core:

`packages/core/src/interaction/reflection/fanout.ts` → `DEFAULT_PROBES`

| id | kind | asks / strategy |
|---|---|---|
| `title` | annotation | short title |
| `intent` | annotation | what the person is trying to do |
| `done` | annotation | finished? what remains? |
| `open-loops` | annotation | unresolved bullets, or `none` |
| `through-line-and-facts` | baseline | compaction strategy of that id |
| `truncate` | baseline | free truncate strategy |

An annotation is a label and a question:

```typescript
{
  id: "next",
  label: "What would you ask next?",
  kind: "annotation",
  question: "What is the single most useful next question? Reply with it only.",
  // optional: model: { provider: "ollama", name: "gemma4:12b" },
}
```

A baseline is a registered compaction `strategyId` (see
[Context Management](./context-management.md)). The page loads probes from
`GET /api/defaults` and sends them on `POST /api/runs`. There is no probe editor
in the UI yet — change `DEFAULT_PROBES`, or POST a custom `probes` array when
creating a run.

Unit tests for prefix identity, failure isolation, and model override:
`packages/core/src/interaction/reflection/fanout.test.ts`.

## How the app is wired

Thin on purpose. Machinery is umwelten; the example is a socket and a page.

| piece | location |
|---|---|
| turn | `Interaction.streamText()` — `@umwelten/core` |
| fan-out | `runFanout()` — `core/interaction/reflection/fanout.ts` |
| baselines | compaction registry — `core/context/registry.ts` |
| tools | `webTools` + `mathTools` — `core/stimulus/tools` |
| persistence | `writeSessionTranscript()` — `core/session-record` |
| HTTP + SSE | `examples/context-explorer/server.ts` |
| UI | `examples/context-explorer/index.html` |

Main routes:

| method | path | role |
|---|---|---|
| `GET` | `/` | page |
| `GET` | `/api/defaults` | default probes + model |
| `GET` | `/api/strategies` | registered compaction strategies |
| `POST` | `/api/runs` | create run (`answerModel`, `fanoutModel`, `useTools`, `probes`) |
| `POST` | `/api/runs/:id/ask` | SSE: answer deltas, then probes |
| `POST` | `/api/runs/:id/continue-from` | adopt a baseline (`turnIndex`, `probeId`) |
| `GET` | `/api/runs/:id/context` | current messages |

## Design notes

- **Why fan-out after every turn?** Annotations should ride a warm prefix; if that
  holds, marginal cost is mostly the short question. Whether it holds is a
  property of the backend — `sharedPrefix` records the claim; cache stats
  (e.g. llama.cpp `timings.cache_n`) turn it into a measurement.
- **Why not a separate package?** See [ADR 0010](../adr/0010-turn-fanout-in-core-not-a-package.md).
  Fan-out is reflection over an `Interaction`; baselines reuse the existing
  compaction registry rather than inventing a parallel tree.
- **API deep dive:** [Turn Fan-out](./turn-fanout.md).

## Troubleshooting

| symptom | check |
|---|---|
| Still on Google after typing `ollama/…` | Stats bar shows locked models; Ask should auto-switch. Hard-refresh if the page is stale. |
| `ollama` errors | `ollama list`, model pulled, daemon running. |
| Very slow fan-out on one GPU | Expected: several probes in parallel queue. Try a smaller fan-out model. |
| Weird tool calls in the answer | Uncheck **tools** for pure fan-out experiments. |
| Run lost after restart | Server holds runs in memory; reopen and New run. Files under `~/.umwelten/context-explorer/` remain. |
| Markdown not rendering | Page loads `marked` from a CDN; need network for first load, or check the browser console. |
