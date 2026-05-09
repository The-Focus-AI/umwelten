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
- [x] Reasoning/thinking: full pipeline runner → bridge → SSE → UI, collapsible thinking block
- [x] Artifact system: `publish_artifact` + `list_artifacts` tools, `/api/artifacts` endpoint
- [x] Artifact metadata: name, description, mimeType, timestamp, sessionId, sourcePath
- [x] Artifacts pane in header: thumbnails visible across all tabs, click for detail overlay
- [x] Sessions browser tab: list sessions, click to view full message history with tool calls
- [x] Settings tab: inference form, full config.json, mise.toml dependencies, env var status
- [x] `/api/settings` endpoint — config, deps, env vars
- [x] `/files/*` serves files from work dir with proper MIME types and sandbox checks
- [x] Platform instructions guide model to use `publish_artifact` and `/files/` URLs
- [x] Tab order: Chat (default) → Sessions → Settings
- [x] Update `habitat serve` CLI — uses unified server by default, `--mcp-only` for legacy
- [x] Export `startContainerServer` from habitat index
- [x] Integration tested: health, UI, API, artifacts, sessions all working

## Phase 5: A2A Agent (DONE)

A2A sits alongside `/api/chat` — both are thin protocol adapters over ChannelBridge.
Browser → POST /api/chat → ChannelBridge → LLM + tools
A2A client → POST /a2a → ChannelBridge → LLM + tools
MCP client → POST /mcp → Raw tools (no LLM)

- [x] Add `@a2a-js/sdk` dependency
- [x] Create `src/habitat/a2a-handler.ts` — AgentExecutor wrapping ChannelBridge
- [x] `buildAgentCard()` — generates agent card from habitat config + stimulus
- [x] `HabitatAgentExecutor` — implements A2A AgentExecutor, bridges to ChannelBridge
- [x] Mount `/.well-known/agent-card.json` — agent card (always open, no auth)
- [x] Mount `/a2a` — A2A JSON-RPC endpoint (streaming + non-streaming)
- [x] Context-keyed sessions (`a2a:{contextId}` → ChannelBridge channel key)
- [x] Map published artifacts → A2A Artifact parts (FilePart with URI + metadata)
- [x] Export `createA2AHandler`, `buildAgentCard`, `HabitatAgentExecutor` from habitat index
- [x] TypeScript clean, all tests pass (no new failures)

## Phase 6: Gaia as Habitat Orchestrator (DONE)

Multi-habitat management: dashboard, Docker lifecycle, secret isolation, A2A discovery, Gaia chat.

- [x] `src/habitat/gaia/types.ts` — `GaiaHabitatEntry`, `GaiaRegistry`, `ContainerStatus`, `GaiaOrchestratorOptions`
- [x] `src/habitat/gaia/registry.ts` — `GaiaRegistryManager` — load/save/CRUD for registry.json
- [x] `src/habitat/gaia/secrets.ts` — `GaiaSecretVault` — master vault + per-container `writeFilteredSecrets()`
- [x] `src/habitat/gaia/docker.ts` — `DockerManager` — build/start/stop/logs/status via docker CLI
- [x] `src/habitat/gaia/proxy.ts` — `proxyRequest()` + `fetchFromContainer()` — reverse proxy with auth injection
- [x] `src/habitat/gaia/a2a-client.ts` — `fetchAgentCard()`, `sendA2AMessage()`, `discoverHabitats()`
- [x] `src/habitat/gaia/gaia-tools.ts` — `createGaiaToolSet()` — 14 tools as a ToolSet (closure over registry/vault/docker)
- [x] `src/habitat/gaia/routes.ts` — All API route handlers (registry, lifecycle, proxy, secrets, docker)
- [x] Gaia runs on `startContainerServer` (not a custom server) — gets sessions, MCP, A2A, artifacts for free
- [x] `src/habitat/gaia/ui/index.html` — Dashboard (Chat, Habitats, Secrets, Create tabs)
- [x] `src/habitat/gaia/index.ts` — Barrel exports
- [x] `src/cli/habitat.ts` — `habitat gaia` subcommand (--port, --data-dir, --provider, --model)
- [x] `src/habitat/index.ts` — Export gaia types/functions
- [x] `.gitignore` — `gaia-data/`
- [x] TypeScript clean, all tests pass (no new failures)

## Infrastructure: Port Scheme + Docker Volumes + Test Split (DONE)

