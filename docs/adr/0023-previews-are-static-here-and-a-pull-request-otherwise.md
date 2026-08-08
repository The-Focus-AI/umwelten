# 0023 — Previews are static in the habitat, and richer previews are a pull request

Status: Accepted
Date: 2026-08-08
Related: [0004 — Gaia as a GitHub App](./0004-gaia-github-app.md),
[0006 — Owned and mounted repos](./0006-owned-and-mounted-repos.md),
[0007 — A2A tasks as the wake contract](./0007-a2a-tasks-as-the-wake-contract.md),
[0008 — Fleet topology](./0008-fleet-topology.md),
[0009 — One vault per habitat](./0009-per-habitat-vaults.md)

## Context

A **project habitat** is a habitat whose Owned repo is an application rather
than agent configuration: you talk to a coding agent, it writes code into the
repo it owns, and you want to look at the result. The worked example is a site
that designs sheds and prices a bill of materials against a local hardware
store's catalogue.

Everything up to "look at the result" already exists.
`Dockerfile.coding-agent` ships Claude Code, pi, codex, `gh` and mise on the
habitat base; `managedContainerToolSets` gives the container `bash` and the
provisioning tools; ADR 0006 makes the Owned repo writable and ADR 0004 mints
the token. The agent can clone, edit, build and open a pull request today.

Looking at the result is where it stops, and the gap is not a missing feature
so much as a missing decision. Two static surfaces exist and neither was built
for this:

- **`/files/*`** (`container-server.ts:1031`) serves the whole work directory,
  sandboxed to the habitat's allowed roots — so a build output on the volume is
  already addressable. It is gated whenever `HABITAT_API_KEY` is set, which is
  always under Gaia, and the auth layer is Bearer and JWT only. There is no
  cookie session, so it is not reachable from a browser tab. Correct as a fact,
  useless as a preview.
- **`/agents/<id>/<file>`** (`agent-surface.ts:194`) serves static files under
  an agent manifest's `publicUiDir` and is *deliberately* not gated — the
  connector flow needs it publicly reachable. With the wildcard TLS on
  `*.habitats.thefocus.ai` this is already a public, browsable static host.

So the habitat can already serve a built site to a browser. What it cannot do
is run the site's *server*: `docker.ts:330` publishes exactly one port
(`-p 127.0.0.1:<host>:8080`), `docker.ts:343` emits exactly one Caddy upstream
(`{{upstreams 8080}}`), and `CHILD_INTERNAL_PORT` 8080 is already the agent's
own server. A dev server on 5173 has no route out by any path.

## Decision

**Preview splits into two tiers, and the habitat never runs the application's
server process.**

1. **Tier 1 — static, in the habitat.** The agent builds the project and the
   output is served from the existing ungated `/agents/<id>/` surface. This is
   the fast loop: no new port, no new process, no new auth story.

2. **Tier 2 — anything that needs a server is a pull request.** Server-side
   rendering, API routes, HMR, middleware, a real database — the agent pushes a
   branch and opens a PR, and the project's own Vercel project builds a preview
   deployment. The preview URL is Vercel's, per-PR, and nothing about it touches
   the runtime plane.

3. **`publicUiDir` becomes declarable in `habitat.json`**, narrowly superseding
   ADR 0006's silence on it. Today the declaration has no `agents` field
   (`declaration.ts:36`) and `apply-declaration.ts:120-134` rebuilds
   `config.agents` from the mounts, so the only way to configure a public UI
   directory is `update_habitat_config` — a Gaia tool call, which is exactly
   what ADR 0006 says should be a pull request against the habitat's own repo.
   A habitat that serves a preview should say so in its declaration.

4. **The runtime plane runs agents, not applications.** This is the invariant
   the other three serve. A project habitat's job is to write code and reason
   about it; hosting the result is somebody else's job.

## Why the pull request is the better half of this, not the fallback

The instinct is to read Tier 2 as a concession. It is the stronger tier on
three counts.

**A Vercel preview is per-PR by construction.** One registry entry maps to one
volume, one checkout and one port, so a habitat-hosted preview can only ever
show one state of the code. "Show me this branch next to main" has no answer
inside the habitat and needs no work outside it.

**The review gate and the preview gate become the same gate.** ADR 0004 scopes
a write token to `contents`, `issues` and `pull_requests` on the Owned repo,
and notes that merging to a default branch is blocked by branch protection
rather than by the token — the agent can propose and cannot land. Tier 2 puts
the preview exactly where the human decision already is.

**It resolves the public-repo bind rather than living with it.** ADR 0004's
blind spot #1 is that org-wide read plus write to a *public* repo lets a
prompt-injected agent launder private repo contents into public commits, which
is why `repo-scopes.ts` derives read and never derives write. A project habitat
wants write to its Owned repo by definition, and a habitat-hosted preview
pushes toward making that repo public. Tier 2 removes the pressure: the repo
stays private, and the preview is published by Vercel from a deployment rather
than by us from a checkout.

