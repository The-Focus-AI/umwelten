# Operations as a fleet — what umwelten has to change

> Status: design settled in a grilling session, 2026-07-25. Decisions are
> recorded in ADRs [0006](../adr/0006-owned-and-mounted-repos.md),
> [0007](../adr/0007-a2a-tasks-as-the-wake-contract.md) and
> [0008](../adr/0008-fleet-topology.md); this is the build list that follows
> from them. Companion to `production-topology.md`, which describes the
> plane this runs on.

## The target

The operations repo becomes a fleet. Each client gets a habitat that owns
its own repo — meeting notes, scopes, outstanding work — and mounts the
client's code repos read-only. A prospect can be given a habitat at first
contact, to hold mockups and demos before there is any code. An operations
habitat sits above them and answers cross-cutting questions by asking each
client habitat directly. Most of the fleet is asleep most of the time.

Shape, in the vocabulary of `CONTEXT.md`:

```
operations habitat        owns operations-core · classifies and dispatches
  ├── client habitat      owns client-<name> · mounts that client's repos
  │     └── project       code-repo habitats beneath a client
  └── …
Gaia                      directory + lifecycle · off the ask path
```

## What must be built

Ordered by what blocks what. Items 1–3 are on the critical path: nothing
else works until a caller can hold a task open across a wake.

### 1. Durable task state

`packages/protocols/src/a2a/server.ts` constructs `new InMemoryTaskStore()`,
so task state dies with the container — fatal once a reaper is the thing
stopping it. Needs a volume-backed store, plus a crash-recovery sweep at
boot that marks abandoned non-terminal tasks failed with a reason.

### 2. A real A2A client

`packages/protocols/src/a2a/client.ts` hand-rolls JSON-RPC in two of its
three senders (`sendA2AMessage` over `node:http`, `sendA2AMessageToUrl`
over `fetch`); only `streamA2AMessage` uses the SDK transport. None can
poll a task. Standardise on `@a2a-js/sdk/client`, and add what the wake
contract needs: `returnImmediately`, `tasks/get`, a poll helper.

The habitats SaaS keeps its own client (`src/lib/a2a/`) — it is Clerk- and
Postgres-shaped and belongs on its side of ADR 0003. Both sides adopt the
SDK separately.

### 3. Conformance suite

One fixture suite running both clients against a live habitat, asserting
the task lifecycle end to end. This is the shared artifact instead of a
shared client package, and it is the regression net for item 1.

### 4. Sleep and wake

Nothing exists today — no idle tracking, no auto-stop. Gaia needs an idle
reaper that **refuses to stop a habitat holding non-terminal tasks**, and a
wake path. `ask_habitat` currently returns `"Habitat X is not running"`
(`gaia-tools/habitats.ts:293`) rather than waking anything.

### 5. Split fast-start from refresh

`packages/habitat/entrypoint.sh` does the same expensive work on every
start: pull the owned repo, `mise install`, `pnpm install --prod`, then a
clone plus `mise install` per mounted repo, then a skills restore. Wake
time therefore scales with mount count, and the rollup habitat is the
slowest waker in the fleet.

A warm volume already has all of it. Starting must be cheap; refreshing
must be a separate, explicitly triggered operation — driven by the SaaS's
GitHub webhook hub, which refreshes an awake habitat and marks a dormant
one dirty.

**Every answer must carry the checkout's commit and age.** A rollup
assembled from habitats that were quietly three weeks stale is wrong in a
way nobody notices.

### 6. A directory that works while asleep

`discoverHabitats` filters to `entries.filter(e => e.containerPort)`
(`gaia-tools/context.ts:94`) — it discovers by fetching each agent card
live, so it sees only running habitats. In a fleet that is dormant by
design it would report almost nothing. Agent cards must be cached on the
registry entry and refreshed while a habitat is awake.

### 7. Peers that resolve at call time

`packages/habitat/src/tools/remote-agent-tools.ts` registers no tooling at
all unless peers were declared before start, so adding a client habitat
today means restarting the operations habitat. Peers must resolve through
the directory at call time.

### 8. Call chain across the hop

`packages/habitat/src/identity/agent-call-context.ts` tracks depth and
cycles in `AsyncLocalStorage` — process-local. Neither `ask_remote_agent`
nor `ask_habitat` enters it, and the chain is never serialised into the A2A
request, so a cross-container cycle starts fresh at every hop. Propagate
the chain and rehydrate it on receipt.

### 9. Derive read scopes from mounts

Per ADR 0006. Repo access is currently encoded in four places that nothing
reconciles: the owned repo, the mount list, the registry's
`github: { read, write }` mint boundary, and the App installation list.
Derive `github.read` from the owned repo plus declared mounts; leave
`github.write` explicit and singular.

### 10. Provisioning that includes mounts

`create_habitat` takes `id, name, gitUrl, gitBranch, provider, model,
secretBindings, capabilities[]` — but not mounts. Standing up a client
habitat today is five or more calls with no atomicity, repeated per client.
`export_habitat` / `import_habitat` is portability, not templating: it
refuses an existing id and carries no variables.

Near term, a provisioning script that makes the calls in a fixed order and
is the only sanctioned way to create a client habitat. Target, per ADR
0006, is the habitat's own repo as the source of truth, instantiated from a
template repo — which also resolves the bootstrap circularity by cloning
the owned repo under ambient read before narrowing to the derived list.

### 11. Per-habitat vaults

Per ADR 0009. Gaia's master vault is one flat name-to-value map, and
`capability-resolver.ts` welds the env var name to the vault key — so two
habitats cannot both see `DATABASE_URL` with different values. The Twitter
habitat already declares `DATABASE_URL` in its `requiredSecrets`, so this
lands with the second habitat that needs a database.

Each habitat gets its own vault, declared by a `fnox.toml` in its own repo
next to `config.json`. Gaia executes that manifest on the host and injects
the result; containers still never call fnox. `secretBindings` and the
capability-to-credential binding both need reworking against per-habitat
vaults rather than the shared namespace.

The three tiers stay distinct and only the first changes: operator-provided
values (vault), user-authorized values (the habitat's own OAuth at
`connectPath`, rotated in its own store — the Twitter habitat is the
reference implementation), and — proposed, not decided — values provisioned
while building the environment.

## What changes outside umwelten

`/sync` is a single writer: it reads Granola, pattern-matches each meeting
against a table of client aliases, and writes into fifteen client
directories. Those become fifteen repos, and ADR 0006 forbids any habitat
holding write scope across them.

It splits: the operations habitat keeps the classification table and
dispatches each meeting to the owning client habitat over A2A; the client
habitat writes its own repo and dedupes on its own side. Meetings that
match no client stay with operations, which is also where a prospect lives
until they have a habitat.

## Deliberately not decided yet

- The habitat roster at launch — whether finance, sales and marketing get
  their own agents or stay repos under one operations habitat. ADR 0006
  makes this cheap to defer: they are mounts either way.
- How a statement of work is represented well enough that a rollup can
  reconcile activity against it. This is the one open item that could
  change the shape of a client repo.
- Identity propagation across an agent-to-agent hop. Still unimplemented
  (habitats `CONTEXT.md` flags it), and still fine while every caller is
  the same person. It stops being fine the moment a client sees a habitat.
- Prospect-to-client-to-closed lifecycle: what provisioning happens at
  first contact, and what happens to a habitat when an engagement ends.
