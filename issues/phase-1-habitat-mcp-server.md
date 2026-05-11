# Phase 1: Habitat MCP Server

Create a stateless local MCP server for habitat tools using the official MCP SDK and expose it through the CLI.

## Acceptance criteria

- [x] Create `src/habitat/mcp-local-server.ts`
- [x] Bridge AI SDK tools to MCP tools via `registerTool()`
- [x] Add `habitat serve` CLI subcommand with `--port`, `--host`, `--work-dir`
- [x] Export from `src/habitat/index.ts`
- [x] Verify initialize, tools/list, tool calls, and `mcp chat` end-to-end
- [x] Sessions default to `${workDir}/sessions/`
- [x] Remove `defaultSessionsDirName`
- [x] Update CLAUDE.md docs
