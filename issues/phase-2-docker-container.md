# Phase 2: Docker Container

Package habitat as a container-ready runtime with co-located data, sessions, config, skills, and tools.

## Acceptance criteria

- [x] Dockerfile uses `node:22-slim`, tsx runtime, git, ripgrep, ca-certificates
- [x] WORKDIR `/habitat`; TypeScript source runs directly without a tsc build step
- [x] Volume at `/data` for config, sessions, skills, tools
- [x] Docker-native env var injection for secrets via `env_file: .env`
- [x] `docker-compose.yml` exists for local development
- [x] `/health` endpoint exists on MCP server
- [x] `.dockerignore` exists
- [x] `mise.toml` tasks: `habitat-build`, `habitat-run`, `habitat-serve`
- [x] Remove old Dagger bridge system incompatible with habitat-as-container model
