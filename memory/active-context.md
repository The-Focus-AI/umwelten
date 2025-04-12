# Active Context
Last Updated: April 12, 2025 13:01 EDT

## Current Focus
Improving cost display formatting in the CLI to ensure consistency and clarity.

## Current Status
- [X] Fixed cost formatting to consistently use per-million-token costs
- [X] Updated all cost display functions to handle free models correctly
- [X] Ensured proper type safety with null/undefined checks

## Next Steps
- [ ] Review other potential formatting inconsistencies
- [ ] Consider adding unit tests for cost formatting edge cases
- [ ] Consider adding configuration option for cost display units (per 1K vs per 1M tokens)

## Blockers
None currently.

## Recent Decisions
1. Standardized on per-million-token cost display across all views
2. Added clear suffixes ("/1M" or "/1M tokens") to indicate units
3. Consistent handling of free models by showing "Free" instead of "$0.0000"

## Current Focus
Moving away from monorepo structure to a simpler, single-package architecture.

## What's Being Worked On
- Restructuring project directory layout
- Updating documentation to reflect new structure
- Ensuring all file references are updated

## Current Structure Changes
- Moving from packages-based structure to direct src/tests/bin layout
- Consolidating core and CLI into single package
- Simplifying test organization
- Maintaining memory files as documentation

## Next Steps
1. Update package.json and dependencies
2. Verify all import paths in code
3. Update build and test scripts
4. Review and update documentation

## Blockers
None currently identified.

## Recent Decisions
1. Move away from monorepo structure for simpler maintenance
2. Keep core functionality and CLI in same package
3. Maintain separate test directories for better organization
4. Keep memory files for project documentation

## Current Date: Fri Apr 11 16:20:51 EDT 2025

### Current Focus: Refactoring BaseModelRunner

We have refactored the BaseModelRunner class to reduce duplication between the execute and stream methods. This involved consolidating error handling and streamlining logging to improve code readability and maintainability.

### Key Accomplishments:
- Extracted common logic into helper methods.
- Consolidated error handling into a single method.
- Streamlined logging to improve code readability.

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
- Expanded test coverage for EvaluationRunner.
- Fixed linter errors related to cost handling in runner.ts.

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

4. Monitor for any additional linter errors or test failures.
5. Ensure all changes are documented and reviewed for consistency.
6. Continue with any pending tasks or new features as planned.

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

## Next Steps
- Monitor for any additional linter errors or test failures.
- Ensure all changes are documented and reviewed for consistency.
- Continue with any pending tasks or new features as planned.
- Date: April 11, 2025 

## Current Status (2025-04-11)

### What's Working
- Conversation class successfully implemented
- File attachment support working
- BaseModelRunner refactored to use Conversation objects
- Code organization improved with proper directory structure

### Current Focus
- Testing and validating the new Conversation implementation
- Ensuring all file types are handled correctly
- Verifying the integration with BaseModelRunner

### Next Steps
1. Add more comprehensive tests for Conversation class
2. Implement validation for file attachments
3. Add support for chat history management
4. Consider additional file type support

### Blockers
None currently identified

### Recent Decisions
- Placed Conversation class in core/src/conversation
- Used CoreMessage from AI SDK for message handling
- Made ModelDetails, options, and prompt public for accessibility 