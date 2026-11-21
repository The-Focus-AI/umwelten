# 0008 — Fleet topology: a directed tree, with Gaia as directory rather than router

Status: Accepted
Date: 2026-07-25
Related: [0004 — Gaia as a GitHub App](./0004-gaia-github-app.md),
[0007 — A2A tasks as the wake contract](./0007-a2a-tasks-as-the-wake-contract.md)

## Context

Splitting operations into per-habitat repos produces a fleet where one
operations habitat needs to ask fifteen client habitats what is happening,
and where a client habitat needs to ask about the code repos beneath it.
Something has to decide how those calls are routed.

Two facts constrain the answer. Gaia holds the @habitats GitHub App private
key and can create and destroy containers, so putting it on the path of
every business question maximises the blast radius of the most privileged
component in the system. And the existing recursion guard does not survive
a hop: `withAgentCall` tracks a call chain with a depth limit and cycle
detection, but it is process-local and neither `ask_remote_agent` nor
Gaia's `ask_habitat` enters it, so a cycle across containers starts fresh
at every hop. With LLM agents on both ends and no permitted output cap,
an unbounded cycle is unbounded spend.

Remote peers are also frozen configuration today: a habitat registers no
peer tooling at all unless peers were declared before it started, so
onboarding a new client would require editing and restarting the
operations habitat.

## Decision

**The call graph is a directed tree** — operations calls clients, clients
call their projects, and nothing calls upward. Cycles become impossible by
construction rather than by guard.

**Gaia is the directory, not the router.** It owns discovery (which
habitats exist, what each can do) and lifecycle (wake, per ADR 0007), and
stays off the path of the ask itself. Callers resolve a peer through the
directory and then talk to it directly, one hop.

Peers therefore **resolve at call time** rather than from frozen config, so
a newly created habitat is reachable without restarting anything that might
want to talk to it.

The call chain is **propagated across A2A** and rehydrated into the
existing guard on receipt. The tree makes cycles structurally impossible;
the guard is defence in depth for the case where one prompt-injected agent
ignores the convention.

## Consequences

- A habitat cannot answer a question that requires calling back up the
  tree. Cross-cutting work is orchestrated from the top: the caller
  gathers what a lower habitat would have needed and passes it down in the
  question.
- Rollups are therefore always orchestrated by the parent, never assembled
  by children self-reporting.
- Gaia stops being a bottleneck and a privileged proxy, at the cost of
  every caller needing directory access.
