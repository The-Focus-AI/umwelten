# Plan: Promote Habitat Tools to Standalone MCP Servers

## Context

Today there are two separate worlds:

- **Habitat tools**: Vercel AI SDK `Tool` objects loaded from `tools/` directories (`TOOL.md` + `handler.ts`), running inside a Habitat process.
- **mcp-serve framework**: Standalone OAuth-authenticated MCP servers (twitter-mcp, oura-mcp) where tools are hand-written as `McpToolRegistrar` functions.

There's no bridge between them. If you build a useful tool in a habitat, promoting it to a deployable MCP server requires rewriting the tool registration code by hand. This plan creates a reusable path from habitat tools to standalone MCP servers.

## Design

### Two Auth Modes

Tools fall into two categories:

- **API-key tools**: Use `process.env` for secrets (e.g., weather API). Need MCP-level OAuth for client auth, but no upstream OAuth flow.
- **Upstream OAuth tools**: Wrap an OAuth-protected API (Twitter, Oura). Need the full upstream OAuth chain, and the tool handler needs `getUpstreamToken()`.

The system supports both, and allows mixing them in one server.

### Key Idea

A `promote.json` manifest describes which tools to include and what auth mode to use. A new `promote` CLI command can:
1. **serve** — run the MCP server in-process for dev/testing
2. **scaffold** — generate a standalone deployable project

## Implementation

### Step 1: Extract `registerAiTool` to shared location

**Create** `src/habitat/mcp-serve/register-ai-tool.ts` — extract the function from `container-server.ts:60-90`.

**Modify** `src/habitat/container-server.ts` — import from shared location instead of local definition.

**Modify** `src/habitat/mcp-local-server.ts` — import from shared location (if it has its own copy).

### Step 2: Make `upstream` optional in mcp-serve

**Modify** `src/habitat/mcp-serve/types.ts`:
- `McpServeConfig.upstream` becomes `upstream?: UpstreamOAuthProvider`
- `McpHandlerConfig.upstream` becomes optional too

**Modify** `src/habitat/mcp-serve/server.ts`:
- Skip `/oauth/authorize` and `/oauth/upstream-callback` routes when no upstream
- When no upstream, `/oauth/authorize` auto-approves: generates a synthetic userId (from client_id), creates auth code, redirects back immediately — no upstream redirect

**Modify** `src/habitat/mcp-serve/oauth/authorize.ts`:
- `handleAuthorize` accepts `upstream?: UpstreamOAuthProvider`
- When undefined, skip upstream redirect — generate userId + auth code directly

**Modify** `src/habitat/mcp-serve/mcp-handler.ts`:
- `getValidUpstreamToken` returns a clear error when no upstream configured
- `McpHandlerConfig.upstream` becomes optional

### Step 3: Create promote types

**Create** `src/habitat/mcp-serve/promote/types.ts`:

```typescript
export interface PromoteManifest {
  name: string;
  version?: string;
  description?: string;
  auth: { mode: 'none' } | { mode: 'api-key' } | { mode: 'upstream-oauth'; provider: string };
  tools: ToolSource[];
  requiredEnv?: string[];
  port?: number;
  staticRoot?: string;
}

export type ToolSource =
  | { type: 'directory'; path: string }
  | { type: 'handler'; path: string };
```

### Step 4: Create promote loader

**Create** `src/habitat/mcp-serve/promote/loader.ts`:
- `loadToolsFromManifest(manifest, baseDir)` resolves `ToolSource[]` into `Record<string, Tool>`
- Uses existing `loadToolsFromDirectory()` from `src/stimulus/tools/loader.ts` for directory sources
- Uses `loadToolFromPath()` for single handler sources
- Passes a context object `{ getUpstreamToken, userId, env }` to factory-pattern handlers

### Step 5: Create registrar builder

**Create** `src/habitat/mcp-serve/promote/build-registrar.ts`:
- `buildRegistrarFromAiTools(tools)` converts `Record<string, Tool>` into `McpToolRegistrar`
- Uses the extracted `registerAiTool` from Step 1
- For factory-pattern handlers that need upstream tokens, the context is wired through

### Step 6: Create in-process serve

