# Multi-agent collaboration experiments

Run independent agents on the same or different models, let them spawn children,
exchange messages, and publish shared artifacts. All agent operations are ordinary
AI SDK tools. Habitat's existing `agent-runner` tool set registers the operator
tools; each participant gets an identity-bound collaboration tool registry.

This is a **local, bounded experiment runtime**, not a distributed job service.
It reuses `Interaction` and the context-compaction registry. `Dialogue` remains
the sequential, fixed-roster alternative (`umwelten converse`).

## Quick start

From the repository root, install with `pnpm install`. The deterministic smoke
run needs no provider credentials and makes no model requests:

```bash
pnpm exec tsx examples/collaboration/run.ts --scripted --context fork
pnpm exec tsx examples/collaboration/run.ts --scripted --context summary
pnpm exec tsx examples/collaboration/run.ts --scripted --context fresh
pnpm exec tsx examples/collaboration/run.ts --scripted --single
```

Each creates a unique directory under `.umwelten/collaborations/` containing the
SQLite journal, content-addressed artifacts, `trace.jsonl`, and `evaluation.json`.
The check is independent of the agent output: the sum of squares of 3, 5, 11, 17
must equal **444**. A missing, malformed, or incorrect `answer.json` exits nonzero.
Scripted success validates the plumbing, **not model intelligence or emergent
collaboration**. Scripted usage numbers are synthetic and marked by the evaluation.

For actual model experiments, configure your provider key in `.env`, then run:

```bash
dotenvx run -- pnpm exec tsx examples/collaboration/run.ts \
  --provider openrouter --model google/gemini-3.1-flash-lite --context summary

# Same task and call/token limits, one agent and no children:
dotenvx run -- pnpm exec tsx examples/collaboration/run.ts \
  --provider openrouter --model google/gemini-3.1-flash-lite --single
```

These commands spend provider credits. Model availability is provider-dependent.
`--dir <new-directory>` selects storage; an existing run is never overwritten.
Two real-model roots start without prescribed roles and may choose collaborators;
the requested inheritance mode is a prompt instruction, not a forced topology.

### Independently checked live demonstration

`e2e.ts` uses the real model runner, a random challenge and nonce, and a prescribed
coordinator/worker protocol. The checker computes the expected answer separately;
it never supplies the answer to either agent. This demonstrates the tool protocol,
not emergent teamwork or a quality advantage over a single agent.

For Mycel, supply `MYCEL_API_KEY` through your secret manager (never in a command
argument or transcript), then run:

```bash
export MYCEL_URL=https://mycel.thefocus.ai
export MYCEL_END_USER=collaboration-e2e
for context in fresh fork summary; do
  pnpm exec tsx examples/collaboration/e2e.ts \
    --provider mycel --model qwen3.8-flash-next --context "$context" || break
done
```

Model availability and pricing can change; inspect Mycel's catalogue first.
The run allows two agents, 24 calls, 300000 tokens, and 15 minutes. It checks
child spawning, child-owned publication, explicit messaging, coordinator
readback, completion, artifact hashes/version conflicts/path safety, redacted
training samples, close/reopen durability, and the read-only inspector API.

Each UUID directory under `.umwelten/e2e/` contains `verification.json`,
`trace.jsonl`, `training.jsonl` on success, the SQLite journal, and artifact blobs.
`provider-http.jsonl` captures request/response bodies for localhost or the
configured Mycel origin, without HTTP headers or credentials. It preserves real
provider outputs; the runtime journal alone is not wire-level evidence. Other
remote providers are not captured. The private marker in this demo is synthetic;
the training export redacts it, while the raw trace intentionally retains it.
Review all exports before sharing. Failed runs exit nonzero and retain evidence.

Point the inspector's `COLLABORATION_DIR` at `.umwelten/e2e` to inspect these runs.
A recording of that inspector illustrates persisted/live snapshots; the executed
assertions and provider responses are the evidence of model behavior.

### Longer Mycel experiment

