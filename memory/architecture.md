# Architecture Documentation
Last Updated: 2025-04-15 10:57:06 EDT

## CRITICAL IMPLEMENTATION RULES
1. ALWAYS use Vercel AI SDK wrappers for ALL providers
   - OpenRouter: @openrouter/ai-sdk-provider
   - Google: @ai-sdk/google
   - Ollama: ollama-ai-provider
2. NEVER use provider-specific SDKs directly (e.g., @google/generative-ai)
3. This ensures consistent interfaces and behavior across all providers
4. All providers must implement the LanguageModelV1 interface from 'ai' package

## Model Routing Architecture
We use a route-based approach for model identification that clearly separates:
1. The actual model ID (e.g., "gemini-2.5-pro")
2. The original provider (e.g., "google")
3. The access route (e.g., "direct" or "openrouter")
4. Optional variants (e.g., "free" for OpenRouter variants)

### Model Route Interface
```typescript
interface ModelRoute {
  name: string;      // Base model identifier
  provider: string;     // Original provider
  variant?: string;     // Optional variant (e.g. "free")
}
```

### Model ID Format Examples
1. Direct Access:
   ```
   "gemini-2.5-pro-exp-03-25"  // Direct Google access
   ```

2. OpenRouter Access:
   ```
   "openrouter/google/gemini-2.5-pro-exp-03-25:free"  // Via OpenRouter with variant
   ```

3. Configuration Format:
   ```json
   {
     "models": [
       {
         "id": "gemini-2.5-pro-exp-03-25",
         "route": "direct",
         "provider": "google"
       },
       {
         "id": "gemini-2.5-pro-exp-03-25",
         "route": "openrouter",
         "provider": "google",
         "variant": "free"
       }
     ]
   }
   ```

## Tech Stack
- TypeScript/Node.js
- Vercel AI SDK (Core)
  - @ai-sdk/google (Google provider wrapper)
  - @openrouter/ai-sdk-provider (OpenRouter provider wrapper)
  - ollama-ai-provider (Ollama provider wrapper)
- Zod for schema validation
- Commander.js for CLI

## Implementation Patterns
1. Provider Interface
   - All providers MUST implement LanguageModelV1 interface from 'ai' package
   - Use Vercel AI SDK wrappers for consistent behavior
   - Standardized error handling across providers

2. Model Management
   - Dynamic model listing where available
   - Consistent model ID format
   - Proper error handling for unavailable models

3. Evaluation Process
   - Structured configuration files
   - Clear separation of concerns
   - Consistent scoring mechanism

4. Streaming Patterns
   - **Real-Time Object Streaming**: Use `streamObject` with `partialObjectStream`
   - **Immediate Results**: Use `generateObject` with Zod schemas
   - **Text Streaming**: Use `streamText` for real-time text chunks
   - **Flexible JSON**: Use `generateText` + JSON parsing for dynamic schemas
   - **Avoid**: `await result.object` from `streamObject` (hangs indefinitely)

## Best Practices
1. Code Organization
   - Clear directory structure
   - Modular components
   - Type safety with TypeScript
   - Consistent error handling

2. Provider Implementation
   - ALWAYS use Vercel AI SDK wrappers
   - Implement LanguageModelV1 interface
   - Handle rate limits and retries
   - Proper error propagation

3. Streaming Implementation
   - Use `partialObjectStream` for real-time object streaming
   - Avoid `await result.object` which hangs indefinitely
   - Iterate over partial objects and merge them
   - Use `streamText` for real-time text streaming
   - Use `generateObject` for immediate structured results

4. Testing
   - Unit tests for core functionality
   - Integration tests for providers
   - End-to-end evaluation tests
   - Direct SDK testing to isolate implementation issues

## Directory Layout

```
model-eval/
├── src/                  # Core source code
│   ├── models/          # Model interfaces, runners (Base, Smart)
│   ├── providers/       # Provider implementations
│   ├── costs/           # Cost calculation
│   ├── memory/          # Memory store, hooks, MemoryRunner
│   ├── cli/             # CLI command implementations
│   ├── conversation/    # Conversation management
│   ├── rate-limit/      # Rate limit handling
│   └── test-utils/      # Shared test utilities
├── examples/            # Example usage and data
├── memory/              # Project memory files (docs, plans)
├── output/              # Generated output files
├── scripts/             # Utility scripts
└── tests/               # (Deprecated, tests are colocated)
```

