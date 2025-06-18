# Active Context
Last Updated: Fri Apr 18 12:19:35 EDT 2025

## Current Focus
Designing evaluation strategies for model responses, incorporating both deterministic (unit test style) and AI-assisted evaluation approaches.

## Evaluation Strategy Types

### 1. Deterministic Evaluations
These are unit-test style evaluations with clear pass/fail criteria:

1. Schema Validation
   - Zod schema conformance
   - Required field presence
   - Data type correctness
   - Field format validation

2. Content Structure Tests
   - Array length requirements
   - Object property presence
   - Numerical range validation
   - String pattern matching

3. Factual Accuracy Tests
   - Known value matching
   - Date/time accuracy
   - URL validity
   - Numerical precision

4. Format Compliance
   - JSON structure
   - Markdown formatting
   - HTML validity
   - Code syntax checking

### 2. AI-Assisted Evaluations
Using evaluation models to assess qualitative aspects:

1. Content Quality Assessment
   ```typescript
   interface QualityMetrics {
     relevance: number;      // 0-10 scale
     completeness: number;   // 0-10 scale
     accuracy: number;       // 0-10 scale
     coherence: number;      // 0-10 scale
     reasoning: number;      // 0-10 scale
   }
   ```

2. Response Comparison
   - Compare multiple model outputs
   - Identify unique insights
   - Assess reasoning paths
   - Evaluate completeness

3. Creative/Subjective Tasks
   - Writing style analysis
   - Code quality review
   - Design suggestion evaluation
   - Problem-solving approach

### Implementation Plan

1. Evaluation Interface
```typescript
interface ResponseEvaluation {
  // Deterministic checks
  schemaValidation: {
    passed: boolean;
    errors?: string[];
  };
  contentChecks: {
    passed: boolean;
    results: Record<string, boolean>;
  };
  
  // AI-assisted evaluation
  qualityMetrics?: QualityMetrics;
  comparisonResults?: ComparisonAnalysis;
  
  // Overall scores
  scores: {
    technical: number;    // 0-100, based on deterministic checks
    qualitative: number;  // 0-100, based on AI evaluation
    overall: number;      // Weighted combination
  };
}
```

2. Evaluation Configuration
```typescript
interface EvaluationConfig {
  // Deterministic checks
  schema?: z.ZodSchema;
  contentChecks?: {
    name: string;
    check: (response: any) => boolean;
  }[];
  
  // AI evaluation settings
  useAiEvaluation?: boolean;
  evaluationPrompt?: string;
  evaluationModel?: ModelDetails;
  
  // Scoring weights
  weights?: {
    technical: number;
    qualitative: number;
  };
}
```

3. Result Storage
```typescript
interface EvaluationResult {
  metadata: {
    testId: string;
    modelDetails: ModelDetails;
    timestamp: string;
    config: EvaluationConfig;
  };
  evaluation: ResponseEvaluation;
  rawResponse: any;
  processingMetrics: {
    responseTime: number;
    tokenUsage: TokenUsage;
    cost: number;
  };
}
```

## Implementation Priorities

1. Deterministic Framework
   - [ ] Create base evaluation runner
   - [ ] Implement schema validation
   - [ ] Add content check system
   - [ ] Build scoring calculator

2. AI Evaluation System
   - [ ] Design evaluation prompts
   - [ ] Implement quality metric collection
   - [ ] Create comparison system
   - [ ] Build scoring aggregator

3. Integration Layer
   - [ ] Combine evaluation types
   - [ ] Implement weighted scoring
   - [ ] Add result storage
   - [ ] Create comparison views

## Example Evaluations

1. Factual Extraction Test
```typescript
const config: EvaluationConfig = {
  schema: z.object({
    title: z.string(),
    date: z.string().datetime(),
    author: z.string(),
    topics: z.array(z.string())
  }),
  contentChecks: [
    {
      name: "hasValidTitle",
      check: (r) => r.title.length > 0 && r.title.length < 200
    }
  ]
};
```

2. Creative Writing Evaluation
```typescript
const config: EvaluationConfig = {
  useAiEvaluation: true,
  evaluationPrompt: `
    Evaluate this creative writing response on:
    1. Originality (0-10)
    2. Narrative structure (0-10)
    3. Character development (0-10)
    4. Language use (0-10)
    5. Overall impact (0-10)
  `,
  weights: {
    technical: 0.2,   // Basic formatting, grammar
    qualitative: 0.8  // AI evaluation score
  }
};
```

## Next Steps
1. Implement base evaluation runner
2. Create initial deterministic checks
3. Design AI evaluation prompts
4. Build result storage system

## CRITICAL IMPLEMENTATION RULES
1. All evaluations must be reproducible
2. Store raw responses alongside evaluations
3. Clear separation between deterministic and AI-assisted evaluations
4. Comprehensive metadata for all evaluations
5. Enable easy result comparison and analysis

## Current Status
- [X] Evaluation framework implementation complete
- [X] Multiple example implementations working
- [-] Results analysis and visualization planning
  - [ ] Results storage format design
  - [ ] Analysis metrics definition
- [X] Core evaluation framework implemented and stable
- [X] Multiple example implementations showing different use cases
- [X] File caching and result storage working effectively
- [X] Support for multiple model providers integrated

