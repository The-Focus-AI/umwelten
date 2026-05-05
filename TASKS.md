# Tasks — Habitat Architecture Implementation

## Phase 1: Habitat MCP Server (DONE)

- [x] Create `src/habitat/mcp-local-server.ts` — official SDK, Streamable HTTP, stateless
- [x] Bridge AI SDK tools → MCP tools via `registerTool()` (49 tools)
- [x] Add `habitat serve` CLI subcommand (--port, --host, --work-dir)
- [x] Export from `src/habitat/index.ts`
- [x] Verified: initialize, tools/list, tool calls, `mcp chat` end-to-end
- [x] Sessions default to `${workDir}/sessions/` (co-located, container-ready)
- [x] Removed `defaultSessionsDirName` — clean break from scattered session dirs
- [x] Updated CLAUDE.md docs (module map, CLI reference, directory layout)

## Phase 2: Docker Container (DONE)

- [x] `Dockerfile`: single-stage (node:22-slim), tsx runtime, git+ripgrep+ca-certificates, volume /data
- [x] WORKDIR `/habitat`, copies TS source directly (no tsc build step)
- [x] Uses `pnpm exec tsx` to run — same as dev
- [x] Volume at `/data` (config, sessions, skills, tools — all co-located)
- [x] Env var injection for secrets (Docker-native, `env_file: .env`)
- [x] `docker-compose.yml` for local dev
- [x] `/health` endpoint on MCP server
- [x] `.dockerignore`
- [x] `mise.toml` tasks: `habitat-build`, `habitat-run`, `habitat-serve`
- [x] Removed bridge system (Dagger sub-agent containers — incompatible with habitat-as-container model)

## Phase 2.5: Container Tool Hardening & Chat UX (DONE)

- [x] Strip container tools to minimal set (`containerToolSets`: file, time, url, secrets, self-modify, exec)
- [x] Add `bash` tool (`src/habitat/tools/exec-tools.ts`) — shell execution in work dir
- [x] Fix timeout: 30s → 120s default, explicit timeout detection (exit code 124 + message)
- [x] Fix buffer: 1MB → 4MB max output
- [x] Fix `read_file` vs `wget`/`markify` sandbox mismatch — `setDownloadsDir()` configures url tools to save inside work dir (no more env var hack)
- [x] Server-side tool call logging in MCP server (visible via `docker logs`)
- [x] `mcp chat` session persistence — transcripts saved to `~/.umwelten/mcp-sessions/`
- [x] Clean chat observer (`cleanChatObserver`) — compact tool call/result display
- [x] Streaming markdown rendering (`streammark`) — headings, code blocks, lists, tables rendered in terminal
- [x] Abort support — Escape key or Ctrl+C during generation aborts the stream
- [x] Context size in prompt — `[N msgs ~Xk tokens]` shown before each input
- [x] Slash commands: `/help`, `/tools`, `/context`, `/compact`, `/new`, `/fork`, `/quit`, `/logout`
- [x] `/compact` with accept/edit/revert flow (shows replacement, lets user review)
- [x] `/fork` creates new session with `forkedFrom` link

## Phase 3: Reproducible Habitat Provisioning with mise (DONE)

- [x] Extend `HabitatConfig` with `gitUrl`, `gitBranch`, `projectDir`, `requiredSecrets`
- [x] Add `RequiredSecret` type to `src/habitat/types.ts`
- [x] Add `resolveProjectDir()` helper to `src/habitat/config.ts`
- [x] Update `getFileAllowedRoots()` to include projectDir
- [x] Create `src/habitat/tools/provision-tools.ts` — 5 tools: `provision_from_git`, `provision_update`, `install_package`, `declare_secret`, `provision_status`
- [x] Register `provisionToolSet` in `containerToolSets`
- [x] Update Dockerfile: add mise, curl; create entrypoint
- [x] Create `entrypoint.sh`: auto-provision on boot (clone + mise install if config.json has gitUrl)
- [x] Update `load-prompts.ts`: resolve STIMULUS.md from projectDir as fallback
- [x] Update `exec-tools.ts`: default cwd to projectDir when provisioned
- [x] Export new types and tool sets from `src/habitat/index.ts`
- [x] TypeScript clean, all tests pass (no new failures)

## Phase 4: Unified Container Server (DONE)

- [x] Create `src/habitat/container-server.ts` — single HTTP server: MCP + chat + web UI
- [x] Mount MCP at `/mcp`, chat at `/api/chat`, default API routes, static UI at `/`
- [x] Create `src/ui/web/auth/bearer-auth.ts` — Bearer token auth via `HABITAT_API_KEY` env var
- [x] Auth: open by default, bearer token when `HABITAT_API_KEY` is set
- [x] `/health` and static UI always open (no auth required)
- [x] Create minimal chat UI (`src/habitat/container-ui/index.html`) — vanilla HTML/JS, no build step
- [x] Chat UI: streams AI SDK UI Message Stream, renders markdown, shows tool calls inline
- [x] Update `habitat serve` CLI — uses unified server by default, `--mcp-only` for legacy
- [x] Update Dockerfile comments
- [x] Export `startContainerServer` from habitat index
- [x] Integration tested: health, UI, API, 404 all working

## Phase 5: A2A Agent (Next)

A2A sits alongside `/api/chat` — both are thin protocol adapters over ChannelBridge.
Browser → POST /api/chat → ChannelBridge → LLM + tools
A2A client → POST /a2a → ChannelBridge → LLM + tools
MCP client → POST /mcp → Raw tools (no LLM)

- [ ] Add `@a2a-js/sdk` dependency
- [ ] Mount `/.well-known/agent.json` — agent card generated from config + stimulus
- [ ] Mount `/a2a` — A2A endpoint wrapping ChannelBridge with task lifecycle
- [ ] Context-keyed sessions (contextId → habitat sessionId)
- [ ] Artifact production from file tool results
- [ ] Test: send A2A message, get response, verify agent card

## Backlog

- [ ] Agent definition export/import (persona, skills, tool config)
- [ ] Skills lock (`skills-lock.json` + verification)
- [ ] Tool exposure profiles (which tools visible via MCP vs A2A vs chat)
- [ ] A2A security schemes (bearer auth)
- [ ] Read-only vs operator vs admin modes
