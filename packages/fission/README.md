# @umwelten/fission

A conversation is a tree, not a line.

This package runs an experimental chat where every turn is scored for topic
drift, compacted, and — when it reads as the start of something new — spun off
into its own thread seeded with only what it needs from the parent. A web
browser lets you walk the tree, see what the detector thought at each step, and
re-run any compaction strategy at any point to compare them.

```bash
# talk to it, watching every decision
dotenvx run -- pnpm run cli fission chat

# walk the tree, play with strategies, label decisions
dotenvx run -- pnpm run cli fission serve      # http://127.0.0.1:7431

# write the standalone report
dotenvx run -- pnpm run cli fission report -o report.html
```

## The turn loop

Every user turn runs the same six steps:

1. **Detect.** Score the turn for drift against the node it landed in. The
   active detector decides; any shadow detectors score the same turn without
   acting, so cheap ones can be compared against expensive ones for free.
2. **Fork.** If the detector says so, create a child seeded with a
   query-conditioned carry-over of the parent. The parent is left untouched.
3. **Answer**, in whichever node the turn ended up in.
4. **Analyse** the exchange into a summary, facts, and topic labels.
5. **Compact** the node's context.
6. **Record** everything on an append-only `TurnRecord`.

Detection runs *before* the answer on purpose. Forking afterwards would put the
new thread's first exchange in the old thread's context — the exact thing
fission exists to prevent.

## Detectors

| id | model call? | what it does |
|---|---|---|
| `lexical-drift` | no | Vocabulary overlap against the node and its recent turns, plus pivot phrases ("new topic:") and back-reference markers ("that", "why?") that argue *against* a fork. |
| `llm-judge` | yes | Classifies the turn as continuation / elaboration / tangent / new-topic. The 0–1 score is derived from that label and the model's confidence, not asked for directly. |
| `hybrid` | sometimes | Runs the lexical detector first; escalates to the judge only when the score lands in the ambiguous band between 0.3 and 0.85. **Default.** |
| `never` | no | Control. The one-long-chat baseline. |

Two guards in `lexical-drift` matter more than the weights: a node with no
turns can't be drifted from, and a turn with fewer than three content words
("why?", "keep going") is never a fork. Scoring those on cosine distance alone
is what makes naive drift detection fire constantly mid-thread.

Register your own with `registerDetector()`.

## Compaction strategies

These register into **core's** shared registry, so anything that already calls
`interaction.compactContext(id)` can use them too.

| id | model call? | what it does |
|---|---|---|
| `rolling-summary` | yes | A four-section state record (through-line / established / open loops / recent detail) written to be re-run every turn without degrading. |
| `topic-carryover` | yes | Query-conditioned handoff brief for a spun-off thread — pass `options.newTopic`. Keeps only what the new subject depends on. |
| `recent-window` | no | Keep the last N messages verbatim, drop the rest. The floor of the comparison. |
| `through-line-and-facts` | yes | From core. Occasional-use summarizer. |
| `truncate` | no | From core. One-line placeholder. |

`keepRecentMessages` leaves a tail verbatim. Compacting *everything* every turn
makes short follow-ups unanswerable, because the thing they refer to only
survives as a summary line.

## The browser

`fission serve` gives you three columns: the thread tree, the selected thread's
turns, and an inspector.

- Each turn shows the verdict, the drift score against the threshold, every
  signal that fed it, and what each shadow detector would have decided.
- **Label any decision** with "should continue" / "should fork". Those labels
  are the only thing that makes the report's accuracy column real.
- The **compaction playground** re-runs any strategy against the node's
  *rebuilt raw context* as of that turn, so every strategy is measured on
  byte-identical input rather than on whatever the live context happened to
  hold.
- Config changes (detector, threshold, strategies) apply to the next turn.

## The report

`fission report` writes a self-contained HTML file — no CDN, no build step —
publishable to `artifacts.thefocus.ai` as-is. It covers:

- **Prompt tokens sent, cumulative**, against the counterfactual of one long
  uncompacted chat. Every turn re-sends its whole context, so what a strategy
  costs is the sum of context sizes across turns, not the size at the end.
- **Detector agreement** — how often each detector matched the one that decided.
- **Detector accuracy** — over labeled turns only, with the label count shown,
  because four labels is not a measurement and the table says so.
- **Compaction ratios**, live and playground runs separated.
- Every fork, with the reason that caused it.

## Storage

```
~/.umwelten/fission/<treeId>/
  tree.json           # metadata + nodes
  turns.jsonl         # one TurnRecord per line, append-only
  nodes/<nodeId>.json # that node's live (post-compaction) message array
```

`turns.jsonl` is append-only so a live run is crash-safe and replayable —
every turn records the detector's reasoning, every shadow verdict, the
compaction that ran, and the token deltas. Nothing needs a model call to
re-score offline. Override the root with `UMWELTEN_FISSION_DIR`.

## Status

The engine, detectors, strategies, browser, and report are complete and unit
tested (90 tests, no network). What has **not** happened yet is a run against a
real provider — this was built in an environment without API keys, so the
numbers in any report you generate are the first real numbers this has produced.

Detector thresholds are reasoned, not tuned. `driftThreshold` 0.6 and the
hybrid gates at 0.3/0.85 are starting points; label a few dozen turns in the
browser and the report will tell you where they actually belong.
