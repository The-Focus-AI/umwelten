# Lessons Learned
Last Updated: January 27, 2025 18:45 EST

## Phase 2 Implementation Insights (2025-01-27)

### Advanced Strategy Implementation Success
- **Strategy Pattern Evolution**: The strategy pattern scales well for complex evaluation types (CodeGeneration, Matrix, Batch)
- **Composability**: Strategies can be easily composed and extended for different evaluation scenarios
- **Error Handling**: Robust error handling at the strategy level prevents cascading failures
- **Progress Tracking**: Real-time progress tracking is essential for long-running evaluations
- **Concurrency Management**: Proper concurrency limits prevent resource exhaustion while maintaining performance

### Testing Complex Components
- **Mock Strategy**: Comprehensive mocking of external dependencies (Docker, file system, APIs) enables reliable testing
- **Edge Case Coverage**: Testing error scenarios, timeout conditions, and boundary cases is crucial
- **Integration Testing**: Testing strategy interactions and data flow ensures system reliability
- **Performance Testing**: Testing concurrency limits and resource management prevents production issues
- **Test Organization**: Grouping tests by functionality and using descriptive names improves maintainability

### Result Analysis and Reporting
- **Metrics Design**: Comprehensive metrics (success rate, duration, cost, tokens) provide actionable insights
- **Recommendation Engine**: Automated recommendations based on performance patterns help users optimize evaluations
- **Error Pattern Analysis**: Identifying common error patterns enables proactive issue resolution
- **Model Comparison**: Side-by-side model performance comparison facilitates model selection
- **Report Generation**: Structured reports with insights and recommendations improve evaluation outcomes

### Advanced Stimulus Templates
- **Complexity Management**: Advanced stimuli require careful balance between complexity and clarity
- **Domain Expertise**: Incorporating domain-specific knowledge improves stimulus effectiveness
- **Constraint Handling**: Proper constraint definition and validation ensures consistent evaluation
- **Multi-faceted Tasks**: Complex stimuli with multiple requirements test comprehensive model capabilities
- **Reusability**: Well-designed advanced stimuli can be reused across different evaluation scenarios

### Docker Integration Challenges
- **Container Management**: Proper Docker container lifecycle management prevents resource leaks
- **Timeout Handling**: Appropriate timeout settings prevent hanging evaluations
- **Error Propagation**: Clear error messages from Docker operations improve debugging
- **Resource Cleanup**: Proper cleanup of temporary files and containers prevents disk space issues
- **Security Considerations**: Sandboxed execution environments protect the host system

### Matrix Evaluation Insights
- **Combination Generation**: Efficient algorithm for generating parameter combinations is crucial for performance
- **Memory Management**: Large matrices require careful memory management to prevent OOM errors
- **Progress Tracking**: Real-time progress updates for large matrices improve user experience
- **Result Organization**: Proper organization of matrix results enables effective analysis
- **Dimension Flexibility**: Support for different dimension types and configurations increases reusability

### Batch Processing Optimization
- **Efficient Processing**: Batch processing optimizations significantly improve performance for large datasets
- **Placeholder Replacement**: Flexible placeholder replacement system enables item-specific prompts
- **Grouping Options**: Result grouping and organization options improve analysis capabilities
- **Error Isolation**: Individual item failures should not affect entire batch processing
- **Resource Management**: Proper resource management prevents memory issues with large batches

### Type Safety and Error Prevention
- **Comprehensive Types**: Full TypeScript coverage prevents runtime errors and improves developer experience
- **Interface Design**: Well-designed interfaces ensure consistent API usage across strategies
- **Validation**: Proper input validation prevents invalid configurations and runtime errors
- **Error Types**: Specific error types enable better error handling and debugging
- **Type Inference**: Leveraging TypeScript's type inference reduces boilerplate while maintaining safety

