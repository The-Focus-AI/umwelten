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

## Current

(None)

## Planned

- [ ] Test LLM-based container configuration with valid OpenRouter API key
- [ ] Add environment variables for OpenRouter LLM configuration in Dagger
- [ ] Update existing docker-runner tests to work with DaggerRunner
- [ ] Remove deprecated docker-runner.ts in future release