## Implementation Patterns

### Provider Integration
1. Each provider has its own file in `src/providers/`
2. Provider-specific logic stays in provider files
3. Common interface exposed through `index.ts`
4. URL generation handled by each provider

### Error Handling
1. Classify errors properly (transient vs permanent)
2. Implement appropriate retry mechanisms
3. Provide clear, actionable error messages
4. Handle EPIPE errors for pipe operations

### Testing Strategy
1. Tests colocated with source files
2. Feature-based directory structure
3. Centralized test utilities
4. Comprehensive test coverage

### CLI Design
1. Progressive disclosure of complexity
2. Consistent color coding
3. Human-readable formatting
4. Proper error handling

### Documentation
1. README in each package
2. Type definitions as documentation
3. Clear examples and usage
4. Environment variable documentation

## Best Practices

### Code Organization
1. Keep provider-specific logic isolated
2. Use interfaces for common patterns
3. Minimize abstractions
4. Follow feature-based structure

### Testing
1. Write tests alongside code
2. Use descriptive test names
3. Test error conditions
4. Verify formatting and display

### Error Handling
1. Clear error messages
2. Proper error classification
3. Retry mechanisms where appropriate
4. User-friendly error display

### Documentation
1. Keep docs up to date
2. Include examples
3. Document configuration
4. Explain design decisions

## Directory Structure Details
```
src/
  cli/             # CLI command implementations
    cli.ts
    chat.ts
    ...
  conversation/    # Conversation management
    conversation.ts
  costs/           # Cost calculation and tracking
    costs.ts
    costs.test.ts
  memory/          # Memory system components
    memory_store.ts
    memory_runner.ts
    extract_facts.ts
    determine_operations.ts
    types.ts
    *.test.ts
  models/          # Model interfaces and runners
    types.ts
    runner.ts        # BaseModelRunner
    smart_runner.ts  # SmartModelRunner (hookable)
    models.ts
    *.test.ts
  providers/       # Provider implementations
    index.ts
    base.ts
    google.ts
    ollama.ts
    openrouter.ts
    *.test.ts
  rate-limit/      # Rate limit handling
    rate-limit.ts
    rate-limit.test.ts
  test-utils/      # Shared test utilities
    setup.ts
```

## Core Components

### Model Runner
- `BaseModelRunner`: Core logic for interacting with models via Vercel AI SDK.
- `SmartModelRunner`: Extends `BaseModelRunner` to add hook support (before, during, after).
- `MemoryRunner`: Extends `SmartModelRunner`, configured with memory extraction and update hooks.
- Unified `ModelRunner` interface.
- Streaming and object generation support via Vercel AI SDK.

### Cost Management
- Pre-execution cost estimation
- Post-execution cost calculation
- Token usage tracking
- Cost breakdown formatting
- Budget management (planned)

### Rate Limit Handling
- Request rate tracking
- Exponential backoff with jitter
- Provider-specific rate limit detection
- Concurrent request management

### Test Infrastructure
- Colocated tests with source files
- Feature-based directory organization
- Centralized test utilities
- Comprehensive coverage strategy
  - Core functionality tests
  - Provider-specific tests
  - Error handling scenarios
  - Performance metrics

### CLI Interface (`src/cli/`)
- Command-line interface for model interaction and evaluation.
- Uses `commander.js`.
- `run`: Single prompt execution.
- `chat`: Interactive chat sessions with optional file attachments and memory.
  - `--memory`: Enables `MemoryRunner` with fact extraction and memory updates.
  - Commands: `/?` (help), `/reset` (clear history), `/mem` (show memory), `/history` (show messages).
- `models`: List, inspect models.
- `eval`: Run evaluations (planned).
- Clear user feedback and error handling.

## Provider Integration Guide

### Adding a New Provider

1. Provider Setup
   - Create new provider file in `src/providers/`
   - Implement provider interface:
     ```typescript
     export interface Provider {
       getModelUrls(): Promise<Record<string, string>>;
       getAvailableModels(): Promise<ModelDetails[]>;
       calculateCosts(model: string, promptTokens: number, completionTokens: number): ModelCosts;
     }
     ```

