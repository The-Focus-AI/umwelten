# Spec: Project habitats and live previews (phase 1)

> Buildable spec for [ADR 0023 — project previews run in the habitat, discovered
> rather than declared](../adr/0023-project-previews-run-in-the-habitat.md). The
> ADR holds the decisions and the reasoning; this holds the interfaces, the
> behaviours and the acceptance criteria. Where they disagree, the ADR wins and
> this file is stale.
>
> Phase 1 is **single-tenant** — our own projects, roughly 200 of them, on
> today's runtime plane. Every multi-tenant prerequisite is in *Out of scope*.

## Problem statement

A project habitat's agent can already clone, scaffold, edit, build and open a
pull request. You cannot see the application running. A habitat has exactly one
address: `docker.ts:330` publishes one host port, `docker.ts:343` emits one Caddy
upstream, and `CHILD_INTERNAL_PORT` 8080 already carries the agent's A2A, MCP,
chat and health surface.

Iteration has to be seconds — change a file, refresh, see it — which rules out
anything routed through a commit and a remote build.

## Solution

Five new pieces, one changed default, and one new Gaia capability.

| # | Component | Where |
|---|---|---|
| 1 | **Service supervisor** — runs `mise dev` per worktree, discovers ports, captures logs | in-container, `packages/habitat` |
| 2 | **Worktree manager** — create/list/remove git worktrees on request | in-container, `packages/habitat` |
| 3 | **Preview router** — hostname → habitat/worktree/port, wake, error pages | new service, own package |
| 4 | **Preview registry** — what addresses exist and where they point | Gaia |
| 5 | **Repo creation** — Gaia creates the GitHub repo | Gaia, `tools/gaia` |
| 6 | Reaper counts preview traffic as activity | `tools/gaia/reaper.ts` |

Nothing in `habitat.json` changes. There is no service declaration — see ADR 0023
*Why nothing is declared*.

---

## 1. Service supervisor

Runs inside the habitat container, started by `entrypoint.sh` after provisioning,
before/alongside the habitat server.

### Behaviour

For each active worktree, run `mise dev` with the worktree as cwd, then watch for
listening TCP ports attributable to that process tree.

**Port discovery.** Poll `/proc/net/tcp` and `/proc/net/tcp6` every 250 ms for a
30-second window after start, then every 5 s while running. Match sockets in state
`0A` (LISTEN) whose inode belongs to a file descriptor under the process tree's
`/proc/<pid>/fd`. `/proc` is chosen over `ss`/`lsof` because neither is installed
in the `node:22-slim` base and adding `iproute2` to the image for this would be
gratuitous.

Ignore: loopback-only sockets bound to `127.0.0.1` — a dev server bound to
loopback inside the container is unreachable from the router anyway, and this is
the single most likely misconfiguration. **Report it as a named error rather than
silently publishing nothing** (see acceptance criteria).

**Exit handling** — the three cases, which is where STD-004's looseness lands:

| Exit | Ports opened? | Meaning | Action |
|---|---|---|---|
| 0 | no | `dev` was a check task (lint+test), not a server | No preview. Do not restart. Record `no-service`. |
| 0 | yes | Server shut down cleanly | Restart, backoff from 1 s, cap 30 s |
| non-zero | either | Crashed or failed to compile | Restart with backoff; expose error + log |

The first row is why nothing needs declaring: the default-project template's `dev`
runs `mise run lint && mise run test`, and a library with nothing to serve is not
a special case, it is a project that opened no ports.

**Log capture.** Ring buffer, last 256 KB of combined stdout/stderr per worktree,
in memory. Not persisted — this is diagnostic, not a Source Session, and per
ADR 0007's logging split it must not be conflated with one.

**Secret redaction (required, not optional).** Before any log leaves the process,
replace every occurrence of every value from the habitat's resolved secrets with
`[redacted:<NAME>]`. Build failures and stack traces leak environment variables
readily, and the error page is public. Redact on values of length ≥ 8 to avoid
mangling output on a trivially short secret. Redaction happens here, in the only
component that knows the values — the router never sees them.

