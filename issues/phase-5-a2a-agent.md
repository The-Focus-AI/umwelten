# Phase 5: A2A Agent

Expose habitats as A2A agents alongside `/api/chat` and `/mcp`, using ChannelBridge as the protocol-neutral LLM/tool adapter.

## Acceptance criteria

- [x] Add `@a2a-js/sdk` dependency
- [x] Create `src/habitat/a2a-handler.ts`
- [x] Implement `buildAgentCard()` from habitat config + stimulus
- [x] Implement `HabitatAgentExecutor` over ChannelBridge
- [x] Mount `/.well-known/agent-card.json`
- [x] Mount `/a2a` JSON-RPC endpoint with streaming and non-streaming support
- [x] Use context-keyed sessions (`a2a:{contextId}`)
- [x] Map published artifacts to A2A Artifact parts
- [x] Export A2A helpers from habitat index
- [x] TypeScript clean and tests pass
