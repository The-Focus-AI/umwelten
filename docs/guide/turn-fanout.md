# Turn Fan-out

After a turn completes, there are several things you'd like to know about the
conversation at once — what it is, what it's for, whether it's finished — and
several ways you *could* carry it forward in less context. `runFanout()` runs
all of them concurrently over the same state.

See [Context Management](./context-management.md) for compaction strategies and
checkpoints, which the fan-out builds on.

## Two kinds of probe

**Annotation** — information *about* the state. The conversation is sent
verbatim and one short question is appended, so the probe's prefix is identical
to the turn that just ran and to every other annotation in the batch. Returns
text; changes nothing.

**Baseline** — a candidate *replacement* context. Runs a registered compaction
strategy and returns both the summary text and a `replacement` message array the
conversation can continue from.

The distinction matters because only baselines are continuable. "What's the
title?" is worth reading; it is not a context.

## Usage

```typescript
import { runFanout, DEFAULT_PROBES } from "@umwelten/core/interaction/reflection/fanout.js";

const results = await runFanout({
  messages: interaction.messages,
  model: { name: "gemini-3-flash-preview", provider: "google" },
  probes: DEFAULT_PROBES,
  onResult: (result) => console.log(result.label, result.latencyMs),
});

for (const result of results) {
  if (result.error) continue;
  console.log(`${result.label}: ${result.text}`);
}
```

`onResult` fires as each probe lands, so a UI can render them incrementally
rather than waiting for the slowest.

### Continuing from a baseline

```typescript
const compacted = results.find((r) => r.probeId === "through-line-and-facts");
if (compacted?.replacement) {
  interaction.messages = compacted.replacement;
}
```

The next turn now runs against the compacted context.

## The default probes

| id | kind | asks |
|---|---|---|
| `title` | annotation | An eight-word title |
| `intent` | annotation | What the person is actually trying to accomplish |
| `done` | annotation | Whether it's finished, and what remains |
| `open-loops` | annotation | Anything raised and left unresolved |
| `through-line-and-facts` | baseline | Compacted to narrative plus key facts |
| `truncate` | baseline | Compacted to a placeholder |

Add your own — an annotation is a label and a question:

```typescript
const probes = [
  ...DEFAULT_PROBES,
  {
    id: "next",
    label: "What would you ask next?",
    kind: "annotation" as const,
    question: "What is the single most useful next question? Reply with it only.",
  },
];
```

A baseline is a `strategyId` naming anything in the compaction registry, so a
strategy registered for one purpose becomes a fan-out baseline at no extra cost.

## Cost, and the prefix

Every result carries `latencyMs`, `promptTokens`, `costUsd`, and `sharedPrefix`.

`sharedPrefix` is the one to watch. Annotations send the history untouched, so a
provider-side prefix cache should already be warm and each probe costs roughly
its own short question. Compaction strategies build their own summarizer prompt
from the segment — a different prefix, so a warm cache doesn't help them and
they pay full prompt evaluation.

That's the argument for fanning out after *every* turn rather than occasionally,
and it's why the flag is recorded rather than assumed. Whether it holds depends
on the backend: it's a property of how the messages are assembled, and becomes a
measurement only against a provider that reports cache statistics. llama.cpp's
`timings.cache_n` is the direct read; hosted providers mostly leave you inferring
from prompt-time deltas.

Nothing constrains a probe to share the prefix. A probe that can't is still
allowed and still measured — finding out what fanning out actually costs is the
point.

## Failure

A probe that throws comes back as a result with `error` set and empty `text`.
One failing probe never takes the others, or the turn, down with it.

## Seeing it

`examples/context-explorer/` is an interactive page built on this: ask a
question, watch the answer stream, watch the probes fill in as cards, and click
**continue from this** on any baseline to adopt it as the live context. Answer
model and fan-out model are selected separately, so running the fan-out on a
cheap or local model against a large answer model is a one-field change.

```bash
dotenvx run -- pnpm tsx examples/context-explorer/server.ts   # http://127.0.0.1:7432
```

State lands in `~/.umwelten/context-explorer/<runId>/` as `transcript.jsonl` in
the standard session format, plus `fanout.jsonl` with one line per turn.

## Design notes

See [ADR 0006](../adr/0006-turn-fanout-in-core-not-a-package.md) for why this is
a function in `reflection/` rather than a package of its own, and what was
deleted to get here.
