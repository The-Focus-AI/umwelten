# 0006 — Turn fan-out lives in core reflection, not its own package

Status: **Accepted**
Date: 2026-07-25

> Pinned down in a grilling session, after a first attempt that got it wrong.

## Context

We wanted an interactive way to see what happens to a conversation's context
after every turn: ask a question, watch the answer, then immediately run several
things over the same state — what is this, what were we trying to do, is it
done, and what would this look like compacted — and be able to carry on from one
of the compacted versions.

The first implementation of this shipped as `@umwelten/fission`: a new workspace
package with its own conversation tree (`FissionTree` / `FissionNode`), its own
storage under `~/.umwelten/fission/`, its own compaction strategies, a topic-drift
detector that decided when to fork automatically, and a separate web browser and
HTML report. It was deleted before this ADR was written.

It was wrong on three counts.

**The vocabulary already existed.** `CONTEXT.md` defines an **Exploration** as
Interactions "connected by relationships such as forks, handoffs, alternatives",
and its *Avoid* list names "session tree" explicitly. ADR 0001 had already ruled
that branching semantics project into an Exploration graph while an
**Interaction** stays flat and model-facing. "Fission" was an invented synonym
for **fork**, and `FissionTree` was an Exploration under a second name.

**The mechanism already existed.** `session-record/` implements repeated
compaction as frozen transcript segments (`compactHabitatTranscriptSegment`,
`CompactionEventV1`) plus typed append-only learnings (`FileLearningsStore`, with
kinds `facts` and `open_loops` among others), reassembled into context by
`buildHabitatIntrospectionContextMessages`. The `fission` package's
`rolling-summary` strategy solved the same problem by re-summarizing prose every
turn, with a prompt asking the model not to summarize its own summary — strictly
worse than freezing a segment and accumulating typed records.

**The interesting thing was somewhere else.** Automatic drift detection turned
out not to be what we wanted. What we wanted was to *see several candidate
states at once* and choose. That needs no detector at all.

## Decision

There is no new package and no new noun. Two additions:

1. **`runFanout()` in `packages/core/src/interaction/reflection/`.** Given the
   conversation so far, it runs a list of probes concurrently. A probe is either
   an **annotation** — a short question sent after the verbatim history, yielding
   information *about* the state — or a **baseline** — a registered compaction
   strategy, yielding a candidate context the conversation can continue from.
   It sits in `reflection/` because asking questions about an Interaction is
   already what **Reflection** means in this codebase.

2. **`examples/context-explorer/`.** The app: a socket and a page. It owns no
   machinery. The turn runs through `Interaction.streamText()`, the probes
   through `runFanout()`, the baselines through the existing compaction
   registry, and the state lands in a session directory via
   `writeSessionTranscript()`.

Each probe result records latency, prompt tokens, cost, and whether it **shared
the prefix** or **rebuilt the prompt**. Annotations send the history untouched
and append one short question, so their prefix is identical to the turn that
just ran and to each other; compaction strategies build their own summarizer
prompt and do not. Nothing enforces prefix sharing — which probes are cheap in
practice is the measurement, not the premise.

## Consequences

Fan-out output is readable by the existing session tooling, because it is a
session. New probes are a label and a question in `DEFAULT_PROBES`. Compaction
strategies registered anywhere become baselines for free, and any strategy added
for the fan-out is equally available to `interaction.compactContext()`.

The cost is that `runFanout` lives in core rather than somewhere more
experimental, so it carries core's compatibility expectations. That is the right
trade for not maintaining a second vocabulary for forks and a second store for
sessions.

Nothing in this ADR has been run against a live provider yet. The prefix-sharing
claim is a property of how the messages are assembled, verified by unit test; it
becomes a *measurement* only against a backend that reports cache statistics
(llama.cpp's `timings.cache_n`), which is the next step.