With `MYCEL_API_KEY` configured, run:

```bash
pnpm exec tsx examples/collaboration/long-run.ts
```

This uses `deepseek/deepseek-v4.1-flash` through Mycel, checking the live
catalogue for tool calling and prices first. A coordinator spawns three warehouse
workers with fresh, fork, and summary context. The same agents reconcile three
successive inventory snapshots, publish versioned regional and consolidated
reports, explain changes via messages, wait between rounds, and finish after the
third round. Each new snapshot replaces the previous one; it is not a delta.
The checker independently verifies every region, consolidated quantities and
value, batch ID, round, artifact version, and waiting/finished states.

Limits are four agents, concurrency three, 100 calls, 600000 tokens, 15 minutes,
and $0.50 estimated cost admission (not a guaranteed provider billing ceiling).
Synthetic source data, provider bodies without headers, journal, and per-round
verification are saved under `.umwelten/e2e/<UUID>`, visible in the same inspector.
Incorrect outputs remain failures even when agents continue into later rounds;
early termination stops the experiment. Only fully passing runs export training
samples. This is an exploratory protocol test, not a reliability estimate or a
controlled comparison of context strategies, which have different assignments.

### Read a writer/reviewer conversation

Run `pnpm exec tsx examples/collaboration/writer-reviewer.ts` with `MYCEL_API_KEY`
configured. A writer proposes a fictional café opening-hours experiment, spawns
a fresh-context reviewer, reads the critique, revises, and receives a final
assessment. The brief and roles are prescribed; all draft and review content is
generated live using `deepseek/deepseek-v4.1-flash` through Mycel.

Start with `.umwelten/e2e/<UUID>/transcript.md`: it shows the assignment, both
drafts, critiques, and their public messages in order, labeled Writer and Reviewer
rather than UUIDs. `verification.json` checks workflow completion and authorship,
not proposal quality. Judge the actual texts; reviewer approval is not independent
proof of correctness. The run is capped at 36 calls, 250000 tokens, ten minutes,
and $0.25 estimated cost admission. Raw provider bodies and the journal are saved
alongside the transcript, without HTTP credentials or headers.

## Use from TypeScript

```ts
import { CollaborationRun } from '@umwelten/habitat/collaboration/runtime.js';

const run = new CollaborationRun('./my-experiment', {
  limits: {
    maxAgents: 6, maxDepth: 2, concurrency: 2,
    maxCalls: 40, maxTotalTokens: 100_000,
    maxDurationMs: 180_000, maxOutputTokens: 2048,
  },
});

const alice = run.addAgent({
  model: { provider: 'openrouter', name: 'google/gemini-3.1-flash-lite' },
  task: 'Investigate the supplied evidence. Coordinate with peers and publish findings.md.',
});
run.addAgent({
  model: { provider: 'openrouter', name: 'openai/gpt-5-mini' },
  task: 'Investigate the supplied evidence. Coordinate with peers and verify findings.md.',
});

run.publish(null, 'evidence.txt', 'The source material for this experiment…', 0);
run.send(null, alice, 'Read evidence.txt with agent_read before starting.');
run.start();
await run.waitForIdle();
console.log(run.status(), run.store.artifact('findings.md'));
await run.close();
```

`send`/`publish` also schedule eligible agents. Add all initial roots before
injecting observations if the initial roster must be complete. A normal text
response is private; only explicit messages and published artifacts are shared.
Agents receive no shell, network, arbitrary filesystem, or unrestricted Habitat
delegation tools. Supply evidence as artifacts or task text. This limits the
experiment's side effects and prevents delegation outside its budget.

## Habitat operator tools

These are included in the existing `agent-runner` tool set:

