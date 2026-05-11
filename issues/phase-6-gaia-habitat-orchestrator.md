# Phase 6: Gaia as Habitat Orchestrator

Implement Gaia as a normal habitat that orchestrates multiple managed habitat containers, secrets, lifecycle, discovery, proxying, and dashboard interactions.

## Acceptance criteria

- [x] Add Gaia types, registry manager, secret vault, Docker manager, proxy helpers, A2A client, tools, routes, UI, and barrel exports
- [x] Gaia runs on `startContainerServer` and inherits sessions, MCP, A2A, and artifacts
- [x] Add Gaia dashboard with Chat, Habitats, Secrets, and Create tabs
- [x] Add `habitat gaia` CLI subcommand with port/data-dir/provider/model options
- [x] Export Gaia types/functions from habitat index
- [x] Ignore `gaia-data/`
- [x] TypeScript clean and tests pass
