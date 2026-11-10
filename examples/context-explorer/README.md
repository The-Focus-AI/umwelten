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

## Read-only collaboration traces

Set `COLLABORATION_DIR` to the directory containing collaboration run directories,
then open **Collaboration traces ↗** in the explorer header. It opens a separate
tab at `/collaboration`, leaving the live probe conversation in place.

```bash
COLLABORATION_DIR=/path/to/collaboration-runs pnpm tsx examples/context-explorer/server.ts
```

This inspector requires **Node.js 22.13+ with `node:sqlite` enabled**. It opens
SQLite with `DatabaseSync({ readOnly: true })`; no new dependency or model API
key is needed for inspection. The original context explorer retains its existing
runtime requirements. SQLite is loaded only when a trace is requested.

Expected storage layout:

```text
COLLABORATION_DIR/
  <UUID run ID>/
    collaboration.sqlite  # events, agents, artifacts tables
    blobs/<sha256>        # artifact content
```

Select a run, then inspect:

- **Agent branches:** parentage, depth, models, status, task, and full persisted
  state. Select an agent to filter decisions, communications, and calls.
- **Decisions:** recorded messages, tools, options, delivered event IDs, output,
  completion messages, and usage. Incomplete decisions remain visible.
- **Communications & events:** append order by event ID, timestamps, causes,
  message senders/recipients, and spawn context (`fresh`, `summary`, or `fork`).
- **Artifacts:** all run artifacts and historical publication versions, hashes,
  and plain-text previews (UTF-8, at most 1 MiB). Artifact markup is never rendered.
- **Cost & calls:** totals from `call.completed` only, with estimated, failed,
  and unpriced calls distinguished. Decision usage is not counted twice.

Refresh manually to read a new consistent database snapshot. The inspector reads
the whole trace, so it is intended for local inspection, not very large traces.
It never resumes agents, runs tools, sends messages, or mutates run data.

The GET-only API is `/api/collaboration/runs`,
`/api/collaboration/runs/<UUID>`, and
`/api/collaboration/runs/<UUID>/blobs/<sha256>`. Browser input cannot select a
filesystem path. Symlinks beneath the configured root are rejected; blob hashes
must be referenced by that run. Configure a trusted storage root and keep the
server private: traces may contain sensitive model inputs, tool results, or
artifacts. This local example does not add authentication or redact trace data.
It does not expose environment variables or database error paths.

### Verify without a model

```bash
pnpm exec tsx --test examples/context-explorer/collaboration.test.ts

# Creates nonsensitive synthetic data in a new OS temporary directory:
COLLABORATION_DIR=$(pnpm exec tsx examples/context-explorer/collaboration-fixture.ts)
export COLLABORATION_DIR
pnpm tsx examples/context-explorer/server.ts
```

The fixture includes a completed decision, an incomplete decision, fork/fresh
branches, direct messages, two artifact versions, and both estimated and failed
calls. Expected totals: **2 calls, 400 tokens, $0.002000**, despite the deliberately
different decision usage. Delete the printed temporary directory after inspection.
In an Amp orb, start the server with `amp orb service start ... --portal` rather
than a foreground shell command, using the generated directory in its environment.