| Tool | Purpose |
| --- | --- |
| `collaboration_start` | Start roots with tasks, optional models/instructions, and limits; return immediately |
| `collaboration_inspect` | Status, up to 100 ordered trace events after a cursor, optional artifact/version |
| `collaboration_send` | Inject an operator message into an agent or channel |
| `collaboration_publish` | Publish an operator artifact with a version precondition |
| `collaboration_resume` | Explicitly reopen a persisted run after host restart |
| `collaboration_stop` | Permanently stop the run and abort in-flight requests |

Example tool arguments:

```json
{
  "templateAgentId": "backend",
  "agents": [
    { "task": "Investigate the supplied proposal and publish your findings." },
    { "task": "Investigate the supplied proposal; seek and verify peer evidence." }
  ],
  "limits": { "maxAgents": 4, "maxCalls": 24, "concurrency": 2 }
}
```

The template must be an existing managed agent. It supplies the default model,
**not its private history, persona, or unrestricted tools**. Set per-root
`instructions` explicitly. Storage is `<habitat-work-dir>/collaborations/<runId>`.
Keep the Habitat host process running while its experiments run.

Operator inspection can see private histories. It is deliberately not in the
participant tool registry. Do not expose operator tools to untrusted users.

## Participant tools

| Tool | Inputs and behavior |
| --- | --- |
| `agent_spawn` | `task`, `context`, optional `model`, `maxSummaryTokens`; returns child ID after context preparation, without waiting for child completion |
| `agent_send` | `to` = exact agent ID or `channel:name`, `message`; persists before waking recipients |
| `agent_read` | Optional `channel` (default `main`), exclusive event cursor `after`, artifact `path` and `version`; returns public roster, own direct messages and selected public channel, optional artifact |
| `agent_publish` | Logical `path`, `content`, `expectedVersion`; immutable versions, conflict on stale version |
| `agent_wait` | `channels` (default `main`, `artifacts`); yields until a direct message or subscribed event |
| `agent_finish` | `result`; permanently finishes and messages a nonterminal parent |

Every identity is captured by the host tool closure; the model cannot choose
another sender identity. Channels are public discovery surfaces, not ACLs.
Direct inboxes and private model histories are not readable by peers. The peer
roster includes identities, lineage, models, and status, not private tasks.

Each decision is one SDK tool step. Independent agents can run concurrently;
the scheduler never runs two decisions against one agent's history. Multiple
tools emitted in a decision may execute concurrently. Calls after `wait` or
`finish` are rejected; issue these separately from other work. Calls already
admitted before yielding can finish. Waiting consumes no model requests.

The scheduler records a delivery cursor before the decision starts. Messages
arriving while that decision is running remain eligible for the next decision,
including when the decision calls `wait`. A message already delivered does not
wake the agent again. `agent_read` does not change automatic delivery cursors.
Read results are capped at 100 events; continue from the last returned event ID.

## Fresh, summary, and fork contexts

Every child has a separate writable `Interaction`, its own identity, and a copy
of the parent's configured instructions. A model override can change provider.

* **fresh:** only the new task and configured instructions; no conversation history.
* **summary:** the registered `task-handoff` strategy summarizes the parent's
  decision-input snapshot, recording its original source event and the exact
  summarizer input/output. This additional model call counts against the run.
* **fork:** copies that snapshot's conversation messages, not mutable objects or
  hidden model state. The current spawning tool call is not inherited. System
  instructions are rebuilt for the child, and provider options/reasoning parts
  are removed for cross-model portability. Provider compatibility still varies.

The snapshot is taken **before the spawning decision**, so sibling tool results
from that same decision are not included. Send additional evidence explicitly.
Children can communicate with peers, siblings, and parents regardless of lineage.

Summary preparation quotes the snapshot as data with an explicit boundary marker
that does not claim pending work is complete. This handles a parent snapshot
ending in unanswered input or a completed tool result, while destructive
in-place compaction remains restricted to completed user turns.

### Compression registry

| Strategy | Preservation policy |
| --- | --- |
| `through-line-and-facts` | Narrative and facts; no default generation cap |
| `task-handoff` | Goal, constraints/decisions, exact evidence references, uncertainty, failed attempts, pending work |
| `truncate` | Actual last `keepTurns` complete turns, including tool pairs; default 2, zero allowed |

