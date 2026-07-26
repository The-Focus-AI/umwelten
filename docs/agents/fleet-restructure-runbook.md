# Runbook — implementing the operations fleet restructure

You are an agent picking up work on the operations fleet restructure. Read
this file, then go to the tracker. **This file is a protocol, not a task
list** — it tells you how to claim work, do it, and hand it back. What is
left to do lives in GitHub issues, which are the only source of truth for
state.

Do not update this file to record progress. It goes stale the moment two
agents work at once.

## Where the work is

| Repo | Spec | Tickets |
|---|---|---|
| umwelten (this one) | [#266](https://github.com/The-Focus-AI/umwelten/issues/266) | #267–#285 |
| habitats | [#117](https://github.com/The-Focus-AI/habitats/issues/117) | #118–#123 |
| operations | [#3](https://github.com/The-Focus-AI/operations/issues/3) | #4–#12 |

Each spec issue carries a comment with the full dependency graph. Each
ticket names its blockers under **Blocked by**.

Design decisions are ADRs [0006](../adr/0006-owned-and-mounted-repos.md),
[0007](../adr/0007-a2a-tasks-as-the-wake-contract.md),
[0008](../adr/0008-fleet-topology.md) and
[0009](../adr/0009-per-habitat-vaults.md). The build list with current
status is `../architecture/operations-fleet-restructure.md`. **Read the ADR
that governs your ticket before writing code** — several decisions are
deliberately counter-intuitive and the reasoning is recorded there, not in
the ticket.

Vocabulary — Owned repo, Mounted repo, Directory, Task, Dormant habitat,
Habitat vault, Credential contract — is defined in `CONTEXT.md` at the repo
root. Use those words; do not invent synonyms.

## Claiming a ticket

Several agents may be working at once. Claim before you code.

1. **Find candidates.** In the target repo, list open issues labelled
   `ready-for-agent` and not labelled `in-progress`.
2. **Check the blockers.** Every issue in its **Blocked by** section must be
   closed. If any is open, skip this ticket — do not start blocked work and
   do not "just also do" the blocker inside your ticket.
3. **Claim it.** Add the `in-progress` label and post a comment saying you
   have started and roughly what you intend to change. The comment is how a
   human sees who is on what.
4. **Re-read the issue after claiming.** If someone labelled it in the
   seconds you took to decide, drop it and pick another. Label claiming is
   racy; the comment timestamps break ties — earliest comment wins, the
   later agent backs off.

Take the **lowest-numbered** unblocked ticket unless you have a reason not
to. That keeps agents off each other's files, because the numbering follows
the dependency order.

## Doing the work

- Branch from the current default branch. One ticket per branch, named for
  the ticket.
- The acceptance criteria are the contract. Implement all of them, or say in
  a comment which one you could not meet and why.
- **Write the tests the ticket asks for.** Every ticket names its seam. The
  two existing seams are the A2A transport handler and the Gaia tool
  context; both already take injected fakes, so no test needs real Docker,
  real 1Password, or the network.
- Run `pnpm test:run` before committing. It must be green — not "green
  except for a pre-existing failure". If you find a genuinely pre-existing
  failure, say so in your comment with the evidence.
- Run `npx tsc --noEmit -p packages/<pkg>/tsconfig.json` for every package
  you touched.
- Commit with the ticket number in the message body (`Closes #NNN`).
- Push. Do not merge to the default branch yourself.

### When you change existing behaviour

Several of these tickets replace something that already works. When a test
you did not write starts failing, **find out why before you touch it.** A
failing test is a claim about behaviour; changing the assertion to match
your code is only correct once you know the old assertion was wrong.

If the behaviour change is real and intended, say so in the commit body —
what changed, what depended on it, why the new behaviour is right. If it is
not intended, fix your code.

### Hard rules

`CLAUDE.md` has them in full. The one that bites this work: **never
introduce a `maxTokens` / `maxOutputTokens` cap** in a runner, request
builder, or shared default. Some of this work makes long agent runs
possible for the first time; that is the point, not a problem to cap your
way out of. Cost control here is topological — see ADR 0008.

## Finishing

1. Push your branch.
2. Comment on the issue: what you built, which acceptance criteria are met,
   anything you deliberately left, and the branch name.
3. Remove `in-progress`. **Leave the issue open** — a human closes it on
   merge. `Closes #NNN` in the commit does that automatically when the
   branch lands on the default branch.

## If you get stuck or run out of context

Do not leave a ticket claimed and silent. Before you stop:

1. Push whatever is working, even if partial. A branch with three of six
   criteria met and a green suite is useful; an uncommitted working tree is
   not.
2. Comment with exactly where you got to, what you learned, and what the
   next agent should do differently.
3. Remove `in-progress` so someone else can pick it up.

An unfinished ticket handed back cleanly is a good outcome. A ticket held
hostage by a dead context is not.

## What you cannot verify here

Some tickets cannot be finished in a sandbox, and you should not pretend
otherwise:

- **#283–#285** (per-habitat vaults) need real 1Password vaults and a
  service account. You can build and unit-test the resolution path against
  a fake; you cannot verify a real mint.
- **habitats #118–#123** need the SaaS with Clerk and Neon.
- **operations #4–#12** need client repos that do not exist yet, a Granola
  credential, and the GCE fleet.

If your ticket needs infrastructure you do not have: build and test what
you can behind an injected seam, and say plainly in your closing comment
which criteria are unverified and what would verify them. Do not mark
something done because it compiles.

## Findings that will save you time

These cost real effort to establish. Do not re-derive them.

**The pinned A2A SDK is 0.3.14, and it is smaller than the published docs
describe.** The docs on `main` describe a much later API. In 0.3.14:

- `TaskStore` is `save` / `load` only — no `list`, no tenant or owner
  scoping.
- There is **no `tasks/list`**. Served methods are `message/send`,
  `message/stream`, `tasks/get`, `tasks/cancel`, `tasks/resubscribe`, and
  the four `tasks/pushNotificationConfig/*` methods.
- Non-blocking send is `configuration.blocking: false`, **not**
  `returnImmediately`.
- `InMemoryTaskStore` stores the caller's object **by reference**. A
  persisted store cannot reproduce that aliasing and should not try; every
  SDK mutation is followed by an explicit `save()`, so nothing depends on
  it.
- Push-notification config methods are gated on
  `agentCard.capabilities.pushNotifications`, which the habitat card does
  not yet declare. Declaring it makes the SDK's sender available (#275).

Spec #266 asserts `tasks/list` exists. It is wrong; the tickets are right.

**The A2A server's task store is now durable** (`FileTaskStore`, on the
habitat volume) and the boot sweep runs before the transport accepts
requests. If you are adding lifecycle behaviour, that is the seam.

**Registry entries already carry their `config`**, so anything deriving
from a habitat's declaration gets it without a call-site change.

**Known gap, not yet ticketed:** the agent-call chain uses the caller's
`entry.id` on the way out and the receiver's `config.name` on the way back
in. If a habitat is addressed under a different id than it calls itself,
the chain holds two labels for one habitat and cycle detection misses it.
Harmless while the tree topology of ADR 0008 holds. If you touch the chain,
consider keying it on registry id and file a ticket.

## Landmines

- **Do not widen a write scope by derivation.** ADR 0006 derives read only,
  on purpose. Org-wide read plus write to a public repo is how private
  content gets laundered out (ADR 0004 blind spot #1). If a change seems to
  need derived write, stop and say so.
- **Do not put the durable Task store in the control plane.** It looks
  tempting because the SaaS `runs` table is nearly identical. ADR 0007
  rejects it: the process serving `tasks/get` must be able to read it, and
  habitat-to-habitat traffic never reaches the SaaS.
- **Do not make Gaia a router.** It holds the GitHub App private key and can
  destroy containers. It is the Directory and the lifecycle owner; the ask
  goes direct (ADR 0008).
- **Do not let a habitat resolve its own vault.** Containers run agent tools
  against untrusted input; a live 1Password token inside one is exactly the
  thing ADR 0009 avoids.
- **Do not sweep interrupted Tasks.** `input-required` and `auth-required`
  are legitimately waiting, not abandoned. Killing them destroys resumable
  work.
