# Active Context
Last Updated: 2025-04-01 08:15:00 EDT

## CRITICAL IMPLEMENTATION RULES
1. ALWAYS use Vercel AI SDK wrappers for ALL providers
   - OpenRouter: @openrouter/ai-sdk-provider
   - Google: @ai-sdk/google
   - Ollama: ollama-ai-provider
2. NEVER use provider-specific SDKs directly (e.g., @google/generative-ai)
3. This ensures consistent interfaces and behavior across all providers
4. All providers must implement the LanguageModelV1 interface from the 'ai' package

## Current Focus
Improving provider implementation and CLI display

## Current Status
- [X] Defined model routing architecture
- [X] Implementing model routing system
- [X] Update configuration format
- [X] Update provider implementations
- [X] Update CLI display

## Implementation Plan
### Phase 1: Core Model Routing (Completed)
1. Create ModelRoute interface and utilities
   - [ ] Define types in models/types.ts
   - [ ] Implement parseModelIdentifier
   - [ ] Implement formatModelIdentifier
   - [ ] Add provider inference logic

2. Update Configuration Schema
   - [ ] Update model configuration format
   - [ ] Add route and variant fields
   - [ ] Update validation

3. Update Provider Implementation
   - [ ] Modify getModelProvider to use route information
   - [ ] Update Google provider
   - [ ] Update OpenRouter provider
   - [ ] Update Ollama provider

4. CLI Updates
   - [ ] Update model listing format
   - [ ] Add route information to model info
   - [ ] Update help documentation

### Phase 2: Provider Improvements (Current)
1. OpenRouter Provider Updates
   - [X] Set provider field to 'openrouter'
   - [X] Add originalProvider field for actual provider
   - [X] Update CLI to display both provider fields
   - [X] Fix model listing in CLI

2. CLI Enhancements
   - [X] Update model listing format
   - [X] Add provider/originalProvider display
   - [X] Fix linter errors in display code
   - [X] Improve error handling

### Phase 3: Testing and Documentation
- [ ] Add tests for updated provider implementations
- [ ] Test CLI enhancements
- [ ] Update documentation with new provider fields
- [ ] Add examples for provider usage

## Technical Details
### Model Route Interface
```typescript
interface ModelRoute {
  modelId: string;      // Base model identifier
  provider: string;     // Original provider
  route: "direct" | "openrouter" | "ollama";  // Access method
  variant?: string;     // Optional variant (e.g. "free")
}
```

### Configuration Format
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

### Model Details Interface Updates
```typescript
interface ModelDetails extends ModelRoute {
  originalProvider?: string; // For OpenRouter models, the actual provider (e.g., 'openai', 'anthropic')
}
```

## Next Steps
1. Complete testing of provider updates
2. Update documentation with new provider fields
3. Add examples for provider usage
4. Review and update error handling

## Blockers
None currently

## Recent Decisions
1. OpenRouter models now consistently use 'openrouter' as provider
2. Added originalProvider field to track actual model provider
3. Enhanced CLI display to show both provider fields
4. CRITICAL: Must use Vercel AI SDK wrappers for all providers

## Dependencies
Current core dependencies:
- ai: ^4.1.46 (Vercel AI SDK core)
- @ai-sdk/google: Latest (Vercel AI wrapper for Google)
- @openrouter/ai-sdk-provider: ^0.4.3
- ollama-ai-provider: ^1.2.0
- zod: ^3.22.4

### In Progress
- Fixing provider implementation to use Vercel AI SDK wrappers exclusively
- Implementing dynamic model listing
- Fixing TypeScript linting issues in provider implementations

### Dependencies Update Status
All dependencies at latest versions, focusing on Vercel AI SDK ecosystem:
- ai: ^4.1.46 (Core Vercel AI SDK)
- @ai-sdk/google: Latest (Vercel wrapper)
- @openrouter/ai-sdk-provider: ^0.4.3
- ollama-ai-provider: ^1.2.0
- zod: ^3.22.4

### Next Steps
1. Fix TypeScript linting issues in providers:
   - Ensure proper LanguageModelV1 interface implementation
   - Add proper type annotations for parameters
2. Test provider implementations with Vercel AI SDK wrappers
3. Update documentation with provider setup instructions

### Blockers
- Need to verify token counting and cost calculation for all providers through Vercel AI SDK wrappers

### Recent Decisions
1. CRITICAL: Must use Vercel AI SDK wrappers for all providers
2. Using dynamic model listing where available
3. Standardizing on LanguageModelV1 interface from 'ai' package
4. Verified all dependencies are at their latest versions

### Current Status (2025-04-01 08:15:00 EDT)

### Overview
The CLI implementation is now complete with improved formatting, better error handling, and enhanced user experience features.

### Currently Working On
- [X] CLI improvements and polish
  - [X] Model URL linking
  - [X] Context length formatting
  - [X] Date alignment
  - [X] Cost display
  - [X] Error handling

### Notes
- The CLI now provides a polished, user-friendly interface
- All core functionality is implemented and working
- Code organization follows best practices with clear separation of concerns
- Documentation needs to be completed
- CRITICAL: All providers must use Vercel AI SDK wrappers 