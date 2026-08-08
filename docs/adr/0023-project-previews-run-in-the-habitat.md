# 0023 — Project previews run in the habitat, addressed by hostname on a separate domain

Status: Accepted
Date: 2026-08-08
Related: [0004 — Gaia as a GitHub App](./0004-gaia-github-app.md),
[0006 — Owned and mounted repos](./0006-owned-and-mounted-repos.md),
[0007 — A2A tasks as the wake contract](./0007-a2a-tasks-as-the-wake-contract.md),
[0008 — Fleet topology](./0008-fleet-topology.md),
[0009 — One vault per habitat](./0009-per-habitat-vaults.md)

> An earlier draft of this ADR, committed the same day, decided the opposite:
> static output served from the habitat, with anything needing a server pushed
> out to a Vercel preview on a pull request. It was written against an assumed
> fleet of about ten habitats and no stated requirement on iteration speed.
> Both assumptions were wrong — see *Why not static plus a pull request*. It was
> never merged or cited, so it is replaced here rather than superseded.

## Context

A **project habitat** is a habitat whose Owned repo is an application rather
than agent configuration. You talk to a coding agent, it writes code into the
repo it owns, and you need to see the result. Everything except the last clause
already works: `Dockerfile.coding-agent` ships Claude Code, pi, codex, `gh` and
mise; `managedContainerToolSets` gives the container `bash`; ADR 0006 makes the
Owned repo writable and ADR 0004 mints the token.

Two requirements decide the design, and neither was known when this ADR was
first drafted.

**The loop has to be seconds, not minutes.** The agent changes a file and the
page updates — the same loop as a dev server on a laptop. This rules out
anything that goes through a commit, a push and a build.

**The fleet is 200 habitats now and 20,000 later, of which under 1% are awake
at once, and only a few dozen ever need a preview.** So previews are a small,
expensive tier on top of a very large, mostly-dormant base — not a property of
every habitat. The 20,000 case is also eventually **multi-tenant**: customers'
code, not ours.

What blocks it today is that a habitat has exactly one address.
`docker.ts:330` publishes one port (`-p 127.0.0.1:<host>:8080`), `docker.ts:343`
emits one Caddy upstream (`{{upstreams 8080}}`), and `CHILD_INTERNAL_PORT` 8080
is already the agent's own A2A, MCP, chat and health surface.

## Decision

1. **Dev servers run inside the habitat, declared rather than ad hoc.** A
   habitat declares its services in `habitat.json` — a name, a port, a command.
   The container starts and supervises them, so a service comes back by itself
   after a sleep/wake cycle instead of depending on the agent remembering to
   restart it.

2. **Services are addressed by hostname, not by host port.** Gaia stamps an
   additional Caddy site label per declared service; `caddy-docker-proxy`
   reaches the container over the shared network by DNS, so a second internal
   port needs **no host port at all**. The 7440–7499 range stays what it is
   today: loopback access for Gaia's own proxy, one per habitat.

3. **Preview hostnames are flat, and live on a separate registrable domain from
   the control plane.** Flat because a TLS wildcard covers exactly one label —
   `*.example.dev` covers `shed-web.example.dev` but not
   `web.shed.example.dev`, which would need a certificate per project against a
   limit of 50 per registered domain per week. Separate domain because customer
   code must not run on an origin that shares a cookie scope with the control
   plane, and because hosting arbitrary customer output on the control-plane
   domain makes its reputation ours. This is why Vercel serves previews on
   `vercel.app` and not `vercel.com`.

4. **Gaia stays off the preview path.** Not only because ADR 0008 keeps the
   most privileged component off the request path, but because it cannot serve
   this traffic: `proxy.ts` buffers the entire request body and never handles
   an `upgrade`, so live-reload websockets cannot traverse it. Caddy proxies
   them natively.

5. **Waking a preview is an interstitial page, not a held request.** A request
   to a dormant habitat returns a small page that triggers the wake and
   refreshes itself. This is ADR 0007's principle — don't hold the request,
   hand back something and let the client retry — expressed in HTML rather than
   in A2A task polling, which a URL bar cannot do.

6. **Phase 1 is single-tenant and says so.** The first implementation serves our
   own projects on today's infrastructure. The multi-tenant work is named in the
   consequences and deliberately not built. What *is* decided now is only what
   becomes expensive once other people's repos and links exist: the preview
   domain, the declaration schema, and whether preview URLs carry auth.

## Why not additional host ports

The obvious reading of "previews on different ports," and wrong in three ways.

Host ports are a fleet-wide scarce resource — 60 of them — while hostnames
under one wildcard are free. Ports also have to be communicated, remembered and
kept stable across rebuilds, which is why `pickHostPort` already carries
special handling to stop a habitat hopping ports on restart; every additional
port multiplies that problem. And a bare port gets no TLS, so a preview would
be plain HTTP or need its own certificate plumbing.

