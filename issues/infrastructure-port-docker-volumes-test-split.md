# Infrastructure: Port Scheme, Docker Volumes, and Test Split

Standardize runtime ports, move managed containers to named Docker volumes, and split unit from integration tests.

## Acceptance criteria

- [x] Establish 74xx port block: Gaia 7420, legacy web 7421, habitat serve 7430, managed containers 7440-7499
- [x] Update default ports in CLI, container-server, gaia-server, and mcp-local-server
- [x] Switch docker-compose from bind mounts to named Docker volumes
- [x] Add `DockerManager.seedVolume()` using one-shot Alpine containers
- [x] Update Dockerfile comments for port scheme
- [x] Split unit `*.test.ts` and integration `*.integration.test.ts`
- [x] Add `vitest.integration.config.ts` with 60s timeout
- [x] Rename integration tests
- [x] Add `test:integration` and `test:all` scripts
- [x] Exclude integration tests from unit vitest config
- [x] Update CLAUDE.md docs
