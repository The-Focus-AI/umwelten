# Gaia per-entry Docker image — codebase research (issue #115)

Date: 2026-06-10. Scope: add an optional `image` field to Gaia registry entries
so specialized agents run their own Docker image. No new external technology —
the Docker CLI is driven via `execFile` exactly as today; prior art for mocking
it lives in `fnox.test.ts`.

## Current state

- **Hardcoded image**: `packages/habitat/src/tools/gaia/docker.ts:47` —
  `const IMAGE_NAME = "habitat"`. Used in `buildImage()` (build tag),
  `startContainer()` (final `docker run` arg), and `imageExists()`
  (`docker image inspect`).
- **Registry**: `packages/habitat/src/tools/gaia/types.ts` —
  `GaiaHabitatEntry` has no image field; `GaiaRegistry` is unversioned JSON
  (`registry.json` in the data dir), so an optional field is backward
  compatible with zero migration.
- **Entry creation sites** that need to accept the field:
  1. `GaiaRegistryManager.create()` (registry.ts:76) — builds the entry.
  2. `POST /api/habitats` (routes.ts:195) — passes the JSON body straight to
     `registry.create()`, so it works once the type/creation accept it.
  3. `create_habitat` tool (gaia-tools/habitats.ts:59) — zod schema needs the
     field; params pass through to `registry.create()`.
  4. `export_habitat` / `import_habitat` (habitats.ts:421/445) — the export
     blob must carry the image so a recreated habitat keeps it.
- **`registry.update()`** (registry.ts:117) whitelists updatable fields via a
  `Pick` — `image` must be added there to be settable after creation.
- **Lifecycle flows** (`/start`, `/rebuild` routes; `start_habitat`,
  `rebuild_habitat` tools) all funnel through `DockerManager.startContainer(entry, ...)`,
  which already receives the full entry — one change point.
- **Error surfacing**: the start route wraps `startContainer` in try/catch →
  `{ error }` 500; rebuild and tools propagate to the container-server's
  global catch. A thrown Error with a clear message is enough.
- **Build task** (`buildImage()`, `build_image` tool, `GET /api/docker/status`)
  stays about the default image only — specialized images are built out of
  band per the PRD.

## Plan

- `image?: string` on `GaiaHabitatEntry` + `CreateHabitatOptions`.
- `DEFAULT_IMAGE_NAME` exported from docker.ts; `imageExists(image = DEFAULT_IMAGE_NAME)`;
  `startContainer` runs `entry.image ?? DEFAULT_IMAGE_NAME` and **pre-checks
  existence when a custom image is set**, throwing a clear error instead of
  silently falling back.
- Thread the field through registry create/update, the create_habitat zod
  schema, and the export/import blob.

## Testing

- Registry round-trip with real fs in a tmp dir (`GaiaRegistryManager` takes a
  dataDir; `load()` → `create()` → re-`load()`).
- Docker arg construction with `node:child_process` mocked at module level
  (fnox.test.ts pattern: callback-based `execFile` mock compatible with
  `promisify`), asserting the image positional arg and the missing-image error
  with no `docker run` issued.