Hostnames give the same outcome with none of it, and the ingress that resolves
them is already deployed.

## Why not static plus a pull request

This was the previous draft's decision, and it fails the seconds-not-minutes
requirement outright: a commit, a push, a PR and a remote build is minutes.

It was also built on a memory argument that does not survive the real numbers.
The claim was that dev servers cannot fit because the runtime plane is 16 GB
with no swap (ADR 0007). But that constraint describes the **agent fleet** —
mostly-idle containers that sleep. With under 1% of the fleet awake and only a
few dozen previews, the active set is on the order of 100 GB, which is a handful
of nodes rather than an impossibility. The 16 GB box was a fact about today's
host, not a property of the architecture, and treating it as a wall produced the
wrong decision.

Two of the previous draft's other objections were real and are answered rather
than dismissed: the reaper cannot currently see preview traffic, and waking does
not work on the HTTP path. Both appear in the consequences below as work.

A pull-request preview remains genuinely better for *review* — it is per-PR by
construction, and it puts the preview where the human approval already is. It
belongs in the workflow. It is not the fast loop.

## Why not serve the preview through the habitat's own port 8080

Tempting, because the habitat's server would then see preview traffic and could
report it as activity to the reaper for free. Rejected: 8080 carries `/a2a`,
`/mcp`, `/health` and the chat surface, all of which Gaia, Caddy, the SaaS and
the health check address. Multiplexing an arbitrary application beneath those
routes means a preview that can shadow `/health` is a preview that can take a
habitat off the fleet. It would also put a Node process in the data path of
every asset request and require reimplementing websocket proxying that Caddy
already does correctly.

## Consequences

### To build in phase 1

- **A service declaration in `habitat.json`.** The schema is the highest-value
  thing to get right in this ADR, because it eventually lives in customers'
  repos and a change means migrating them. Note that the declaration currently
  has no `agents` field (`declaration.ts:36`) and `apply-declaration.ts:120-134`
  rebuilds `config.agents` from mounts, so services need a first-class field
  rather than a reuse of the agent list.
- **Per-service Caddy labels** at container start, alongside the existing
  single label (`docker.ts:339-351`).
- **A supervisor** in the container that starts declared services and restarts
  them, so wake restores the preview without agent involvement.
- **Reaper awareness.** `DEFAULT_REAPER_CONFIG` stops a habitat after 30 idle
  minutes judged from agent-surface traffic and A2A task state. Preview traffic
  goes through Caddy directly, so Gaia never sees it and the habitat must report
  it — otherwise a habitat gets reaped while someone is using its preview.
- **A wake path for browser traffic.** `HabitatWaker` is wired only into Gaia's
  `ask_habitat` / `wake_habitat` tools (`gaia-tools/habitats.ts:160`); the proxy
  route does not wake, and Caddy bypasses Gaia entirely. The interstitial needs
  something that can trigger a start without holding Gaia's master key.
- **A preview domain**, registered and wildcard-certificated, separate from the
  control-plane domain.

### Deliberately deferred, and safe to defer

The Postgres registry (200 entries in a JSON file rewritten per mutation is ugly
but works — `registry.ts:58-71`), the `ContainerBackend` seam, GKE, and
scale-to-zero for the dormant majority. All are scaling work with clean
boundaries, none of which changes the declaration format or the URLs.

### Deferred but load-bearing before any customer arrives

These are security properties, not scaling ones, and phase 1 is only safe
because it is single-tenant:

- **A container is not a boundary against hostile code.** A coding agent has
  `bash` by design. Customer agents therefore need sandboxed nodes (gVisor) or
  microVMs, which is a node-architecture decision rather than a hardening pass.
- **The Docker socket must stop being reachable from an LLM.** Gaia manages
  containers via a mounted socket and is itself a habitat with tools and a
  model. On a host running customer workloads that is a path from one prompt
  injection to the whole fleet. This promotes the `ContainerBackend` seam from a
  scaling nicety to a prerequisite.
- **Two credentials become concentration risks**: one GitHub App private key on
  the runtime host able to mint against 20,000 customer organisations, and
  ADR 0009's host-side vault resolution holding every customer's secrets. Both
  want per-tenant envelope encryption via a KMS.
- **A public preview is a public dev server** — source maps, every API route,
  and whatever CVEs the dev server has this month. Whether preview URLs carry
  auth has to be settled before links are shared, because retrofitting it
  invalidates them.

### Standing consequences

- **Previews are only up while the habitat is.** Sleep is what makes 20,000
  habitats affordable, so the interstitial is not a rough edge to remove — it is
  the visible cost of the thing that makes the fleet possible.
- **`build_image` still only builds the default image** (`docker.ts:300`), so
  standing up the first project habitat needs a manual host-side build of
  `habitat-coding`.