2. Required Components
   - Model URL generation logic
   - Available models fetching
   - Cost calculation implementation
   - Type definitions and validation
   - Error handling and retries
   - Rate limit management

3. Integration Steps
   a. Create Provider File
      - Add provider-specific configuration
      - Implement core interfaces
      - Add type definitions
      - Handle authentication

   b. Update Core Files
      - Add to provider index
      - Update model interfaces if needed
      - Add new capabilities or features
      - Update type definitions

   c. Testing
      - Create provider test file
      - Add unit tests for core functionality
      - Add integration tests
      - Test error scenarios
      - Verify cost calculations

   d. Documentation
      - Update README with new provider
      - Document authentication requirements
      - Add usage examples
      - Update environment variables

4. Validation Checklist
   - [ ] Core interface implementation complete
   - [ ] Error handling implemented
   - [ ] Rate limiting configured
   - [ ] Tests written and passing
   - [ ] Documentation updated
   - [ ] Examples added
   - [ ] Cost calculation verified
   - [ ] Type definitions complete

5. Best Practices
   - Keep provider-specific logic isolated
   - Use consistent error handling patterns
   - Implement proper rate limiting
   - Add comprehensive tests
   - Document authentication clearly
   - Provide usage examples
   - Consider backwards compatibility

6. Common Patterns
   - Authentication handling
   - Rate limit implementation
   - Error classification
   - Cost calculation
   - Model capability mapping
   - URL generation

7. Testing Requirements
   - Unit tests for core functionality
   - Integration tests with actual API
   - Error scenario coverage
   - Rate limit testing
   - Cost calculation verification
   - Type safety validation

8. Documentation Requirements
   - Setup instructions
   - Authentication guide
   - Environment variables
   - Usage examples
   - Rate limit details
   - Cost calculation explanation
   - Troubleshooting guide

### Provider-Specific Considerations

1. Authentication
   - API key management
   - Environment variables
   - Configuration validation
   - Security best practices

2. Rate Limiting
   - Provider-specific limits
   - Retry strategies
   - Backoff implementation
   - Concurrent request handling

3. Cost Management
   - Token counting methods
   - Price calculation
   - Usage tracking
   - Budget controls

4. Error Handling
   - Provider-specific errors
   - Retry strategies
   - User feedback
   - Logging requirements

5. Model Capabilities
   - Feature support
   - Token limits
   - Special parameters
   - Performance characteristics

## Implementation Guidelines

### Code Organization
1. Feature-based directory structure
2. Colocated test files
3. Shared utilities in dedicated directories
4. Clear separation of concerns

### Testing Strategy
1. Unit tests for core functionality
2. Integration tests for provider interactions
3. Error scenario coverage
4. Performance benchmarks
5. Mock providers for testing

### Error Handling
1. Standardized error classification
2. Provider-specific error mapping
3. Rate limit detection and recovery
4. Comprehensive error logging

### Performance Considerations
1. Token processing optimization
2. Rate limit compliance
3. Memory usage monitoring
4. Response time tracking

## Success Metrics
1. Test coverage > 90%
2. Response time < 500ms
3. Memory usage < 100MB
4. Error recovery rate > 99%
5. Cost estimation accuracy > 95%

## Library Decisions
- TypeScript for type safety
- Vitest for testing
- pnpm for package management
- OpenRouter and Ollama as initial providers

## Version Management
- Semantic versioning
- Changelog maintenance
- Breaking change documentation
- Migration guides

## Cost Estimation and Tracking
1. Token counting
2. Provider rate tracking
3. Budget management
4. Usage optimization

## Current Implementation Status

### Completed Features
- Core model runner (`BaseModelRunner`)
- Hookable runner (`SmartModelRunner`)
- Memory-augmented runner (`MemoryRunner`) with fact extraction and update hooks.
- In-memory store (`InMemoryMemoryStore`).
- Provider implementations (Google, Ollama, OpenRouter) via Vercel AI SDK.
- Cost calculation and tracking.
- Rate limit handling.
- Test infrastructure (Vitest).
- CLI with `run` and `chat` commands (including memory support and chat commands).

### In Progress
- Refinement of memory prompts and logic.
- More robust error handling in specialists.