**Create** `src/habitat/mcp-serve/promote/serve.ts`:
- `serveFromManifest(manifestPath)` — loads manifest, resolves tools, builds registrar, calls `createMcpServer`
- Validates required env vars
- Always requires `DATABASE_URL` — creates `NeonStore` (Neon has a free tier, keeps things simple)

### Step 7: Create scaffold generator

**Create** `src/habitat/mcp-serve/promote/scaffold.ts`:
- `scaffoldProject(manifest, outputDir)` generates:
  - `server.ts` — thin entry point (like twitter-mcp's)
  - `package.json` — with `umwelten` dependency
  - `tsconfig.json`
  - `Dockerfile` — based on twitter-mcp pattern
  - `fly.toml` — template
  - `db-setup.ts` — if using NeonStore
  - Copies referenced tool directories into the output

### Step 8: Add CLI commands

**Create** `src/cli/promote.ts`:

```
umwelten promote serve [--manifest promote.json] [--port 8080]
  Starts the promoted MCP server in-process for dev/testing.

umwelten promote scaffold [--manifest promote.json] [--output ./my-mcp-server]
  Generates a standalone deployable project.

umwelten promote init [--name my-mcp]
  Creates a starter promote.json in the current directory.
```

**Modify** `src/cli/cli.ts` — register the `promote` command.

### Step 9: Create example

**Create** `examples/promoted-mcp/` — a minimal example showing:
- A `tools/` directory with one or two simple tools (TOOL.md + handler.ts)
- A `promote.json` manifest
- A README explaining the flow

## Files Summary

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/habitat/mcp-serve/register-ai-tool.ts` | Shared AI SDK to MCP tool bridge |
| Create | `src/habitat/mcp-serve/promote/types.ts` | Manifest types |
| Create | `src/habitat/mcp-serve/promote/loader.ts` | Resolve tool sources |
| Create | `src/habitat/mcp-serve/promote/build-registrar.ts` | Tools to McpToolRegistrar |
| Create | `src/habitat/mcp-serve/promote/serve.ts` | In-process dev server |
| Create | `src/habitat/mcp-serve/promote/scaffold.ts` | Generate standalone project |
| Create | `src/habitat/mcp-serve/promote/index.ts` | Barrel exports |
| Create | `src/cli/promote.ts` | CLI commands |
| Create | `examples/promoted-mcp/` | Working example |
| Modify | `src/habitat/mcp-serve/types.ts` | Make upstream optional |
| Modify | `src/habitat/mcp-serve/server.ts` | Handle missing upstream |
| Modify | `src/habitat/mcp-serve/oauth/authorize.ts` | Auto-approve when no upstream |
| Modify | `src/habitat/mcp-serve/mcp-handler.ts` | Handle missing upstream |
| Modify | `src/habitat/container-server.ts` | Use shared registerAiTool |
| Modify | `src/cli/cli.ts` | Register promote command |

## Key Reuse

- `loadToolsFromDirectory()` / `loadToolFromPath()` from `src/stimulus/tools/loader.ts` — already handles TOOL.md + handler.ts loading with factory pattern
- `registerAiTool()` from `src/habitat/container-server.ts:60-90` — already converts AI SDK tools to MCP tools
- `createMcpServer()` from `src/habitat/mcp-serve/server.ts` — full OAuth MCP server framework
- `NeonStore` from `src/habitat/mcp-serve/neon-store.ts` — Postgres persistence
- Dockerfile pattern from `examples/twitter-mcp/Dockerfile`

## Verification

1. **Unit tests**: Run `pnpm test:run` to ensure no regressions from extracting registerAiTool and making upstream optional
2. **Dev serve test**: Create a simple tool in `examples/promoted-mcp/tools/`, run `dotenvx run -- pnpm run cli promote serve --manifest examples/promoted-mcp/promote.json`, connect with `dotenvx run -- pnpm run cli mcp chat --url http://localhost:8080/mcp`
3. **Scaffold test**: Run `promote scaffold`, verify the generated project builds with `cd output && pnpm install && pnpm build`
4. **Existing mcp-serve**: Verify twitter-mcp and oura-mcp examples still work (upstream is still provided, no behavior change)
