# Model Evaluation Tool Architecture
Last Updated: 2025-03-26 12:00:00 EDT

## Overview
A tool for evaluating and comparing different LLM models across providers, with a focus on cost management, rate limiting, and comprehensive testing.

## Directory Structure
```
packages/
  core/
    src/
      costs/           # Cost calculation and tracking
        costs.ts
        costs.test.ts
      models/          # Model definitions and interfaces
        models.ts
        models.test.ts
      providers/       # Provider implementations
        openrouter.ts
        openrouter.test.ts
        ollama.ts
        ollama.test.ts
      rate-limit/      # Rate limit handling
        rate-limit.ts
        rate-limit.test.ts
      test-utils/      # Shared test utilities
        setup.ts
        mocks.ts
    package.json
    tsconfig.json
    vitest.config.ts
```

## Core Components

### Model Runner
- Unified interface for model interactions
- Provider-specific implementations (OpenRouter, Ollama)
- Streaming support (planned)
- Function calling capabilities (planned)

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
- Core model runner
- Basic provider implementations
- Cost calculation and tracking
- Rate limit handling
- Test infrastructure

### In Progress
- Streaming support
- Function calling
- Advanced error handling
- Performance testing

### Planned Features
- CLI implementation
- System message support
- Budget management
- Usage optimization

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