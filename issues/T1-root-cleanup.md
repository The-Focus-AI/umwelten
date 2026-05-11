# T1: Root Directory Cleanup

> Parent PRD: [Habitat Credential Catalog & Permissions Model](../../docs/architecture/habitat-permissions-prd.md)

## What to build

Move habitat-specific deployment artifacts out of the monorepo root and into the habitat package. Tidy the root to only contain library code, project docs, and tooling config.

**Moves into `packages/habitat/`:**
- `Dockerfile` → `packages/habitat/Dockerfile`
- `docker-compose.yml` → `packages/habitat/docker-compose.yml`
- `entrypoint.sh` → `packages/habitat/entrypoint.sh`

These are the only files that actually move. All file content stays the same except for paths that need updating (Dockerfile COPY paths, docker-compose volume mounts, entrypoint.sh work-dir references).

**Adds to `.gitignore`:**
- `habitat-data/`
- `input/`
- `output/`
- `test-data/`
- `test-output/`
- `*.tgz`

**Moves to `docs/assets/`:**
- The 8 architecture diagram PNGs (`habitats-architecture*.png`, `habitats-business.png`, `habitats-datasheet.png`, `habitats-manifesto.png`, `habitats-poster.png`, `habitats-usecases.png`, `habitats-vs.png`)
- `umwelten-architecture.png`

**Stays at root (unchanged):**
- Standard project files: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `mise.toml`, `LICENSE`, `README.md`
- Top-level docs: `CHANGELOG.md`, `CLAUDE.md`, `LLM.txt`, `FEATURES.md`, `TASKS.md`, `TESTING.md`
- Deliverables: `OVERVIEW.html`, `OVERVIEW.pdf`
- Research: `reports/`
- Tooling: `knip.json`, `vitest.config.ts`, `vitest.integration.config.ts`, `.npmignore`, `.dockerignore`, `env.template`, `.gitattributes`

## Acceptance criteria

- [x] `Dockerfile`, `docker-compose.yml`, `entrypoint.sh` exist only in `packages/habitat/`, not at root
- [x] `docker build -t habitat .` succeeds from `packages/habitat/`
- [x] Dockerfile paths (COPY, WORKDIR, etc.) reference correct locations relative to the habitat package
- [x] `.gitignore` includes `habitat-data/`, `input/`, `output/`, `test-data/`, `test-output/`, `*.tgz`
- [x] Architecture PNGs are in `docs/assets/` and not at root
- [x] All existing tests pass (`pnpm test:run`)
- [x] `mise run habitat-build` still works (update task path if needed)

- [x] Move 10 architecture PNGs to `docs/assets/`
- [x] Root cleanup complete; tests pass aside from pre-existing better-sqlite3 native module failures

## Blocked by

None — can start immediately.