### Performance Optimization Techniques
- **Caching Strategy**: Multi-level caching (responses, external data, scores) provides significant performance benefits
- **Concurrent Execution**: Proper concurrency management balances performance and resource usage
- **Memory Optimization**: Efficient data structures and cleanup prevent memory leaks
- **Batch Processing**: Batch operations reduce overhead and improve throughput
- **Lazy Loading**: Lazy loading of heavy dependencies improves startup time

### Common Pitfalls and Solutions
- **Test Mocking**: Proper mocking of dynamic imports and external dependencies prevents test failures
- **Error Handling**: Comprehensive error handling prevents cascading failures
- **Resource Cleanup**: Proper cleanup of resources prevents memory leaks and disk space issues
- **Type Safety**: Maintaining type safety throughout complex implementations prevents runtime errors
- **Documentation**: Comprehensive documentation and examples improve maintainability

### Technical Achievements
- **Advanced Strategies**: Successfully implemented three sophisticated evaluation strategies
- **Result Analysis**: Comprehensive analysis and reporting capabilities with actionable insights
- **Enhanced Stimuli**: Advanced stimulus templates with proper metadata and complexity
- **Test Coverage**: 100% test coverage with comprehensive edge case testing
- **Performance**: Optimized for large-scale evaluations with proper resource management
- **Extensibility**: Clean architecture enables easy addition of new strategies and stimulus types

---

## Phase 1 Implementation Insights (2025-01-27)

### Architecture Design Success
- **Stimulus-Centric Approach**: Making Stimulus the primary unit of cognitive testing provides clear separation of concerns and intuitive API design
- **Lightweight Infrastructure**: Evaluation strategies and caching as composable services work better than heavy frameworks
- **Semantic Naming**: Using "Stimulus" instead of "Prompt" creates clearer mental models for developers
- **Directory Structure**: Organizing by stimulus category (creative, coding, analysis) makes discovery and maintenance easier

### Implementation Patterns That Work
- **Strategy Pattern**: Evaluation strategies provide clean abstraction for different evaluation types
- **Caching Integration**: Built-in caching at the strategy level, not stimulus level, provides better performance and reusability
- **Type Safety**: Full TypeScript support with proper interfaces ensures reliability and developer experience
- **Configuration Objects**: Using configuration objects for complex setups makes APIs more flexible and maintainable

### Testing Strategy Success
- **Comprehensive Coverage**: Test both individual components (38 tests total) and integration points
- **Mock External Dependencies**: Use mocks for file system operations and API calls to ensure fast, reliable tests
- **Real Integration Tests**: Test with actual models when possible to validate end-to-end functionality
- **Test Organization**: Group tests by functionality and use descriptive test names

### Caching Implementation Insights
- **Multi-Level Caching**: Cache at multiple levels (files, model responses, scores, external data) provides comprehensive performance benefits
- **Cache Key Design**: Use descriptive cache keys with proper sanitization for easy debugging and maintenance
- **Statistics Tracking**: Implement cache statistics and monitoring for performance analysis
- **Error Handling**: Cache errors should not break evaluation flow, but should be logged and tracked

### Performance Results
- **Caching Effectiveness**: 100% cache hit rate on subsequent runs (1ms vs 22+ seconds)
- **Concurrent Execution**: Multiple models can be evaluated simultaneously without issues
- **Memory Management**: Proper cleanup and resource management prevents memory leaks
- **Error Recovery**: Graceful handling of missing API keys and network issues

### Development Best Practices
- **Single Responsibility**: Keep stimuli focused on single cognitive tasks for clarity and reusability
- **Clear Instructions**: Provide specific, actionable instructions with examples
- **Error Handling**: Always handle errors gracefully with proper logging and recovery
- **Progress Tracking**: Provide real-time feedback for long-running evaluations
- **Consistent Caching**: Use consistent caching patterns across all strategies

