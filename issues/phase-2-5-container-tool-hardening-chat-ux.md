# Phase 2.5: Container Tool Hardening & Chat UX

Harden container tool exposure and improve MCP chat usability, persistence, streaming display, and context management.

## Acceptance criteria

- [x] Strip container tools to minimal `containerToolSets`
- [x] Add `bash` tool in `src/habitat/tools/exec-tools.ts`
- [x] Increase timeout default to 120s and detect explicit timeout exits
- [x] Increase max output buffer to 4MB
- [x] Configure URL downloads inside work dir with `setDownloadsDir()`
- [x] Add server-side tool call logging in MCP server
- [x] Persist `mcp chat` transcripts to `~/.umwelten/mcp-sessions/`
- [x] Add clean chat observer and streaming markdown rendering
- [x] Support Escape/Ctrl+C abort during generation
- [x] Show context size in prompt
- [x] Add slash commands: `/help`, `/tools`, `/context`, `/compact`, `/new`, `/fork`, `/quit`, `/logout`
- [x] `/compact` supports accept/edit/revert flow
- [x] `/fork` creates linked fork sessions