### Planned Features
- Persistent memory storage options (e.g., file-based, database).
- Evaluation framework (`eval` command).
- More sophisticated memory retrieval/context injection.
- Budget management.

## Testing Organization
1. Test Colocation
   - Tests located next to source files
   - Clear relationship between implementation and tests
   - Easy navigation and maintenance

2. Feature-Based Structure
   - Each feature in dedicated directory
   - Implementation and tests together
   - Clear ownership and responsibility

3. Test Utilities
   - Centralized in test-utils
   - Shared mocks and helpers
   - Common test setup

4. Coverage Strategy
   - Core functionality
   - Provider-specific features
   - Error scenarios
   - Performance metrics

5. Test Categories
   - Unit tests for isolated components
   - Integration tests for provider interaction
   - Error handling validation
   - Performance benchmarks

## Provider Implementation Patterns

### Core Principles
1. **Interface-First Development**
   - Start with core system interfaces (e.g., `ModelDetails`)
   - Transform external data directly to these interfaces
   - Avoid intermediate types/interfaces unless absolutely necessary
   - Let TypeScript infer types where possible

2. **Data Transformation**
   - Keep transformations simple and direct
   - Use const assertions for static data
   - Inline simple helper functions unless reused
   - Document external data sources (e.g., pricing URLs)

3. **Type Safety**
   - Use TypeScript's type inference
   - Add explicit types only where needed for clarity
   - Use const assertions for static data
   - Trust the compiler to catch type errors

4. **API Integration**
   - Focus on system's core interfaces
   - Transform external data at the boundary
   - Don't preserve unnecessary API structure
   - Document API versions and endpoints

### Example Implementation
```typescript
// 1. Import core interfaces only
import type { ModelDetails } from '../models/models';

// 2. Static data with const assertion
const PRICING = {
  'model-a': { promptTokens: 0.001, completionTokens: 0.002 },
  default: { promptTokens: 0.0005, completionTokens: 0.001 }
} as const;

// 3. Direct transformation to core interface
async function getModels(): Promise<ModelDetails[]> {
  const data = await fetchFromAPI();
  
  return data.models.map(model => ({
    id: model.id,
    name: model.name,
    provider: 'provider' as const,
    costs: PRICING[model.id] || PRICING.default,
    // ... other direct mappings
  }));
}
```

### Anti-Patterns to Avoid
1. **Unnecessary Abstractions**
   ```typescript
   // DON'T: Create interfaces mirroring API
   interface APIResponse {
     models: Array<{
       // ... duplicating ModelDetails fields
     }>;
   }
   
   // DO: Transform directly to ModelDetails
   const models: ModelDetails[] = data.models.map(...)
   ```

2. **Complex Helper Functions**
   ```typescript
   // DON'T: Create helpers for simple transformations
   function getModelDates(name: string): Dates { ... }
   function getModelCosts(name: string): Costs { ... }
   
   // DO: Transform inline when simple
   addedDate: version?.includes('exp') ? new Date() : baseDate,
   costs: PRICING[modelId] || PRICING.default
   ```

3. **Type Overengineering**
   ```typescript
   // DON'T: Create complex type hierarchies
   type ModelPricing = { ... }
   type GeminiPricing = { [key in ModelTypes]: ModelPricing }
   
   // DO: Use const assertions and inference
   const PRICING = { ... } as const
   ```

### Directory Structure
```
packages/
  core/
    src/
      providers/
        google.ts      # Each provider in its own file
        openrouter.ts
        ollama.ts
      models/
        models.ts      # Core interfaces
      costs/
        costs.ts       # Cost calculation
```

### Implementation Checklist
- [ ] Review core interfaces before starting
- [ ] Plan data transformation approach
- [ ] Document any static data sources
- [ ] Keep transformations simple and direct
- [ ] Use TypeScript's type inference
- [ ] Add tests for edge cases
- [ ] Document API versions and endpoints
```

## 2025-06-18: LM Studio Provider Integration
- LM Studio provider uses REST API endpoints (`/api/v0/models`, `/api/v0/completions`)
- Provider registered in model registry and CLI
- Model details mapped from REST API (context length, type, etc.)
- Tests select first loaded model for text generation
- Error handling for invalid model IDs is robust
- All provider tests pass