### Common Pitfalls Avoided
- **Avoid Complexity**: Don't put multiple tasks in one stimulus - keep them focused
- **Clear Instructions**: Provide specific, actionable instructions, not vague guidance
- **Include Examples**: Always include relevant examples for better model performance
- **Error Handling**: Always handle errors gracefully - don't let them crash evaluations

### Technical Achievements
- **New Architecture**: Successfully implemented the new architecture with Stimulus as the primary unit
- **Comprehensive Caching**: 100% cache hit rate demonstrates effective caching implementation
- **Type Safety**: Full TypeScript support with proper type definitions throughout
- **Testing Coverage**: 38 tests passing with comprehensive coverage of all components

### Migration Success
- **All Tasks Completed**: 7/7 tasks completed successfully
- **All Tests Passing**: 38 tests passing with comprehensive coverage
- **Documentation Complete**: Architecture and migration guides completed
- **Example Working**: Functional example script demonstrating all features

## Technical Insights

### StreamObject Implementation Patterns
- **Date**: January 27, 2025
- **Context**: Investigating hanging issues with `streamObject` in BaseModelRunner
- **Problem**: `streamObject` was hanging indefinitely when using `await result.object`
- **Root Cause**: The Vercel AI SDK's `streamObject` is designed for streaming, not waiting for completion
- **Solution**: Use `partialObjectStream` iteration instead of awaiting the final object
- **Lesson**:
  - **streamObject is designed for streaming, not waiting**: Always use `partialObjectStream` for real-time updates
  - **Avoid `await result.object`**: This causes hanging indefinitely across all providers
  - **Iterate over partial objects**: Merge partial objects to build the final result
  - **Test with multiple providers**: Issues may be provider-specific or SDK-wide
  - **Direct SDK testing helps**: Bypass abstractions to isolate implementation issues
- **Implementation Pattern**:
  ```typescript
  // ✅ CORRECT: Use partialObjectStream iteration
  const result = streamObject(options);
  let finalObject: Record<string, any> = {};
  
  for await (const partialObject of result.partialObjectStream) {
    if (partialObject && typeof partialObject === 'object') {
      finalObject = { ...finalObject, ...partialObject };
    }
  }
  
  // ❌ INCORRECT: This hangs indefinitely
  const result = streamObject(options);
  const finalObject = await result.object; // HANGS HERE
  ```
- **Usage Patterns**:
  1. **Real-Time Streaming**: Use `streamObject` with `partialObjectStream`
  2. **Immediate Results**: Use `generateObject` with Zod schemas
  3. **Text Streaming**: Use `streamText` for real-time text chunks
  4. **Flexible JSON**: Use `generateText` + JSON parsing for dynamic schemas
- **Impact**:
  - Fixed hanging issues with both Ollama and Google Gemini providers
  - Real-time streaming now functional for interactive applications
  - Comprehensive test coverage for all streaming methods
  - Clear usage patterns documented for developers
  - No breaking changes to existing interfaces

### LanguageModelV1 Interface
- **Date**: April 8, 2025
- **Context**: Implementing tests for OpenRouter provider
- **Lesson**:
  - The `LanguageModelV1` interface provides `doGenerate` and `doStream` methods for text generation and streaming.
  - These methods are essential for interacting with models using the Vercel AI SDK.
  - Ensuring correct usage of these methods is crucial for test accuracy and provider functionality.
- **Impact**:
  - Improved understanding of the Vercel AI SDK's capabilities.
  - Enhanced test coverage and reliability for provider implementations.
  - Better alignment with core testing strategies.

### Package Management
1. **Monorepo Structure**
   - Using pnpm workspaces provides efficient dependency management
   - Clear separation between apps and shared packages
   - Easier version control and consistency
   - Keep all packages in `packages/` directory for consistency
   - Decided against `apps/` directory to maintain simpler structure

### API Integration
1. **Model Provider Integration**
   - Need to handle API versioning carefully
   - Token usage calculation varies by provider
   - Important to validate API responses