## Considered options

**Publish additional ports and stamp additional Caddy labels.** The direct fix,
and rejected on four independent grounds.

*Memory.* The runtime plane is one 16 GB GCE VM with no swap, which moved off a
7.6 GB box precisely because a fleet of about two was OOM-killing it (ADR
0007); #229 is an OOM that took the Twitter habitat down for eleven hours. A
Node dev server is 0.5–1 GB resident per habitat. An always-on preview process
attacks the exact constraint the idle reaper exists to manage.

*The reaper cannot see it.* `DEFAULT_REAPER_CONFIG` stops a habitat after 30
minutes of idle, judged from `lastRequestAt` — traffic to the *agent* surface —
plus non-terminal A2A task state. Browsing a preview is neither, so it does not
count as activity; and a dev server is not a task, so nothing blocks the reap.
The preview would be stopped while in use.

*Waking is not available on the HTTP path, and ADR 0007 rejected making it so.*
`HabitatWaker` is wired into exactly one place — Gaia's `ask_habitat` /
`wake_habitat` tools (`gaia-tools/habitats.ts:160`). The proxy route
(`routes.ts:375`) does not wake, and the Caddy label points straight at the
container, bypassing Gaia entirely, so when the container is down there is
nothing left to wake it. ADR 0007 considered holding the request at Gaia's
proxy during boot and rejected it for solving only wake and not long work. A
browser cannot accept the alternative it chose instead: `returnImmediately`
plus polling `tasks/get` is not a thing a URL bar does.

*Blast radius.* Wake-on-HTTP needs something in front of the container, and the
only candidate is Gaia — which holds the GitHub App private key and can create
and destroy containers. ADR 0008 put Gaia off the request path deliberately, on
exactly this reasoning.

The port range is a footnote by comparison: 7440–7499 is 60 ports for the whole
fleet, already allocated one per habitat.

**Run the app on 8080 beside the agent.** Rejected: 8080 is the agent's A2A,
MCP, chat and health surface, and Gaia, Caddy, the SaaS and the health check
all address it. Sharing it means path-multiplexing an arbitrary application
under the agent's routes, and a preview that can shadow `/health` or `/a2a` is
a preview that can take the habitat off the fleet.

**Deploy the habitat itself to Vercel.** Out of scope here and not the same
question. `docs/architecture/habitat-deployment.md` already makes Vercel a
first-class target for running *a habitat*; this ADR is about hosting *the
application a habitat writes*. Keeping the two separate matters: the habitat
stays on the runtime plane where its volume, vault and sessions live.

## Consequences

- **Tier 1 needs the static surface to become fit for a built site.** As it
  stands `agent-surface.ts` serves seven MIME types (`.html .css .js .json .png
  .jpg .svg`) and falls back to `application/octet-stream` — which browsers
  refuse to execute for `.mjs`, and which is wrong for `.woff2`, `.map`,
  `.webmanifest`, `.ico` and `.webp`. An unknown path returns a `NOT_FOUND`
  JSON body rather than `index.html`, so client-side routing breaks on
  deep-link and refresh. And the surface is mounted at `/agents/<id>/`, so a
  build must be configured with that base path; nothing derives or injects it.
  Each of these is small and none is optional.

- **Tier 1 previews are only up while the habitat is.** The build output lives
  on the volume and survives sleep, but a dormant container serves nothing, and
  per the rejected options above there is no wake-on-HTTP. A stale preview URL
  returning a proxy error is the expected steady state for an idle habitat, not
  a bug to file.

- **Nothing builds Tier 1 yet.** The agent has `bash` and can run a build by
  hand, but there is no tool that says "build the project and publish it as the
  preview," and no rebuild on push. Tier 1 is a manual agent action until there
  is.

- **Tier 2 splits the credential story, and this is the real cost.** ADR 0009
  puts each habitat's secrets in its own vault, resolved by Gaia on the host so
  the container never holds anything that can open a vault. A hardware-store API
  key that the *deployed application* needs must also exist in Vercel's
  environment — a second store, outside the vault, rotated separately. The
  mitigation available today is to keep credentialed work on the agent side:
  the BOM lookup is an agent task with a tool, not an API route in the app. That
  keeps the Vercel deployment credential-free for as long as it holds, and it
  will not hold forever.

- **The agent has to learn its own preview URL.** Vercel reports a deployment by
  commenting on the PR. The habitat can read that with the read token it already
  has, but nothing wires it up, so "what is the preview URL" is currently a
  question the human answers.

- **A project habitat's Owned repo should stay private.** Tier 2 removes the
  reason to make it public. Nothing enforces this; it is a review point when a
  project habitat is created.

- **`build_image` still only builds the default image**, so using
  `habitat-coding` at all requires a manual host-side build first
  (`docker.ts:300`). Unrelated to previews, but it sits directly in the path of
  standing up the first project habitat.
