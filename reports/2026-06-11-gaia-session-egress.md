# Gaia session egress (bind-mount) — research (issue #119)

Date: 2026-06-11. Scope: make in-container sessions visible to host-side
introspection. Small slice; the relevant facts:

## Mechanics

- Sessions live at `/data/sessions/<sessionId>/` inside containers
  (`HABITAT_WORK_DIR=/data`, session manager). The rest of `/data` stays a
  named volume (`gaia-<id>-data`).
- Docker supports nested mounts: a bind at `/data/sessions` shadows the named
  volume's `sessions/` subdir regardless of `-v` flag order; listing the
  named volume first, then the more specific bind, keeps intent readable.
- Host path convention: `<gaiaDataDir>/sessions/<entryId>` — one subdir per
  habitat entry, exposed as `DockerManager.hostSessionsDir(id)`.
  `startContainer` mkdirs it (recursive, never clears) before `docker run`,
  so stop/rebuild/recreate preserve session files on the host.
- The host-side habitat session machinery reads any sessions dir via
  `--sessions-dir` (`umwelten browse --sessions-dir`, `umwelten sessions
  habitat list/show --sessions-dir`) — no new adapter code needed, exactly as
  the issue intended.

## Permissions

- Base habitat image runs as root → writes to the bind fine. The
  coding-agent image (#123) chowns `/data` recursively as root each boot
  before dropping to node — which now also covers the bind mount. On macOS
  Docker Desktop, uid mapping makes host reads trivially fine; on Linux the
  files appear as the container's uid (root or 1000) — readable for
  introspection run as the same user or via group/ACL setup (noted in PR).

## Verified live

- Fresh Gaia → entry → start → A2A chat → host has
  `sessions/egress-demo/ctx-egress-1/{transcript.jsonl,meta.json}`;
  `sessions habitat show` reads 2 messages from the host copy; stop +
  rebuild (volume reseed) leaves host files intact.
- Quirk noticed: `sessions habitat list` shows `0 msg` for the session while
  `show` correctly reports 2 — pre-existing list-stats display issue,
  unrelated to egress.