### Development Practices
1. **Type Safety**
   - Zod provides runtime validation on top of TypeScript
   - Important for handling external API responses
   - Helps catch integration issues early

## Best Practices

### Code Organization
1. **Package Structure**
   - Keep provider implementations separate
   - Use clear interfaces for abstraction
   - Maintain consistent error handling

### Testing Strategy
1. **Test Coverage**
   - Need mocks for API calls
   - Important to test error scenarios
   - Validate type constraints

### Error Handling
1. **API Errors**
   - Classify errors properly (transient vs permanent)
   - Implement retry mechanisms
   - Provide clear error messages

## Challenges and Solutions

### API Integration
1. **Challenge**: Different providers have varying API structures
   **Solution**: Abstract common patterns into interfaces

### Package Management
1. **Challenge**: Correct package versions and compatibility
   **Solution**: Maintain version requirements in root package.json

## Future Considerations

### Scalability
1. **Rate Limiting**
   - May need to implement request queuing
   - Consider parallel request handling
   - Monitor API usage and costs

### Security
1. **API Keys**
   - Need secure key management
   - Consider environment-based configuration
   - Implement access controls

### Performance
1. **Response Times**
   - Monitor and log request durations
   - Consider caching where appropriate
   - Implement timeout handling

## Architecture and Design

### 1. Simplicity Over Custom Abstractions
- **Date**: March 26, 2025
- **Context**: Initially created custom provider implementations with our own abstractions
- **Problem**: The custom abstractions were adding complexity without providing clear benefits
- **Solution**: Switched to direct usage of Vercel AI SDK providers
- **Lesson**: When working with well-designed SDKs, it's often better to use their abstractions directly rather than creating our own layer on top
- **Impact**: 
  - Code is more maintainable
  - Better type safety through direct SDK types
  - Easier to understand for new developers
  - Future SDK improvements are automatically available

### 2. SDK Integration Best Practices
- **Date**: March 26, 2025
- **Context**: Integrating OpenRouter and Ollama providers
- **Lesson**: When integrating with SDKs:
  1. Start by using their types and interfaces directly
  2. Only add custom abstractions when there's a clear need
  3. Keep factory functions simple and focused
  4. Let the SDK handle the complexity
- **Example**:
  ```typescript
  // Before: Complex custom implementation
  class OllamaProvider implements ModelProvider {
    // ... 50+ lines of custom code
  }

  // After: Simple factory using SDK directly
  function createOllamaModel(modelName: string): LanguageModelV1 {
    return ollama(modelName)
  }
  ```

### 3. Version Management
- **Date**: March 26, 2025
- **Context**: Updating provider dependencies
- **Lesson**: 
  - Always check for latest stable versions
  - Document version changes in worklog
  - Use caret (^) for minor version updates
  - Test thoroughly after version updates

### 4. Package Organization in Monorepo
- **Date**: March 26, 2025
- **Context**: Deciding CLI package location
- **Problem**: Initially planned to use apps/cli directory based on common patterns
- **Solution**: Decided to keep all packages in packages/ directory for simplicity
- **Lesson**: While separating apps from packages is a common pattern, simpler projects benefit from a flatter structure
- **Impact**: 
  - Simpler dependency management
  - Easier relative imports
  - More consistent package structure
  - Better aligned with current project scale

## Development Process

### 1. Iterative Simplification
- **Date**: March 26, 2025
- **Context**: Refactoring provider implementations
- **Lesson**: 
  - Start with the simplest possible implementation
  - Add complexity only when necessary
  - Regular refactoring to remove unnecessary code
  - Question every abstraction's value

### 2. Type Safety
- **Date**: March 26, 2025
- **Context**: Using Vercel AI SDK types
- **Lesson**:
  - Leverage existing type definitions from SDKs
  - Use explicit return types for better documentation
  - TypeScript's type system can help guide simplification
  - Let the SDK's type system do the heavy lifting

## Testing and Validation