Summaries are user data, not system instructions. Missing model/runner, empty
summaries, invalid budgets, and unsafe bounds throw before context replacement.
Selection preserves incomplete tool tails and will not split a user turn at a
checkpoint. Modern tool inputs/outputs and media references survive serialization;
binary payloads do not. Source serialization is not automatically size-bounded.

`task-handoff` defaults to 2048 summary tokens in the registry; `agent_spawn`
defaults to 1024. `maxSummaryTokens` sets that summarizer's `Stimulus.maxTokens`
and rejects an oversized result using ceil(UTF-16 characters / 4), including its
label. This is an estimate, not an exact tokenizer bound. Oversize summaries fail,
never silently truncate. Semantic accuracy must still be evaluated.

The context explorer offers these strategies as candidate baselines. Continuing
from a baseline replaces its live context; it does not create a child agent.

### Inspect collaboration traces

```bash
COLLABORATION_DIR="$PWD/.umwelten/collaborations" pnpm exec tsx examples/context-explorer/server.ts
```

Open **Collaboration traces** in the context explorer header. The separate,
read-only page shows agent branches, decision inputs/results, communications,
artifact versions, and call costs. It needs Node.js 22.13+ and no provider keys.
Point `COLLABORATION_DIR` at a directory whose immediate children are UUID run
folders; for comparison outputs select the directory containing `comparison.json`.
Keep this unauthenticated inspector private: raw traces
can contain sensitive data. See the [inspector guide](../context-explorer/README.md#read-only-collaboration-traces)
for routes, storage requirements, and a synthetic fixture.

## Limits, restart, and failure semantics

Default limits are 8 total agents, depth 3, concurrency 2, 64 model calls,
300 seconds, 100000 total tokens, and 2048 output tokens per decision. The
per-decision output cap is explicit on that run's `Stimulus`; shared runners and
benchmark defaults are unchanged. Failed children still consume an agent slot.

* Call count and agent/depth/concurrency admission are hard local bounds.
  Concurrency counts agent decisions; summary creation runs inside the parent's
  decision and can make an additional nested model request. It still consumes
  the global call/token/cost budget.
* Token and optional USD budgets reserve estimated input plus capped output
  before admission, including tool schemas and concurrent reservations. They
  settle against reported usage. **They are not guaranteed provider billing
  ceilings:** token estimates, provider reasoning, retries, pricing, and aborted
  requests can differ. Unknown failed-call usage consumes the reservation.
* `maxCostUsd` requires explicit `model.costs` in USD per million input/output
  tokens for every chosen model. Without prices, reported USD may be unavailable.
* Deadline cancellation aborts model requests and blocks subsequent tool effects.
  Already completed publications/messages remain durable.
* SQLite enforces one local scheduler owner. Read-only inspectors can coexist.
  A dead same-host owner can be recovered; shared-host/network-disk scheduling is
  unsupported. PID reuse can conservatively prevent automatic recovery.
* Reopening uses original budgets and original deadline. Interrupted decisions
  and preparing children fail rather than replaying possibly completed effects;
  interrupted calls consume their recorded reservations. This is **not exactly-once
  execution or transparent process continuation**.
* `waitForIdle()` means no runnable/in-flight work, not necessarily task success.
  Waiting agents may remain. All-waiting deadlock requires an operator message
  or eventually reaches the deadline.
* `suspend()` closes an idle run without ending it. Reopen using
  `new CollaborationRun(directory, {resume:true})`, then `start()` or send input.
  `close()` and `stop()` are terminal; they do not reset budgets.

## Journal, artifacts, and training export

`collaboration.sqlite` stores append-only events, agent snapshots, immutable
artifact metadata, and runtime ownership. `blobs/<sha256>` stores immutable UTF-8
content. Logical paths never become filesystem destinations; traversal and
absolute paths are rejected. Publishing checks `expectedVersion` and commits
metadata plus its event together. A failed transaction may leave an unreferenced
blob, but cannot expose an uncommitted artifact version.

Decision traces contain model-facing **Interaction inputs**, tools/schema,
options, delivered event IDs, tool calls/results, final messages, usage, and
lineage. These are not provider-final wire payloads, provider cache state, or a
guarantee of deterministic replay. Summary calls have separate provenance.

Raw traces may contain private data and secrets. Store them on access-controlled
local disk; do not publish raw exports. There is no automatic PII detection.

```ts
import { CollaborationStore } from '@umwelten/core/collaboration/store.js';

const store = new CollaborationStore('./my-experiment');
const jsonl = store.exportTraining({
  // REQUIRED: supply a reviewed, application-specific redaction policy.
  redact: yourRedactionFunction,
  // Select agents/runs approved after outcome evaluation.
  includeAgent: id => approvedAgentIds.has(id),
});
store.close();
// Write jsonl privately, review it, then adapt it to your trainer's format.
```

Each example has `{decisionId, agentId, input, target, metadata}`. Input is the
exact recorded decision input; target is only the added messages after the
unchanged input prefix. Tool-call actions are valid targets. Incomplete decisions,
rewritten histories, mismatched actors, and empty/reasoning-only targets are
excluded. Structured reasoning is removed before and after caller redaction.
The redactor receives the entire sample; returning an invalid/empty target drops
it. `exportTrace()` deliberately exports the full unredacted event journal.

Keep task families, runs, and sibling forks together in train/evaluation splits.
Validate model-output training rights before using provider outputs. Do not
train on all successful-looking conversation automatically: select on externally
checked outcomes and retain failures for analysis. This feature exports data;
it does **not** launch a fine-tuning job or choose a training provider.

## Evaluate collaboration, not conversation length

Compare single-agent and collaboration runs on identical held-out tasks and
similar admission budgets. Record correctness, evidence quality, cost, latency,
redundant work, and recovery from incorrect peer claims. Repeat runs; this small
arithmetic example is a smoke test, not a meaningful intelligence benchmark.

Run all three baselines with one command:

```bash
pnpm exec tsx examples/collaboration/compare.ts --scripted
# Remove --scripted for paid, real-model experiments:
dotenvx run -- pnpm exec tsx examples/collaboration/compare.ts \
  --provider openrouter --model google/gemini-3.1-flash-lite --context summary
```

`compare.ts` runs single-agent, asynchronous collaboration, and the existing
round-robin `Dialogue` against the same arithmetic check. Each has 32 model calls,
100000 estimated token admission, 2048 explicit output tokens per call, and a
180-second deadline. It writes per-run journals and a `comparison.json` under
`.umwelten/comparisons/<id>/`. Calls spent creating summaries count. Dialogue
follow-up calls count too. Roles, communication tools, and scheduling intentionally
differ; this is a baseline experiment, not a controlled claim of superiority.

For other tasks use `umwelten converse` (see `docs/guide/agent-dialogues.md`).
Dialogue turns can contain multiple model/tool steps, so equal turn counts are
**not equal budgets**. Compare measured usage rather than conversation length.

Turbopuffer/retrieval, distributed workers, automatic training, and unrestricted
code-execution tools are intentionally not part of this local prototype. Add a
retrieval index over published evidence later; keep message ordering, delivery,
and ownership in the durable journal.

## Verification

```bash
pnpm test:run packages/core/src/context packages/core/src/collaboration \
  packages/habitat/src/collaboration
pnpm exec tsc --noEmit -p packages/core/tsconfig.json
pnpm exec tsc --noEmit -p packages/habitat/tsconfig.json
```

The tests use scripted runners and disposable directories. They cover inheritance,
tool-pair-safe compaction, asynchronous delivery, no-poll waiting, fairness,
budget admission, persistence/restart, version conflicts, path safety, and
training export boundaries. They do not assert live-model handoff quality.
