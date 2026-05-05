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

- [x] `Dockerfile`: multi-stage (node:22-slim), git+ripgrep, volume /data
- [x] Volume at `/data` (config, sessions, skills, tools — all co-located)
- [x] Env var injection for secrets (Docker-native)
- [x] `docker-compose.yml` for local dev
- [x] `/health` endpoint on MCP server
- [x] `.dockerignore`
- [x] Tested: build, run, health, initialize, tools/list, tool calls, write persistence, `mcp chat` end-to-end

## Phase 3: Agent Definition & Inference Attachment

Make habitats configurable and clonable.

- [ ] Define `agent-definition.json` format (persona, skills, tool config — NOT secrets, NOT inference)
- [ ] `export_agent_definition` / `import_agent_definition` tools
- [ ] `attach_inference(provider, model, apiKey)` tool
- [ ] Test: create habitat A, configure, export, import into B

## Phase 4: Skills Lock

Integrate with `npx skills` standard.

- [ ] `skills-lock.json` format + verification
- [ ] `install_skill` tool (updates config + lock)
- [ ] Boot-time lock verification
- [ ] Test: install skill, restart, skill persists

## Phase 5: A2A Agent (Outer Layer)

Add the external interaction protocol. The A2A layer sits ON TOP of the MCP layer:
- A2A receives messages → creates/resumes habitat sessions → runs LLM with tools → returns task updates
- MCP is raw tool access (no LLM, no sessions, no state)

- [ ] Add `@a2a-js/sdk` dependency
- [ ] `src/habitat/a2a-serve.ts`: AgentCard generation, AgentExecutor, task lifecycle
- [ ] Mount at A2A endpoint + `/.well-known/agent-card.json`
- [ ] Context-keyed sessions (contextId → habitat sessionId)
- [ ] Artifact production from tool results
- [ ] Test: send A2A message, get response, verify agent card

## Phase 6: Access Control

- [ ] Tool exposure profiles in config (which tools are visible via MCP vs A2A)
- [ ] A2A security schemes (bearer auth)
- [ ] Read-only vs operator vs admin modes