### 1. SDK Testing Approach
- **Date**: March 26, 2025
- **Context**: Planning tests for provider implementations
- **Lesson**:
  - Focus tests on configuration and integration points
  - Trust the SDK's internal testing
  - Test the factory functions' contract
  - Verify type compatibility

## Documentation

### 1. Code as Documentation
- **Date**: March 26, 2025
- **Context**: Provider implementation documentation
- **Lesson**:
  - Simple implementations can be self-documenting
  - Use TypeScript types as documentation
  - Keep examples focused and minimal
  - Document the "why" more than the "what"

## Project Planning

### 1. Feature Prioritization and Phasing
- **Date**: March 26, 2025
- **Context**: Initially included streaming and function calling in core implementation
- **Problem**: Including advanced features in early phases increased complexity and risk
- **Solution**: Created dedicated Advanced Features phase and moved non-essential features there
- **Lesson**: 
  1. Start with essential features that provide core value
  2. Move advanced features to later phases
  3. Keep early phases focused and manageable
  4. Plan for extensibility without implementing it early
- **Impact**:
  - Clearer project progression
  - Reduced initial complexity
  - Better risk management
  - More focused development effort

## CLI Development (2025-03-26 06:40 EDT)

### User Interface Design
1. **Progressive Disclosure**
   - Basic commands should be simple and intuitive
   - Advanced options available but not required
   - Help text with clear examples is essential

2. **Input Flexibility**
   - Accept direct arguments for simple cases
   - Support stdin for piped operations
   - Allow configuration overrides for advanced users

3. **Clear Feedback**
   - Use color coding consistently (e.g., green for "Free", cyan for values)
   - Right-align numeric/date values for better readability
   - Use human-readable formats (e.g., "1M" instead of "1000000")

### Code Organization
1. **Provider-Specific Logic**
   - Keep provider-specific code in dedicated files
   - Use a common interface for shared functionality
   - Implement provider-specific URL generation in respective modules

2. **Error Handling**
   - Handle EPIPE errors gracefully for pipe operations
   - Provide clear, actionable error messages
   - Consider the user's context when displaying errors

3. **Testing Strategy**
   - Colocate tests with source files
   - Use feature-based directory structure
   - Centralize test utilities for reusability

### Documentation
1. **README Best Practices**
   - Start with clear feature overview
   - Provide installation instructions
   - Include usage examples with common scenarios
   - Document environment variables and configuration

2. **Code Documentation**
   - Use TypeScript types as documentation
   - Document the "why" more than the "what"
   - Keep examples focused and minimal

### Technical Insights
1. **Formatting**
   - Account for ANSI color codes in width calculations
   - Use consistent date formatting
   - Format numbers for human readability

2. **Integration**
   - Use provider SDKs directly when possible
   - Keep abstractions minimal and purposeful
   - Handle provider-specific quirks in dedicated modules

### Future Considerations
1. **Potential Improvements**
   - Model comparison functionality
   - Capability-based filtering
   - Version tracking
   - Performance benchmarking

2. **Known Limitations**
   - Some providers may have rate limits
   - Context lengths may vary by model
   - Not all models support all features

## Dependency Management
1. Always use latest stable versions of dependencies:
   - Check npm for latest versions regularly
   - Update dependencies proactively to get new features and fixes
   - Document version changes in worklog
2. Consider dependency compatibility:
   - Verify TypeScript type definitions are available
   - Test integration points after version updates
   - Keep track of breaking changes

## Provider Integration
1. Dynamic vs Static Implementation:
   - Prefer dynamic model listing over hardcoded lists
   - Use provider SDKs when available for better maintainability
   - Implement proper error handling for API failures
2. Standardization:
   - Create consistent interfaces across providers
   - Normalize metadata and capabilities
   - Handle provider-specific features gracefully

## Type Safety
1. TypeScript Best Practices:
   - Use proper type declarations for all dependencies
   - Handle undefined/optional values explicitly
   - Document type interfaces thoroughly
