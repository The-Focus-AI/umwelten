# Context explorer

Ask a question, watch the answer stream in, then watch several probes run **in
parallel over that same context** — and pick one to continue from.

```bash
dotenvx run -- pnpm tsx examples/context-explorer/server.ts   # http://127.0.0.1:7432
PORT=7433 dotenvx run -- pnpm tsx examples/context-explorer/server.ts
```

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
answer and the fan-out. Running the fan-out on a cheap or local model while the
answer runs on a big one is the obvious thing to try.

## Where the code is

The app is thin on purpose. All of the machinery is umwelten:

| what | where |
|---|---|
| the turn | `Interaction.streamText()` — `@umwelten/core` |
| the fan-out | `runFanout()` — `core/interaction/reflection/fanout.ts` |
| baselines | the compaction registry — `core/context/registry.ts` |
| tools | `webTools` + `mathTools` — `core/stimulus/tools` |
| persistence | `writeSessionTranscript()` — `core/session-record` |

`server.ts` adds a socket and routes; `index.html` is the page. Add a probe by
editing `DEFAULT_PROBES` in `fanout.ts` — annotations are just a label and a
question.

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

## Status

Not yet run against a live provider — built in an environment without API keys,
so the server, the routes, the page and the fan-out logic are exercised by unit
tests and a boot check, but no real turn has gone through it end to end. First
real run is the test.
