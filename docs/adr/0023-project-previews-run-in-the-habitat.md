# 0023 — Project previews run in the habitat, discovered rather than declared

Status: Accepted
Date: 2026-08-08
Related: [0004 — Gaia as a GitHub App](./0004-gaia-github-app.md),
[0006 — Owned and mounted repos](./0006-owned-and-mounted-repos.md),
[0007 — A2A tasks as the wake contract](./0007-a2a-tasks-as-the-wake-contract.md),
[0008 — Fleet topology](./0008-fleet-topology.md),
[0009 — One vault per habitat](./0009-per-habitat-vaults.md);
`The-Focus-AI/standards` STD-004 (tooling and tasks), STD-008 (deployment)

> Pinned down in a grilling session. Two earlier drafts written the same day are
> replaced rather than superseded — neither was merged or cited. The first
> decided static output plus a Vercel pull-request preview, which failed a
> seconds-not-minutes iteration requirement that had not yet been stated. The
> second got the shape right but made a service declaration in `habitat.json`
> the centrepiece; grilling removed the declaration entirely. See *Why nothing
> is declared*.

## Context

A **project habitat** is a habitat whose Owned repo is an application rather
than agent configuration. You talk to a coding agent, it writes code into the
repo it owns, and you need to see the result running.

Everything except the last clause works today. `Dockerfile.coding-agent` ships
Claude Code, pi, codex, `gh` and mise; `managedContainerToolSets` gives the
container `bash`; ADR 0006 makes the Owned repo writable and ADR 0004 mints the
token.

Four requirements shape the design:

- **The loop is seconds.** The agent changes a file, the page updates. This
  rules out anything routed through a commit, a push and a remote build.
- **The fleet is 200 now and 20,000 later**, under 1% awake at once, with only a
  few dozen ever previewing. Previews are a small expensive tier on a large
  dormant base, not a property of every habitat.
- **The 20,000 case is multi-tenant** — customers' code, not ours. Phase 1 is
  single-tenant and says so.
- **Projects are not uniform.** They are scaffolded per
  `standards.thefocus.ai` by its `setup-project` skill, dynamically, each time.
  Nothing may assume a stack.

What blocks it is that a habitat has one address: `docker.ts:330` publishes one
port, `docker.ts:343` emits one Caddy upstream, and `CHILD_INTERNAL_PORT` 8080
already carries the agent's A2A, MCP, chat and health surface.

## The workflow this produces

1. You tell Gaia in chat: *"make me a project called shed-designer."*
2. Gaia creates the GitHub repo and registers the habitat.
3. The habitat's agent scaffolds the project against the standards corpus it
   already has at `/opt/standards` — no fixed template, resolved fresh each time.
4. The container runs `mise dev`, watches what ports open, and publishes an
   address per port.
5. You work with the agent in **the habitat's own chat**. Gaia is only where
   projects get created and listed.
6. You ask for a branch preview and get a second set of addresses beside the
   first.
7. When you want it live, you ask, and the agent runs `mise deploy`.

## Decisions

1. **Dev servers run inside the habitat**, supervised by the container so they
   return by themselves after a sleep/wake cycle rather than depending on the
   agent to restart them.

2. **Nothing is declared. The command is a convention and the ports are
   discovered.** The standards require every project to expose a `dev` mise task
   (STD-004), so the command is always `mise dev`. The supervisor starts it,
   watches which ports come up listening, and publishes one address per port.

   STD-004 defines `dev` only as "the loop a person or agent runs while
   working" — so it is a dev server for a web app and `lint` + `test` for a
   library. The convention therefore names *what to run*, not *what it does*, and
   discovery is what resolves the difference: ports appearing means there is
   something to preview, and `dev` exiting cleanly without opening one means
   there is not. A project with nothing to serve needs no special case.

3. **A preview router owns the preview domain.** One wildcard certificate, one
   Caddy site, and a lookup from hostname to habitat, worktree and discovered
   port. Per-container Caddy labels cannot work: labels are fixed when a
   container starts, and the ports are not known until after it does.