2. Error Handling:
   - Implement proper error classification
   - Provide meaningful error messages
   - Consider retry mechanisms for transient failures

## Testing Strategy
1. Provider Testing:
   - Test model listing functionality
   - Verify token counting accuracy
   - Check error handling paths
2. Integration Testing:
   - Test provider interoperability
   - Verify consistent behavior across providers
   - Monitor API rate limits and quotas

## Documentation
1. Keep documentation up to date:
   - Document version changes
   - Update setup instructions
   - Maintain clear usage examples
2. Provider-specific documentation:
   - Document API key requirements
   - List supported features
   - Provide troubleshooting guides

## Provider Implementation (2024-03-26)

### 1. Interface-First Development
- **Date**: March 26, 2024
- **Context**: Google provider implementation
- **Problem**: Started by creating custom interfaces mirroring API response, leading to unnecessary complexity
- **Solution**: Focus on implementing the core `ModelDetails` interface directly
- **Lesson**: 
  1. Start with the core interfaces from your system
  2. Transform external data directly to these interfaces
  3. Avoid creating intermediate types unless absolutely necessary
  4. Let TypeScript infer types where possible
- **Impact**:
  - Simpler, more maintainable code
  - Better alignment with system architecture
  - Reduced cognitive load
  - Easier to update when APIs change

### 2. Data Transformation Best Practices
- **Date**: March 26, 2024
- **Context**: Mapping Google API response to ModelDetails
- **Problem**: Created complex transformation logic with multiple helper functions
- **Solution**: Simplified to direct mapping in a single function
- **Lesson**:
  1. Keep transformations simple and direct
  2. Use const assertions for static data (as const)
  3. Inline simple helper functions unless reused
  4. Document source of external data (e.g., pricing URLs)
- **Example**:
  ```typescript
  // Before: Complex helper functions
  function getModelCosts(name: string): ModelPricing { ... }
  function getModelDates(name: string, version: string): Dates { ... }

  // After: Direct transformation
  return {
    costs: GEMINI_PRICING[baseModel] || GEMINI_PRICING.default,
    addedDate: version?.includes('exp') ? new Date() : baseDate
  };
  ```

### 3. Type Safety Without Overhead
- **Date**: March 26, 2024
- **Context**: Google provider implementation
- **Problem**: Over-engineered type system with unnecessary interfaces
- **Solution**: Leverage TypeScript's type inference and const assertions
- **Lesson**:
  1. Use TypeScript's type inference where possible
  2. Add explicit types only where needed for clarity
  3. Const assertions provide type safety for static data
  4. Trust the compiler to catch type errors
- **Impact**:
  - Cleaner, more readable code
  - Maintained type safety
  - Easier to maintain and update
  - Better developer experience

### 4. API Integration Patterns
- **Date**: March 26, 2024
- **Context**: Google AI model integration
- **Problem**: Initially created complex wrappers around API responses
- **Solution**: Direct transformation to core interfaces
- **Lesson**:
  1. Focus on your system's core interfaces
  2. Transform external data at the boundary
  3. Don't preserve unnecessary API structure
  4. Document API versions and endpoints
- **Impact**:
  - Cleaner architecture
  - Better separation of concerns
  - Easier to add new providers
  - More maintainable codebase 

## API Key Management

### Test Suite Design
- Implement mock data responses for basic functionality tests
- Use environment variables for API key configuration
- Create helper functions (like `itWithAuth`) to handle conditional test execution
- Clearly document required environment variables and their purpose

### Environment Configuration
- Use descriptive environment variable names (e.g., `GOOGLE_GENERATIVE_AI_API_KEY` vs `GOOGLE_API_KEY`)
- Implement proper validation and error messages for missing/invalid keys
- Maintain an up-to-date `.env.example` file
- Log helpful debugging information during test setup

