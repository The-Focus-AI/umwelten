# Active Context

## Current Date: Thu Apr 10 11:48:47 EDT 2025

### Current Focus: Standardizing Cost Calculations in Tests

We have updated the cost tests in `costs.test.ts` to align with the standardized cost calculation per million tokens. This involved adjusting mock data and expectations to ensure consistency across the application and tests.

### Key Accomplishments:
- Updated mock model costs to reflect per-million-token pricing.
- Adjusted test expectations to use `toBeCloseTo` for floating-point comparisons.
- Verified that all cost-related tests pass with the new standardization.

### Blockers
- None currently.

### Next Steps
- Proceed with the next development task as per the project plan.

## CRITICAL IMPLEMENTATION RULES
1. ALWAYS use Vercel AI SDK wrappers for ALL providers
   - OpenRouter: @openrouter/ai-sdk-provider
   - Google: @ai-sdk/google
   - Ollama: ollama-ai-provider
2. NEVER use provider-specific SDKs directly (e.g., @google/generative-ai)
3. This ensures consistent interfaces and behavior across all providers
4. All providers must implement the LanguageModelV1 interface from the 'ai' package

## Current Focus
Improving CLI testing infrastructure and enhancing test result visibility.

### What's Being Worked On
- [-] Implementing proper API error mocking
- [-] Adding process.exit handling in tests
- [-] Fixing models command error handling
- [-] Adding test coverage for edge cases
- [X] Added `runCommand` to CLI and integrated with `generateText` function

### Current State
- [X] Core package is stable with all tests passing
- [!] CLI package has test failures in models command

### Next Steps
1. Improve CLI testing infrastructure:
   - [-] Implement proper API error mocking
   - [-] Add process.exit handling in tests
   - [-] Fix models command error handling
   - [-] Add test coverage for edge cases

2. Enhance test result visibility:
   - [ ] Improve logging and output formatting for test results
   - [ ] Ensure test failures are clearly documented and actionable

3. Update documentation:
   - [ ] Add provider implementation guide
   - [ ] Document test patterns and examples for each provider

### Blockers
- [!] CLI tests failing due to API errors and process.exit handling

### Recent Decisions
- [X] Improve API error mocking in CLI tests
- [X] Handle process.exit differently in test environment
- [X] Add debug logging in tests
- [X] Standardize test structure across providers

### Key Findings
- [X] Verified `LanguageModelV1` interface methods: `doGenerate`, `doStream`
- [X] Ensured alignment with core testing strategies
- [X] Tests successfully verify OpenRouter provider functionality

## Dependencies
Current core dependencies:
- ai: ^4.2.5 (Vercel AI SDK core)
- @ai-sdk/google: Latest (Vercel wrapper)
- @openrouter/ai-sdk-provider: ^0.4.3
- ollama-ai-provider: ^1.2.0
- zod: ^3.22.4

### Implementation Status
- [X] Core interface refactoring completed
- [X] ModelRunner implementation completed
- [-] Provider updates and test coverage in progress

### Next Actions
- [-] Update provider implementations to match new interface
- [-] Add comprehensive test suite
- [-] Update documentation with new patterns
- [-] Verify all providers work with new execution flow

### Blockers
- [!] Need to verify token counting and cost calculation for all providers through Vercel AI SDK wrappers

### Recent Decisions
- [X] Must use Vercel AI SDK wrappers for all providers
- [X] Using dynamic model listing where available
- [X] Standardizing on LanguageModelV1 interface from 'ai' package
- [X] Verified all dependencies are at their latest versions

### Current Status
- [X] CLI implementation is complete with improved formatting, better error handling, and enhanced user experience features.

### Notes
- The CLI now provides a polished, user-friendly interface
- All core functionality is implemented and working
- Code organization follows best practices with clear separation of concerns
- Documentation needs to be completed
- CRITICAL: All providers must use Vercel AI SDK wrappers 

### Test Infrastructure
- Console output capture
- Command argument parsing
- Mock data generation
- Cleanup utilities

### Test Patterns
1. Command Testing:
   - Parse arguments
   - Execute command
   - Verify output
   - Clean up mocks

2. Output Verification:
   - Capture console output
   - Parse JSON when needed
   - Check formatting
   - Verify error messages

3. Error Handling:
   - Mock API errors
   - Verify error messages
   - Check error formatting
   - Ensure proper cleanup

### Dependencies
Current test dependencies:
- vitest: Testing framework
- commander: Command parsing
- chalk: Output formatting
- cli-table3: Table formatting

### Testing Guidelines
1. Mock external dependencies
2. Capture and verify console output
3. Clean up mocks after each test
4. Test both success and error cases
5. Verify formatting and display

### Current Test Coverage
- Models Command:
  - [X] Basic listing
  - [X] JSON output
  - [X] Provider filtering
  - [X] Model details
  - [X] Error handling

- Evaluate Command:
  - [ ] Config loading
  - [ ] Model evaluation
  - [ ] Result formatting
  - [ ] Error handling

- Evals Command:
  - [ ] Config management
  - [ ] Batch processing
  - [ ] Progress display
  - [ ] Error handling 

### Test Failures
- [!] OpenRouter Provider - Model Listing: Missing "modelId" property
- [!] OpenRouter Provider - Text Generation: Rate limit exceeded
- [!] OpenRouter Provider - Handle Longer Conversations: Rate limit exceeded
- [!] OpenRouter Provider - Respect Temperature Setting: Rate limit exceeded

### Decision
- Address test failures later and update memory accordingly. 