4. **Addresses are numbered by port order, and carry the branch.**
   `shed-main-1`, `shed-roofpitch-2`. Ports get numbers rather than names
   because naming them would mean declaring them; branches keep their own names
   because they already have stable ones. Numbering follows ascending port
   number, not the order things happen to start, so a link does not silently
   point at a different service after a restart. Branch names are sanitised and
   truncated to fit a 63-character DNS label.

5. **Preview hostnames are flat and live on a registrable domain separate from
   the control plane.** Flat because a TLS wildcard covers exactly one label.
   Separate because customer code must not share a cookie scope with the control
   plane, and because hosting arbitrary customer output on the control-plane
   domain makes its reputation ours. This is why Vercel serves previews on
   `vercel.app` rather than `vercel.com`.

6. **Preview links are public, unguessable, and not crawlable.** No sign-in — the
   point is sending someone a link. A random component in the hostname makes a
   link unguessable rather than merely unlisted, and a `robots.txt` plus a wake
   page that only fires from browser JavaScript keeps a crawler that finds a
   link from waking habitats and spending money.

7. **Gaia stays off the preview path.** ADR 0008 keeps the most privileged
   component off the request path, and in any case `proxy.ts` buffers whole
   request bodies and never handles an `upgrade`, so live-reload websockets
   cannot traverse it. The router is deliberately dumb — no App key, no Docker
   socket — so putting it on the path reintroduces nothing.

8. **Waking is an interstitial, not a held request.** A request to a dormant
   habitat returns a page that triggers the wake and refreshes itself. This is
   ADR 0007's principle — hand something back and let the client retry — in HTML
   rather than in A2A task polling, which a URL bar cannot do.

9. **Idle handling is the existing 30 minutes.** No second timer: preview
   traffic counts as activity, and the reaper's current default applies. The
   habitat must report preview traffic, because it reaches the router and never
   Gaia.

10. **A broken build shows the error and recent log, with secrets redacted.**
    Useful beats safe here, on a public page, so redaction is not optional: the
    supervisor strips the habitat's known secret values before exposing output,
    since build failures and stack traces leak environment variables readily.

11. **Any branch can get a preview, on request.** Git worktrees from the one
    clone — cheap on disk, since they share the object store — each running its
    own `mise dev` with its own addresses. Abandoned worktrees are cleaned up by
    the same idleness logic: stop the dev server when unused, remove the worktree
    after longer.

12. **Deploying is `mise deploy`, run by the agent when asked.** The standards
    already require the task (STD-004, STD-008). Deploy credentials live in the
    habitat's own vault, which is what ADR 0009 already assumes, and which makes
    them naturally per-tenant later.

13. **Phase 1 is single-tenant.** Built for our own ~200 projects on today's
    infrastructure. The tenant-isolation work is named below and deliberately not
    built. What *is* settled now is only what becomes expensive once other
    people's repos and links exist: the preview domain, the addressing scheme,
    and that previews are public.

## Why nothing is declared

The previous draft made a service declaration in `habitat.json` the highest-stakes
decision in this ADR, on the reasoning that it would eventually live in 20,000
customer repos and a schema change would mean migrating them.

Grilling dissolved the problem rather than solving it. The standards already
mandate a `dev` task, so the command never needed declaring. And the ports are
better discovered than declared: a declared port is a second place for the truth
to live, it goes stale when the project changes, and it obliges every project to
cooperate with our platform. Watching what opens asks nothing of the project.

A schema you do not have cannot be migrated. This is strictly better than getting
the schema right.

The residue is that discovery yields ports and not names, which is why addresses
are numbered — see decision 4.

## Why not additional host ports