**Activity.** Record a timestamp on every request the supervisor's forwarded
traffic sees, exposed via the API below, so the reaper can see preview use.

### API (on the habitat server, bearer-gated)

```
GET  /api/preview/services
  → { worktrees: [ { name, branch, status, services: [ { port, url }, … ],
                     error?: { kind, message }, lastRequestAt } ] }

GET  /api/preview/log?worktree=<name>&tail=<bytes>
  → { log: string }          # already redacted

POST /api/preview/restart    { worktree }
```

`status`: `starting` | `running` | `no-service` | `crashed` | `stopped`.
`error.kind`: `loopback-only` | `no-ports` | `crashed` | `port-conflict`.

---

## 2. Worktree manager

Any branch can get a preview, on request (ADR 0023 decision 11).

- `git worktree add` from the single clone — shares the object store, so a second
  branch costs little disk.
- Path: `<projectDir>/../worktrees/<sanitised-branch>`, outside the main checkout
  so it is never itself a tracked file.
- The primary checkout is a worktree named `main` for uniformity; the manager
  never removes it.

**Lifecycle.** Idle-stop the dev server after the reaper's threshold
(`GAIA_IDLE_REAP_MINUTES`, default 30) with no requests. Remove the worktree after
7 days idle. Both are reported, never silent — an abandoned worktree that vanished
without a line in the log is indistinguishable from a bug.

**Tools** (habitat toolset, so the agent can drive it):
`preview_list`, `preview_add_branch`, `preview_remove_branch`, `preview_logs`,
`preview_restart`.

---

## 3. Preview router

A new standalone service. Owns the preview domain. **Deliberately dumb: no GitHub
App key, no Docker socket, no vault access** — that is what makes putting it on
the request path compatible with ADR 0008, which keeps Gaia off it.

### Hostname scheme

```
<project>-<branch>-<n>-<nonce>.<PREVIEW_DOMAIN>
```

- `<n>` — ordinal by **ascending port number**, not start order (ADR 0023
  decision 4), so a restart cannot silently retarget a shared link.
- `<nonce>` — per-habitat random suffix, 6 chars base32. Makes links unguessable
  rather than merely unlisted. Stable for the habitat's life, so links keep
  working.
- Single DNS label, ≤ 63 chars. Branch component sanitised
  (`[^a-z0-9]+` → `-`, collapsed, trimmed) and truncated with a 4-char hash
  suffix when it would overflow, so `feature/roof-pitch` and
  `feature/roof-pitching` cannot collide.
- One wildcard certificate for `*.<PREVIEW_DOMAIN>`. Flat is mandatory: a wildcard
  covers exactly one label.

`PREVIEW_DOMAIN` **must be a separate registrable domain** from the control plane,
not a subdomain of it (ADR 0023 decision 5).

### Request handling

```
1. Resolve hostname → { habitatId, worktree, port }. Unknown → 404, no detail.
2. Habitat running?
   no  → serve wake interstitial (below), 200
   yes → continue
3. Service running on that port?
   no  → serve error page with redacted log tail, 503
   yes → proxy, including WebSocket upgrade
4. Record activity for (habitatId, worktree).
```

**WebSocket upgrade is mandatory, not optional** — live reload is the entire
point, and it is exactly what `tools/gaia/proxy.ts` fails to do (it buffers whole
bodies and never handles `upgrade`). Do not reuse that code. Handle the `upgrade`
event and pipe both directions.

Also required: streaming request and response bodies (no buffering — dev servers
serve large bundles), and `X-Forwarded-*` set so frameworks generate correct
absolute URLs.

### Wake interstitial

Served when the target habitat is dormant. A small self-contained page that:

- states which project is starting and that it takes roughly 30–60 seconds;
- calls the wake endpoint **from JavaScript**, then polls and reloads on success.

JS-gating is the crawler defence (ADR 0023 decision 6): a bot that finds a link
fetches HTML, does not execute JS, and therefore cannot wake habitats and spend
money. Paired with:

```
GET /robots.txt → User-agent: *
                  Disallow: /
```
plus `X-Robots-Tag: noindex, nofollow` on every response.

