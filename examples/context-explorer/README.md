# Context explorer

Ask a question, watch the answer stream in as markdown, then watch several probes
run **in parallel over that same context** — and pick one to continue from.

Full guide: [docs/guide/context-explorer.md](../../docs/guide/context-explorer.md)
(API / design: [docs/guide/turn-fanout.md](../../docs/guide/turn-fanout.md)).

```bash
dotenvx run -- pnpm tsx examples/context-explorer/server.ts   # http://127.0.0.1:7432
PORT=7433 dotenvx run -- pnpm tsx examples/context-explorer/server.ts
```

Defaults: answer and fan-out both `ollama/gemma4:26b` (requires Ollama with that
model pulled). Override in the header with `provider/model`.

## What it's for

At the end of every turn there are questions you'd like answered about the state
of the conversation — what is this, what were we trying to do, is it finished —
and there are candidate *replacements* for the context you're carrying. This runs
both, side by side, after every turn, so you can see what the model thinks the
state is and what it would look like compacted.

Two kinds of probe:

- **annotation** (orange) — information *about* the state. Sends the
  conversation verbatim and appends one short question, so the prefix is
  identical to the turn that just ran and identical across every other
  annotation.
- **baseline** (blue) — a candidate context. Runs a registered compaction
  strategy and gives you a **continue from this** button that swaps it in as the
  live context.

Each card reports latency, prompt tokens, cost, and whether it **shared the
prefix** or **rebuilt the prompt**. That last one is the interesting number:
annotations should ride a warm cache, compaction strategies build their own
summarizer prompt and pay full price. Nothing is constrained to make that come
out well — the point is to find out.

Both models are selectable in the header (`provider/model`), separately for the
answer and the fan-out. The stats bar shows the models **locked for the current
run**; changing the header and clicking Ask (or New run) starts a run with the
new selection.

## Where the code is

The app is thin on purpose. All of the machinery is umwelten:

| what | where |
|---|---|
| the turn | `Interaction.streamText()` — `@umwelten/core` |
| the fan-out | `runFanout()` — `core/interaction/reflection/fanout.ts` |
| baselines | the compaction registry — `core/context/registry.ts` |
| tools | `webTools` + `mathTools` — `core/stimulus/tools` |
| persistence | `writeSessionTranscript()` — `core/session-record` |

`server.ts` adds a socket and routes; `index.html` is the page (markdown via
`marked`, copy buttons on fenced code). Add a probe by editing `DEFAULT_PROBES`
in `fanout.ts` — annotations are just a label and a question.

## State

Each run writes a session directory:

```
~/.umwelten/context-explorer/<runId>/
  transcript.jsonl   # the conversation, in the standard session format
  fanout.jsonl       # one line per turn: every probe result, with cost and timing
```

`transcript.jsonl` is the same format the rest of the session tooling reads.
`fanout.jsonl` is what a report gets built from. Override the root with
`CONTEXT_EXPLORER_DIR`.
