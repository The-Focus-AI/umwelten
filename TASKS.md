# Tasks

## Completed

- [x] Add `@dagger.io/dagger` dependency (v0.19.9)
- [x] Create `src/evaluation/dagger/types.ts` - Type definitions for DaggerRunner
- [x] Create `src/evaluation/dagger/prompts.ts` - LLM prompt templates for container config
- [x] Create `src/evaluation/dagger/language-detector.ts` - Static configs + package detection
- [x] Create `src/evaluation/dagger/container-config-cache.ts` - Memory + disk cache with LRU eviction
- [x] Create `src/evaluation/dagger/llm-container-builder.ts` - LLM integration for dynamic config
- [x] Create `src/evaluation/dagger-runner.ts` - Main DaggerRunner class
- [x] Create `src/evaluation/dagger/index.ts` - Module exports
- [x] Update `src/evaluation/code-scorer.ts` - Import DaggerRunner
- [x] Update `src/evaluation/strategies/code-generation-evaluation.ts` - Import DaggerRunner
- [x] Move test script to `src/test/test-dagger-runner.ts`
- [x] Verify implementation works with TypeScript, Python, and other languages
- [x] Test Ruby with gems (feedjira, faraday) - Successfully ran feed_reader.rb
- [x] Deprecate old docker-runner.ts with warning
- [x] Create `docs/guide/code-execution.md` - Comprehensive documentation with examples
- [x] Update `docs/.vitepress/config.ts` - Add Code Execution to sidebar
- [x] Update `docs/index.md` - Add Code Execution feature section

## Current: Claude Agent Monitor (Phase 1 - Session Browser)

See [docs/claude-agent-monitor.md](docs/claude-agent-monitor.md) for full design.

### Core Module
- [ ] `umwelten-4n9` - Create session types in src/sessions/types.ts
- [ ] `umwelten-yoo` - Build session store to read sessions-index.json
- [ ] `umwelten-bhx` - Build JSONL parser for session transcripts
- [ ] `umwelten-pf7` - Build stream formatter for live stream-json output

### CLI Commands
- [ ] `umwelten-uct` - Add sessions command to CLI (src/cli/sessions.ts)
- [ ] `umwelten-55r` - Implement sessions list command
- [ ] `umwelten-x8f` - Implement sessions show command
- [ ] `umwelten-ix2` - Implement sessions messages command
- [ ] `umwelten-yj1` - Implement sessions tools command
- [ ] `umwelten-59b` - Implement sessions stats command
- [ ] `umwelten-zsy` - Implement sessions format command (stdin pipe)
- [ ] `umwelten-72b` - Implement sessions export command

## Planned

### Phase 2: Session Analysis
- [ ] Implement sessions search command
- [ ] Implement sessions compare command
- [ ] Implement sessions summary command
- [ ] Implement sessions cost command
- [ ] Add session analytics aggregation

### Phase 3: Agent Monitor (Scheduled Runs)
- [ ] Create monitor repo add/list/remove commands
- [ ] Create monitor task create/list/enable/disable commands
- [ ] Implement ClaudeRunner for CLI execution
- [ ] Implement DaggerSandbox for containerized runs
- [ ] Implement TaskScheduler with node-cron
- [ ] Create SQLite database for monitor state
- [ ] Implement monitor serve web dashboard
- [ ] Add SSE for live run updates
- [ ] Implement session continuation from monitor

### Backlog
- [ ] Test LLM-based container configuration with valid OpenRouter API key
- [ ] Add environment variables for OpenRouter LLM configuration in Dagger
- [ ] Update existing docker-runner tests to work with DaggerRunner
- [ ] Remove deprecated docker-runner.ts in future release