The literal reading of "previews on different ports," and wrong three ways. Host
ports are fleet-wide and scarce — 60, in 7440–7499 — where hostnames under one
wildcard are free. Ports must be communicated and kept stable across rebuilds,
which is why `pickHostPort` already carries special handling to stop a habitat
hopping ports on restart; each additional port multiplies that. And a bare port
gets no TLS.

## Why not static output plus a pull-request preview

The first draft's decision. It fails the seconds requirement outright, and its
memory argument does not survive the real numbers: it read ADR 0007's 16 GB
no-swap host as ruling out dev servers, but that constraint describes the
mostly-idle agent fleet. With 1% awake and a few dozen previews the active set is
around 100 GB — a handful of nodes. The box was a fact about today's host, not a
property of the architecture.

Pull-request previews remain better for *review* — per-PR by construction, and
sited where human approval already is. They are not the fast loop, and with
branch previews available in-habitat they are no longer needed for comparison
either.

## Why not serve previews through the habitat's own 8080

Tempting, because the habitat's server would then see preview traffic and could
report activity for free. Rejected: 8080 carries `/a2a`, `/mcp`, `/health` and
chat, all of which Gaia, Caddy, the SaaS and the health check address. A preview
that can shadow `/health` can take a habitat off the fleet. It would also put a
Node process in the data path of every asset and require reimplementing
websocket proxying Caddy already does correctly.

## Consequences

### To build in phase 1

- **Repo creation in Gaia.** Nothing creates repos today; `create_habitat` takes
  a `gitUrl` that must already exist, and the runbook's onboarding step 1 is a
  manual human act. Needs the App to be able to create repos.
- **A supervisor** in the container: runs `mise dev` per worktree, discovers
  listening ports, restarts on exit, captures and redacts logs, reports activity.
- **The preview router**: hostname to habitat/worktree/port, websocket-capable,
  wake interstitial, `robots.txt`, activity reporting, error page.
- **Worktree management**: create on request, run, idle-stop, remove.
- **A preview domain**, registered with a wildcard certificate.
- **Reaper awareness** of preview traffic, so a habitat is not stopped while
  someone is using its preview.
- **A wake trigger the router can call** without holding Gaia's master key.

### Deferred, safely

The Postgres registry (200 entries in a JSON file rewritten per mutation is ugly
but works — `registry.ts:58-71`), the `ContainerBackend` seam, GKE, and
scale-to-zero for the dormant majority. Scaling work with clean boundaries, none
of which changes the addressing or asks anything of a project.

### Deferred but load-bearing before any customer arrives

Security properties, not scaling. Phase 1 is only safe because it is
single-tenant:

- **A container is not a boundary against hostile code.** A coding agent has
  `bash` by design, so customer agents need sandboxed nodes (gVisor) or
  microVMs — a node-architecture decision, not a hardening pass.
- **The Docker socket must stop being reachable from an LLM.** Gaia manages
  containers through a mounted socket and is itself a habitat with tools and a
  model; on a host running customer workloads that is a path from one prompt
  injection to the whole fleet. This promotes the `ContainerBackend` seam from a
  scaling nicety to a prerequisite.
- **Two credentials become concentration risks**: one GitHub App private key on
  the runtime host able to mint against 20,000 customer organisations, and
  ADR 0009's host-side vault resolution holding every customer's secrets. Both
  want per-tenant envelope encryption via a KMS.
- **A public preview is a public dev server** — source maps, every route, and
  whatever CVEs the dev server shipped with. Acceptable for our own projects;
  needs revisiting per-tenant.

### Standing consequences

- **Previews are only up while the habitat is.** Sleep is what makes 20,000
  habitats affordable, so the interstitial is not a rough edge to remove — it is
  the visible price of the thing that makes the fleet possible.
- **Discovery is a guess, and will sometimes guess wrong.** A project opening
  several ports gets several addresses whether or not they are all meant to be
  public. Numbering by port keeps it predictable; it does not make it correct.
- **`build_image` still only builds the default image** (`docker.ts:300`), so
  the first project habitat needs a manual host-side build of `habitat-coding`.