### Best Practices
1. Always verify API key validity before running tests
2. Provide clear error messages when API keys are missing or invalid
3. Use mock data for tests that don't require API access
4. Document API key requirements and setup process
5. Implement proper error handling for API authentication failures 

## Recent Lessons

### Model Configuration Management (Apr 3, 2025)
1. **Field Name Consistency**
   - Standardize on clear, descriptive field names (`modelId` vs `id`)
   - Maintain backward compatibility when changing field names
   - Document field name changes and deprecation plans

2. **CLI Tool Design**
   - Handle both current and legacy field names for smoother transitions
   - Provide clear error messages for configuration issues
   - Validate configurations before saving changes

3. **Configuration Updates**
   - Test configuration changes with actual evaluation runs
   - Update example configurations to reflect best practices
   - Consider adding schema validation at the CLI level

### Best Practices
1. Always validate configurations before saving
2. Provide clear upgrade paths for breaking changes
3. Keep example configurations up to date
4. Document field name changes and their rationale 

# Testing Provider Implementations
*Thu Apr 4 2025*

## Key Learnings from Google Provider Implementation

1. Test Structure
   - Use beforeEach to verify API keys
   - Implement skip tests for missing credentials
   - Add debug logging for test troubleshooting
   - Test both success and error cases

2. Error Handling
   - Handle empty prompts gracefully
   - Validate API keys before provider creation
   - Test invalid model IDs
   - Check token usage in responses

3. Test Organization
   - Group tests by functionality
   - Use descriptive test names
   - Add console logging for debugging
   - Keep tests focused and isolated

4. Best Practices
   - Use environment variables for API keys
   - Clean up environment after tests
   - Add proper type checking
   - Verify usage statistics 

# CLI Testing Best Practices
*Thu Apr 4 2025*

## Key Learnings from CLI Test Implementation

1. Process Exit Handling
   - Don't use process.exit in testable code
   - Return error codes instead of direct exit
   - Use dependency injection for process handling
   - Consider using a custom exit handler in tests

2. API Error Mocking
   - Mock API calls consistently
   - Provide realistic error responses
   - Test both success and failure paths
   - Include rate limit and network errors

3. Test Organization
   - Group tests by command and functionality
   - Mock external dependencies
   - Capture and verify console output
   - Clean up mocks after each test

4. Best Practices
   - Avoid direct process manipulation in application code
   - Use dependency injection for better testability
   - Implement proper cleanup in tests
   - Add comprehensive error scenarios 

### April 11, 2025
- Importance of thorough type checking to prevent runtime errors.
- Ensuring test coverage includes edge cases for better reliability.
- Regular updates to memory files help maintain project clarity and direction. 

## CLI Implementation

### Cost Display Formatting
1. Standardization is crucial
   - Choose a consistent unit (per 1M tokens) and stick to it
   - Use the same precision (4 decimal places) everywhere
   - Add clear unit indicators ("/1M" or "/1M tokens")

2. Edge Cases Matter
   - Handle free models explicitly with "Free" display
   - Consider null/undefined costs
   - Use proper type guards for TypeScript safety

3. User Experience
   - Clear headers indicating units
   - Consistent formatting across different views
   - Helpful suffixes to avoid confusion

### Best Practices
1. Always multiply raw costs before display
   - Raw costs are typically very small numbers
   - Multiply by 1M for better readability
   - Keep calculations separate from display formatting

2. Type Safety
   - Use null coalescing for undefined checks
   - Extract repeated calculations to variables
   - Keep type guards close to data access

3. Error Handling
   - Implement proper error classification
   - Provide meaningful error messages
   - Consider retry mechanisms for transient failures 

## 2025-06-18: LM Studio Provider Lessons
- LM Studio REST API provides better error handling than OpenAI-compatible endpoint
- Dynamic test model selection ensures tests pass if any model is loaded
- Error handling should expect API error objects, not just thrown exceptions
- Prefer REST API for robust integration and error reporting 