### Wake endpoint

The router needs to start a habitat without holding Gaia's master key.

```
POST {GAIA_URL}/api/preview/wake   { habitatId }
Authorization: Bearer {PREVIEW_ROUTER_KEY}
  → { status: "running" | "starting" | "not-found" | "failed", detail }
```

A dedicated key that authorises **wake only** — not create, not stop, not
secrets, not logs. Implemented over the existing `HabitatWaker`
(`tools/gaia/waker.ts`), whose wake-coalescing already guarantees five concurrent
requests start one container. Rate-limit per habitat id.

### Config

| Env | Meaning |
|---|---|
| `PREVIEW_DOMAIN` | wildcard domain, separate registrable domain |
| `GAIA_URL` | in-network Gaia address |
| `PREVIEW_ROUTER_KEY` | wake-only bearer |
| `PREVIEW_PORT` | listen port (default 7431 — free in the 74xx block) |

Caddy label on the router container only:
```
caddy = *.${PREVIEW_DOMAIN}
caddy.reverse_proxy = {{upstreams 7431}}
```
One label for the whole fleet. Per-container labels are impossible: labels are
fixed at `docker run` and the ports are unknown until after the container starts.

---

## 4. Preview registry

The router's lookup table. Phase 1 adds to the existing `GaiaHabitatEntry`:

```ts
/** Per-habitat random suffix for preview hostnames. Stable for its life. */
previewNonce?: string;
/** Last-known published previews, refreshed from the habitat. */
previews?: {
  worktree: string;
  branch: string;
  services: { ordinal: number; port: number; hostname: string }[];
  updatedAt: string;
}[];
```

`previews` is a **cache, not truth** — the same status as `cachedCard`. Truth is
the supervisor. It is cached so the router can resolve a hostname for a *dormant*
habitat, which is precisely when it must serve the wake page rather than a 404.
Refreshed whenever Gaia polls the habitat, and on wake.

`previewNonce` is added to `RUNTIME_ONLY_FIELDS` in `declaration.ts` — a
re-applied declaration must not rotate it, or every shared link breaks.

Stays in `registry.json` for phase 1. 200 entries rewritten per mutation is ugly
and works; the Postgres move is out of scope.

---

## 5. Repo creation in Gaia

Today nothing creates repos: `create_habitat` takes a `gitUrl` that must already
exist, and `production-topology.md` R4 step 1 is a manual human act.

```
create_project_habitat({ id, name, description?, private? })
```

