# ADR 0004 — Gaia as a GitHub App: scoped repo access for habitats

Status: proposed
Date: 2026-07-06
Owners: Gaia / habitat runtime

## Context

Habitats are getting their own git repos (pilot: extracting
`examples/twitter-habitat` into `the-focus-ai/twitter-habitat`), and we want
agents to develop in public: clone private support repos (the standards
corpus), push branches and open PRs on their own repo, and get tagged into
issues so work happens where everyone can see it.

Today GitHub access is a single org-readonly `GITHUB_TOKEN` PAT seeded by
`seedOrgReadonly` — long-lived, uniformly scoped, write-incapable, and
invisible in audit terms. There is no write path, no per-repo scoping, and
no way for a running container to obtain fresh credentials (children don't
even know Gaia's address; delivery is boot-time env/volume only, plus the
narrow SaaS→habitat secret-push endpoint).

GitHub App mechanics that shape everything below: an App authenticates with
a private key and mints per-installation tokens that expire after **1
hour**; each mint can be **down-scoped** to a repo list and a permissions
subset; a single token's permissions are **uniform across its repos** (no
"read A, write B" in one token); actions authored with them appear publicly
as `<app>[bot]`. Since April 2026 tokens use a long stateless format
(`ghs_<appid>_<jwt>`) — never assume 40-char tokens.

## Decision

### 1. One GitHub App, private key held only by Gaia

Register a GitHub App (e.g. **Gaia @ TheFocus.AI**) installed on the
`the-focus-ai` org with an explicit repo list — the installation list is the
outer blast-radius boundary; genuinely sensitive repos are simply never
installed. Max App permissions: `contents: rw`, `issues: rw`,
`pull_requests: rw`, `metadata: r`, `checks: r` (extend deliberately, never
preemptively). Gaia holds the private key and is the **only** token-minting
authority. The key lives in its own file (mode 0600) referenced from config,
not inside the shared vault JSON; GitHub supports two concurrent keys, so
rotation is generate → deploy → revoke, no downtime.

### 2. Two-token bundle per habitat: ambient read + origin-pinned write

A single token cannot mix access levels, so each repo-capable habitat gets:

- **Ambient read token** (`GITHUB_TOKEN` env): `contents: read`. For
  habitats whose own repo is **private**, this may cover the whole
  installation (the org-readonly ergonomics we already like). For habitats
  whose own repo is **public**, the read token is scoped to an explicit
  read-list (own repo + standards + declared needs) — see blind spot #1.