- [x] Establish 74xx port block: Gaia 7420, legacy web 7421, habitat serve 7430, managed containers 7440-7499
- [x] Update all default ports in CLI, container-server, gaia-server, mcp-local-server
- [x] Switch `docker-compose.yml` from bind mounts to named Docker volumes
- [x] `DockerManager.seedVolume()` — write files into named volumes via one-shot Alpine containers
- [x] Update Dockerfile comments for new port scheme (internal 8080 unchanged)
- [x] Split test suite: `*.test.ts` (unit, no external deps) vs `*.integration.test.ts` (needs real APIs/services)
- [x] Create `vitest.integration.config.ts` with 60s timeout
- [x] Rename 14 integration tests (providers, cognition, memory, habitat, cli)
- [x] Add `test:integration` and `test:all` scripts to package.json
- [x] Update vitest.config.ts to exclude `*.integration.test.ts`
- [x] Update CLAUDE.md with port scheme table, test suite docs, gaia orchestrator docs

## Phase 7: Config-Driven Skill Management (IN PROGRESS)

Goal: Gaia manages habitat skills declaratively through config, not runtime delegation. A habitat rebuilt from scratch should fully recreate with all skills, secrets, and model config.

- [x] Add `skillsFromGit` to `CreateHabitatOptions` type
- [x] Wire `skillsFromGit` through registry.create() → entry.config
- [x] Add `skillsFromGit` param to `create_habitat` Gaia tool
- [x] Add `add_skill` Gaia tool — appends to `entry.config.skillsFromGit`, persists to registry
- [x] Add `remove_skill` Gaia tool — removes from array, persists
- [x] Add `list_skills` Gaia tool — shows configured skills
- [x] Update STIMULUS.md template — config-driven, never runtime delegation
- [x] Strip `secretsToolSet` from Gaia-managed containers — secrets are read-only, managed by Gaia's master vault
- [x] `update_habitat_config` tool — set provider, model, and other config fields
- [x] Integrate `npx skills` ecosystem — skills-lock.json seeded into volumes, entrypoint runs `npx skills experimental_install`
- [x] `buildSeedFiles` generates `skills-lock.json` from `config.skillsFromGit`
- [x] `add_skill`/`remove_skill` re-seed volume on config change
- [x] Habitat loads skills from `.agents/skills/` (npx skills install location) in addition to `./skills/`
- [ ] Verify round-trip: config → seedVolume → container start → skills installed via npx skills → working → destroy → rebuild → still works

## Phase 0: Break Circular Dependency (DONE)

Break the `habitat ↔ ui/bridge` circular dependency. UI code (Layer 8) was importing the concrete `Habitat` class from Layer 6, while habitat imported `ChannelBridge`/`WebAdapter` from ui — a Layer 6 ↔ 8 cycle.

- [x] Extract `AgentHost` interface in `src/habitat/types.ts` — minimal interface for platform adapters
- [x] Move `writeSessionTranscript`/`coreMessagesToJSONL` to `src/session-record/transcript-write.ts` (no habitat deps)
- [x] Make `src/habitat/transcript.ts` a thin re-export for backwards compat
- [x] Update `ChannelBridge` to depend on `AgentHost` instead of concrete `Habitat`
- [x] Inject `buildAgentStimulus` and `runClaudeSDK` as callbacks (no direct import from ui → habitat)
- [x] Update `src/ui/web/types.ts` — `RouteContext.habitat` and `WebServerConfig.habitat` now `AgentHost`
- [x] Update web route handlers (`sessions.ts`, `usage.ts`, `habitat.ts`) to use `AgentHost`
- [x] Update `a2a-handler.ts` to use `AgentHost` instead of `Habitat`
- [x] Update `habitat-agent.ts` (`buildAgentStimulus`, `HabitatAgent`) to use `AgentHost`
- [x] `Habitat` class now `implements AgentHost`
- [x] Export `AgentHost` from `src/habitat/index.ts`
- [x] Verify: `src/ui/` no longer imports concrete `Habitat` class — only `AgentHost` interface and pure types
- [x] TypeScript clean, all tests pass (no new failures)

## Backlog

- [ ] Agent definition export/import (persona, skills, tool config)
- [ ] Skills lock (`skills-lock.json` + verification)
- [ ] Tool exposure profiles (which tools visible via MCP vs A2A vs chat)
- [ ] A2A security schemes (bearer auth)
- [ ] Read-only vs operator vs admin modes
