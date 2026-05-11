# Phase 0: Break Circular Dependency

Break the `habitat ↔ ui/bridge` circular dependency by making UI/platform adapters depend on interfaces and callbacks rather than the concrete `Habitat` class.

## Acceptance criteria

- [x] Extract `AgentHost` interface in `src/habitat/types.ts`
- [x] Move `writeSessionTranscript`/`coreMessagesToJSONL` to `src/session-record/transcript-write.ts`
- [x] Make `src/habitat/transcript.ts` a thin re-export for backwards compatibility
- [x] Update `ChannelBridge` to depend on `AgentHost`
- [x] Inject `buildAgentStimulus` and `runClaudeSDK` as callbacks
- [x] Update web route types and handlers to use `AgentHost`
- [x] Update A2A and habitat-agent code to use `AgentHost`
- [x] `Habitat` implements `AgentHost`
- [x] Export `AgentHost` from `src/habitat/index.ts`
- [x] Verify `src/ui/` no longer imports concrete `Habitat`
- [x] TypeScript clean and tests pass
