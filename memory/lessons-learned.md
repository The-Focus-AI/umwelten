# Lessons Learned
Last Updated: Thu Apr 3 05:56:05 EDT 2025

## Technical Insights

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