- **Write token**: `contents/issues/pull_requests: write`, scoped to
  exactly the habitat's own repo(s), wired to the `origin` remote only
  (via `http.extraheader` or credential helper — not URL-embedded; see
  blind spot #5). Reads work everywhere ambiently; writes exist only
  through origin. Enforcement is the token, not agent obedience.

Capabilities live in Gaia's existing catalog: `github:read@<scope>` and
`github:write@<repo>` declared per habitat in the registry, resolved at
mint time. Nothing long-lived ever enters a container.

### 3. Delivery: mint at boot, pull to refresh

- **Boot**: `docker.ts` mints fresh tokens at every container start/rebuild
  and injects them as env (covers entrypoint clone/pull; workers that live
  under an hour need nothing else).
- **Pull**: a `POST /api/github/token` route on Gaia. The child
  authenticates with its own `HABITAT_API_KEY` (it already holds it); Gaia
  resolves bearer → registry entry → declared capabilities → mints the
  down-scoped token → returns it and logs the grant. Children get
  `GAIA_URL=http://<gaia-container>:8080` injected at start (all containers
  share `gaia-net`). The coding-agent image ships a git **credential
  helper** that calls this route, so every git operation fetches a fresh,
  correctly-scoped token — TTL becomes irrelevant and Gaia's log is a
  complete audit of repo access. Mints are cached ~50 minutes per
  (habitat, repo-set, perms) to respect pooled rate limits (#7).

### 4. Repo-backed habitats (config-driven, no per-habitat Docker images)

A habitat repo contains `config.json`, `STIMULUS.md`, `tools/`, `src/`,
`package.json`, tests, and a `mise.toml` whose `[tools]` pins node/pnpm and
whose `postinstall` hook runs `pnpm install` — the existing entrypoint's
`mise install` then handles dependencies with **zero runtime changes**.
Runtime gaps to close (small): load `tools/` from the project dir (mirroring
the stimulus loader's projectDir fallback) and `git pull --ff-only` on boot
so "push → rebuild" is the whole deploy. Secrets remain declarations in the
repo; values flow from Gaia's vault; per-user tokens stay on the volume.
Custom Docker images (and the `Dockerfile.twitter-habitat` seeding/symlink
machinery) are retired for repo-backed habitats. Graduating a stable habitat
to versioned GHCR images stays open as a later hardening step.

### 5. Public work loop (issue-driven workers)

Webhooks (`issues`, `issue_comment`, `pull_request`) are received by the
habitats SaaS receiver (already HMAC-verifies and stores every delivery for
replay) and forwarded to Gaia, or by a Gaia `/webhooks/github` route behind
Caddy with the same verification. On an authorized trigger (see #2 below),
Gaia spins an ephemeral coding habitat for the issue: clone via minted
token, work, run the repo's own tests, push `gaia/issue-<n>`, open a PR
referencing the issue, narrate progress as issue comments. Merge is human.
Gaia reaps the container on close. Default branches carry **protection
rulesets requiring PRs** so "write access" structurally means "branches and
PRs", not "merge to main" (#4).

## Blind spots (adversarial pass) and their mitigations

1. **Exfiltration laundering.** Org-wide read + write-to-own-repo +
   *public* own-repo = a prompt-injected worker can copy private repo
   contents into public commits/PRs. The write scope is not the protection;
   the write target is the leak. → Public-repo habitats get explicit
   read-lists, never ambient org read. Private-repo habitats may keep the
   broad read default.
2. **Public prompt injection.** Anyone can @mention the bot on a public
   issue. → Dispatch is permission-gated: org members/collaborators trigger
   directly; outsider mentions queue until a maintainer 👍-reacts (the
   reaction webhook is the approval). Issue/comment text always enters the
   stimulus wrapped as untrusted third-party content.
3. **Self-trigger loops.** The bot's own comments fire webhooks. → Drop
   events where `sender.type == "Bot"` (and specifically our app's login);
   cap runs and spend per issue.
4. **Agent obedience is not enforcement.** → Branch protection rulesets on
   default branches; the App is not on the bypass list. Force-push and
   repo-delete permissions are simply never granted to the App.
5. **Token persistence in artifacts.** URL-embedded credentials land in
   `.git/config` on volumes; session transcripts are egressed to the host
   and read by introspection tooling. → Use `http.extraheader`/credential
   helper instead of URL embedding; mask anything matching `ghs_*` in tool
   output and logs.
6. **App key custody.** The key is a skeleton key for the installation. →
   Own file, 0600, outside the shared vault JSON; documented two-key
   rotation; never seeded to any child volume.
7. **Pooled rate limits.** All workers share the installation's API budget,
   and minting itself is rate-limited. → Gaia caches mints ~50 min per
   scope-set; workers use git, not the REST API, for bulk operations.
8. **Webhook trust.** → HMAC verify before any processing; dedup on
   delivery id; the habitats receiver's stored-payload replay covers
   recovery. Webhook bodies never reach an LLM without provenance framing.
9. **Workspace hygiene.** `/data` holds `secrets.json` and session logs
   next to the cloned project. → Workers operate in `/data/project` only;
   repo `.gitignore` includes the volume-file names as belt-and-braces;
   exec-tools cwd defaults already point at the project dir.
10. **CI feedback loops and cost.** Bot pushes trigger Actions on the
    habitat repo. → Concurrency groups per branch in repo CI templates;
    narration-only commits use `[skip ci]`.

## Rollout

1. Runtime gaps: project-dir tools loading; pull-on-boot. (umwelten)
2. Gaia foundation: App key config, mint helper, `github:*` capabilities in
   the catalog, boot-time injection in `docker.ts`, `POST /api/github/token`
   with per-child auth + audit log. (umwelten)
3. Register the App, install on an allowlist: `standards`,
   `twitter-habitat`. Protect default branches.
4. **Pilot: extract twitter-habitat** to its own (initially private) repo;
   registry entry moves to base image + `gitUrl`; retire its Dockerfile.
5. Credential helper in the coding-agent image; then the webhook → worker
   loop (issue-driven), reusing the SaaS receiver.
6. Only after the loop is boring: flip the twitter repo public and let the
   activity be the demo.

## Open questions

- Attribution: everything as `gaia[bot]` (current plan), or user-access
  tokens (8h) for human-initiated actions later?
- Webhook ingress home: SaaS receiver forwarding to Gaia (replay for free,
  one more hop) vs. Gaia-direct (simpler, needs its own storage). Leaning
  SaaS-forwarding first.
- Where the runtime pause-and-ask (A2A `input-required`) lands in this
  loop — force-push/delete are denied outright in v1, so approval UX can
  wait for the permissions ADR.