## Implementation Examples
1. Document Analysis
   - [X] PDF parsing implementation
   - [X] HTML site analysis
   - [X] Pricing data extraction

2. Media Processing
   - [X] Audio transcription with metadata
   - [X] Structured data extraction

3. Provider Integration
   - [X] Google (Gemini models)
   - [X] Ollama (local models)
   - [X] OpenRouter integration

## Framework Features
1. Core Components
   - [X] Abstract EvaluationRunner base class
   - [X] Flexible model response handling
   - [X] Structured data validation with Zod
   - [X] File caching system

2. Data Management
   - [X] Automatic workspace creation
   - [X] Result caching and storage
   - [X] Test data organization
   - [X] HTML/file content caching

3. Model Integration
   - [X] Multiple provider support
   - [X] Consistent interface across providers
   - [X] Structured response handling
   - [X] Error management

## Next Steps
1. [ ] Add more comprehensive documentation
2. [ ] Create additional example implementations
3. [ ] Add performance metrics collection
4. [ ] Implement result comparison tools

## Blockers
None currently identified.

## Recent Decisions
1. Framework successfully simplified to focus on practical evaluation cases
2. File caching and workspace management working effectively
3. Multiple real-world examples demonstrate framework capabilities
4. Structured data validation proving valuable for complex use cases

## Implementation Pattern
```typescript
class SpecificEvaluator extends EvaluationRunner {
  constructor(evaluationId: string, ...specificParams) {
    super(evaluationId);
    // Store specific configuration
  }

  async getModelResponse(details: ModelDetails): Promise<ModelResponse> {
    // Implementation specific logic
    return response;
  }
}
```

## Directory Structure
```
scripts/                    # Example implementations
  ├── google-pricing.ts    # Price extraction example
  ├── site-info.ts        # Website analysis
  ├── pdf-parsing.ts      # Document processing
  ├── transcribe.ts       # Audio transcription
  └── ...

output/
  evaluations/
    {evaluationId}/
      responses/
        {modelName}-{provider}.json
```

## CRITICAL IMPLEMENTATION RULES
1. ALWAYS use Vercel AI SDK wrappers for ALL providers
   - OpenRouter: @openrouter/ai-sdk-provider
   - Google: @ai-sdk/google
   - Ollama: ollama-ai-provider
2. NEVER use provider-specific SDKs directly
3. All providers must implement LanguageModelV1 interface from 'ai' package

## Current Implementation Status
The evaluation framework has proven successful with multiple real-world implementations:

1. Price Data Extraction
   - Structured data extraction from web pages
   - Complex schema validation
   - Multiple model comparison

2. Site Analysis
   - HTML parsing and metadata extraction
   - Category and content organization
   - URL and feed processing

3. Document Processing
   - PDF content analysis
   - Text extraction and summarization
   - Multiple model comparison

4. Audio Processing
   - Transcription with metadata
   - Speaker identification
   - Topic extraction and segmentation

Each implementation demonstrates the framework's flexibility while maintaining consistent patterns for:
- Data caching
- Result storage
- Model evaluation
- Error handling

The framework is now stable and ready for additional implementations and enhancements.

## Current Focus
Simplifying the evaluation framework to focus on model testing and comparison.

## Current Status
- [-] Replacing complex evaluation framework with simpler ModelEvaluation approach
- [-] Updating test infrastructure for better usability
- [-] Streamlining result storage and analysis

## What's Being Worked On
1. Simplifying evaluation framework
   - Removing complex configuration system
   - Implementing straightforward test runner
   - Adding clear results storage

2. Test Infrastructure Updates
   - Creating ModelTest interface
   - Implementing ModelEvaluation class
   - Setting up results directory structure

3. CLI Updates
   - Simplifying evaluate command
   - Adding test running capabilities
   - Improving results display

## Next Steps
1. Implement new ModelEvaluation class
2. Update CLI evaluate command
3. Set up results storage structure
4. Convert existing tests to new format

## Blockers
None currently identified.

## Recent Decisions
1. Simplify evaluation framework to focus on model testing
2. Store test results in organized directory structure
3. Focus on cost and performance metrics
4. Make test creation and running more straightforward

## Implementation Plan
1. File Updates:
   - Replace runner.ts with new ModelEvaluation class
   - Update CLI evaluate command
   - Remove unnecessary config files

2. Directory Structure:
```
output/
  evaluations/
    test-name-YYYY-MM-DD-HH-mm-ss/
      results.json      # Test results and metrics
```

3. Key Features:
   - Simple test definition
   - Multiple model support
   - Cost tracking
   - Performance metrics
   - Clear results storage

## Testing Guidelines
1. Each test should be self-contained
2. Results should be easily comparable
3. Costs should be clearly tracked
4. Performance metrics should be consistent

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

## 2025-06-18: LM Studio Provider Integration Complete
- LM Studio provider implemented using REST API
- Registered in model registry and CLI
- Tests use first loaded model for text generation
- Error handling for invalid model IDs is robust
- All provider tests pass

### Next Steps
- Consider adding modality support (text, vision, etc.)
- Further enhancements as needed 