1. Create `the-focus-ai/<id>` via the App — **`private: true` by default.**
2. Add to the App installation list; grant `github.write` on this one repo
   explicitly (write is never derived — ADR 0004 blind spot #1, `repo-scopes.ts`).
3. `create_habitat` with `gitUrl`, `image: "habitat-coding"`, `previewNonce`.
4. Start; the agent scaffolds against `/opt/standards` on first ask.

Requires `administration: write` on the App — a real privilege increase, so it is
scoped to creating repos under the one org and audit-logged like every other mint.

The habitat is **not** seeded with a template. The agent runs the standards'
`setup-project` skill, resolved fresh each time (ADR 0023 decision, context §4).

---

## 6. Reaper change

`reaper.ts` decides from `lastRequestAt` — traffic to the *agent* surface — plus
A2A task state. Preview traffic reaches the router and never Gaia, so without this
change a habitat is stopped while someone is using its preview.

- `HabitatActivityReport` gains `lastPreviewRequestAt?: string | null`.
- Idleness uses `max(lastRequestAt, lastPreviewRequestAt)`.
- New keep code `holds-active-preview` for a habitat whose preview was hit inside
  the threshold. Per the module's own rule, every refusal carries a reason.

Threshold unchanged at 30 minutes (ADR 0023 decision 9). No second timer.

---

## Sequences

**Cold link click**

```
browser → router          GET shed-main-1-k7f2q3.<domain>
router  → registry        hostname → { shed-designer, main, 5173 }
router  → Gaia            habitat dormant
router  → browser         200 wake page (JS)
page    → Gaia            POST /api/preview/wake  (wake-only key)
Gaia                      HabitatWaker.wake → docker start
container                 entrypoint → provision (warm volume: no git/install)
                          → supervisor → mise dev → :5173 LISTEN
page    → router          poll → ready → reload
router  → container       proxy :5173, upgrade for HMR
```

**Agent edits a file**: HMR websocket already open through the router → browser
updates. No Gaia, no router state change, no restart.

**Branch comparison**: agent calls `preview_add_branch("roof-pitch")` → worktree
added → `mise dev` → ports discovered → registry refreshed → both
`shed-main-1-…` and `shed-roofpitch-1-…` live.

---

## Acceptance criteria

**Supervisor**
- [ ] A Vite project's port is discovered within 10 s of `mise dev` starting.
- [ ] `dev` that runs lint+test and exits 0 yields `no-service` and is **not**
      restarted (no lint-loop).
- [ ] A dev server bound to `127.0.0.1` yields `error.kind = "loopback-only"`
      with a message naming the fix — not a silent empty preview.
- [ ] A compile error is visible in `/api/preview/log` within 5 s.
- [ ] A log line containing a secret value is redacted. **Test with a real
      secret in the habitat's resolved set.**
- [ ] Crash restarts back off and do not hot-loop.

**Router**
- [ ] HMR websocket survives ≥ 10 min and delivers an update.
- [ ] A 50 MB response streams without buffering it all in memory.
- [ ] Unknown hostname → 404 with no habitat detail.
- [ ] Dormant habitat → wake page; the habitat starts; the page reloads into the
      app unattended.
- [ ] `curl` (no JS) does **not** wake the habitat.
- [ ] `robots.txt` disallows all; `X-Robots-Tag` on every response.
- [ ] Concurrent first hits start exactly one container.

**Naming**
- [ ] Ordinals follow ascending port, stable across a restart that changes
      startup order.
- [ ] `feature/roof-pitch` and `feature/roof-pitching` truncate to distinct
      labels.
- [ ] Every hostname is ≤ 63 chars.
- [ ] Re-applying `habitat.json` does not rotate `previewNonce`.

**Reaper**
- [ ] Preview traffic inside the threshold ⇒ `keep` / `holds-active-preview`.
- [ ] Agent-idle and preview-idle ⇒ stopped as today.

**End to end**
- [ ] "Make me a project called X" in Gaia chat → private repo, running habitat,
      scaffolded project, working preview URL, no manual steps.

---

## Out of scope

**Deferred, safe** — Postgres registry, `ContainerBackend` seam, GKE,
scale-to-zero for the dormant majority, `build_image` covering `habitat-coding`
(still a manual host build, `docker.ts:300`).

**Deferred, load-bearing before any customer** — phase 1 is only safe because it
is single-tenant:

- Sandboxed nodes (gVisor) or microVMs. A container is not a boundary against
  code that has `bash`, which a coding agent has by design.
- Removing Gaia's Docker socket. Gaia is a habitat with an LLM and a mounted
  socket; on a host running customer workloads that is one prompt injection from
  the fleet. Promotes the `ContainerBackend` seam to a prerequisite.
- Per-tenant envelope encryption via KMS, for the App key and for ADR 0009's
  host-side vault resolution.
- Revisiting public previews per tenant. A public preview is a public dev server —
  source maps, every route, whatever CVEs it shipped with.

**Not doing** — pull-request previews (branch worktrees cover comparison), a
`serve` task convention (worth proposing to the standards repo separately;
discovery does not need it), last-good-version fallback, multi-user presence in
one habitat chat.

## Open questions

1. **Where does the router run?** Its own container beside Caddy is the obvious
   answer; it must be on the ingress network *and* able to reach `GAIA_URL`.
2. **What does `dev` do for a framework needing a build first?** If `mise dev`
   assumes `mise install` has run, a cold worktree may fail once before
   succeeding. Probably: supervisor runs `install` before `dev` on a new worktree.
3. **Which domain?** Needs registering before any link is shared — the one
   decision here that cannot be revised later.
