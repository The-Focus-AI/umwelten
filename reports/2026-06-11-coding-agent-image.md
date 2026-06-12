# Coding-agent image — research (issue #123)

Date: 2026-06-11. Scope: layer the standards toolchain onto the habitat serve
image. Tech involved is established in-repo (Docker/entrypoint conventions,
mise, the #127/#130 runtime env overrides); the new facts gathered here:

## The standards corpus (verified via GitHub API)

- `The-Focus-AI/standards` exists, **private**, default branch `main`.
- Entry document `AGENTS.md`; the "setup/standardize prompts" are
  `prompts/setup-project.md` and `prompts/standardize-project.md`; also
  `best-practices/`, `templates/`, `mise.toml`, `.pi/`.
- Its own README runs pi interactively in a throwaway container — this issue
  puts the same corpus behind a persistent A2A habitat instead.
- Private ⇒ image build needs credentials: BuildKit secret
  (`--secret id=gh_token,env=GITHUB_TOKEN`) used only in the clone layer, with
  the remote URL reset afterward so no token lands in the image.

## Base image facts (packages/habitat/Dockerfile + entrypoint.sh)

- `node:22-slim`, runs as **root**, work dir `/data` (volume), CMD
  `habitat serve --port 8080 --skip-onboard`, `CLAUDE_CONFIG_DIR=/data/claude-config`
  already set (#118 co-location). mise + docker CLI + git/ripgrep preinstalled;
  mise binary lives behind `/root/.local` (not traversable by non-root).
- entrypoint.sh provisions config.agents[] clones + skills, then `exec "$@"` —
  a wrapper entrypoint can chain into it.
- **The base Dockerfile was broken on main**: it still COPYs
  `packages/server/package.json` (package deleted in the workspace split) and
  misses `packages/protocols` / `packages/sessions`. The May 13 `habitat` tag
  on this machine predates the RuntimeRunner seam entirely. Fixed in this
  branch (verified: stale image lacked `web/routes/contexts.ts`).

## Seeding + binding mechanics

- `Habitat.create()` loads `/data/secrets.json` **values** into `process.env`
  (fill-gaps) — so Gaia-vault secrets (ANTHROPIC_API_KEY, GITHUB_TOKEN) reach
  the claude-sdk/pi runners and gh.
- Gaia `buildSeedFiles()` seeds only `config.json` + `secrets.json`; persona
  (`STIMULUS.md`) and `routing.json` are the image's to seed — copy-if-absent
  in the wrapper entrypoint so operator/Gaia content always wins.
- `config.agents[]` entries carry explicit `projectPath`; agent projectPaths
  are added to the file-tools allowed roots, so a read-mode
  `standards-corpus` agent over `/opt/standards` both names the corpus and
  whitelists it.
- routing fallback chain (bridge/routing.ts): exact channel → parent →
  `platformDefaults[platform]` → `defaultAgentId` → main. Platform defaults
  accept `{agentId, runtime}` — binding `a2a`/`web` to
  `{workspace, claude-sdk}` makes every conversation a coding channel out of
  the box without pinning specific contextIds.

## Non-root

- The node base image ships user `node` (uid 1000). The wrapper entrypoint
  runs as root only to seed + `chown -R node:node /data` (required every boot:
  Gaia re-seeds config/secrets as root on restart), then `exec gosu node`.
- mise re-homed to a real `/usr/local/bin/mise` binary and `/opt/mise`
  chowned, since the base's symlink target under `/root` is unreadable.

## Toolchain pins (checked against registries 2026-06-11)

- gh CLI v2.94.0 (static tarball, `dpkg --print-architecture` for
  amd64/arm64 — the first build failed on this arm64 host with a hardcoded
  amd64 URL).
- `@earendil-works/pi-coding-agent@0.79.1`, `@anthropic-ai/claude-code@2.1.173`
  (npm -g).
- pi co-location: `PI_CODING_AGENT_DIR=/data/pi-agent` (settings AND sessions
  under the volume — survives rebuilds; #130's runner computes
  nativeSessionPath from the same env var).

## Smoke findings

- `/api/status` is served before the auth gate (open by design) — bearer-gate
  assertions must target registered routes (`/api/contexts/...`).
