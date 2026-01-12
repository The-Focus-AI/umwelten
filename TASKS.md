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
- [x] Create test script `scripts/test-dagger-runner.ts`
- [x] Verify implementation works with TypeScript, Python, and other languages

## Current

(None)

## Planned

- [ ] Test LLM-based container configuration with OpenRouter
- [ ] Add environment variables for OpenRouter LLM configuration
- [ ] Test with packages that need installation (pandas, lodash, etc.)
- [ ] Update existing docker-runner tests to work with DaggerRunner
- [ ] Consider deprecating old docker-runner.ts
