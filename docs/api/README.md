# API Reference

## Overview

This section provides comprehensive API documentation for the umwelten evaluation framework. The API is organized by component and includes detailed information about classes, methods, and usage examples.

## Table of Contents

### Core Components
- [Evaluation Strategies](evaluation-strategies.md) - API reference for evaluation strategies
- [Stimulus System](stimulus-system.md) - API reference for stimulus templates and tools
- [Caching System](caching-system.md) - API reference for caching infrastructure
- [Provider Integration](provider-integration.md) - API reference for AI provider integrations

### Utilities
- [CLI Reference](cli-reference.md) - Command-line interface reference
- [Type Definitions](type-definitions.md) - TypeScript type definitions
- [Error Handling](error-handling.md) - Error types and handling patterns

## Quick Reference

### Basic Usage

```typescript
import { SimpleEvaluation } from '../src/evaluation/strategies/simple-evaluation.js';
import { LiteraryAnalysisTemplate } from '../src/stimulus/templates/creative-templates.js';

const evaluation = new SimpleEvaluation({
  id: "my-evaluation",
  name: "My Evaluation",
  description: "A simple evaluation example"
});

const result = await evaluation.run({
  model: {
    name: "gpt-4",
    provider: "openrouter",
    costs: { promptTokens: 0.0001, completionTokens: 0.0001 },
    maxTokens: 1000,
    temperature: 0.7
  },
  testCases: [{
    id: "test-1",
    name: "Test 1",
    stimulus: LiteraryAnalysisTemplate,
    input: { prompt: "Analyze the themes in 'To Kill a Mockingbird'" }
  }]
});
```

### Model Configuration

```typescript
interface ModelDetails {
  name: string;
  provider: 'openrouter' | 'google' | 'ollama' | 'lmstudio';
  costs: {
    promptTokens: number;
    completionTokens: number;
  };
  maxTokens?: number;
  temperature?: number;
  // ... other model-specific settings
}
```

### Test Case Structure

```typescript
interface TestCase {
  id: string;
  name: string;
  stimulus: Stimulus;
  input: Record<string, any>;
  expectedOutput?: Record<string, any>;
  metadata?: Record<string, any>;
}
```

### Evaluation Result

```typescript
interface EvaluationResult {
  id: string;
  name: string;
  responses: ModelResponse[];
  metrics: {
    totalTime: number;
    totalTokens: number;
    totalCost: number;
    cacheHits: number;
  };
  scores?: ScoreResponse[];
  metadata: Record<string, any>;
}
```

## Common Patterns

### 1. Single Model Evaluation

```typescript
import { SimpleEvaluation } from '../src/evaluation/strategies/simple-evaluation.js';

const evaluation = new SimpleEvaluation({
  id: "single-model-test",
  name: "Single Model Test",
  description: "Test a single model"
});

const result = await evaluation.run({
  model: { name: "gpt-4", provider: "openrouter" },
  testCases: [testCase]
});
```

### 2. Model Comparison

```typescript
import { MatrixEvaluation } from '../src/evaluation/strategies/matrix-evaluation.js';

const evaluation = new MatrixEvaluation({
  id: "model-comparison",
  name: "Model Comparison",
  description: "Compare multiple models"
});

const result = await evaluation.run({
  models: [
    { name: "gpt-4", provider: "openrouter" },
    { name: "claude-3", provider: "openrouter" }
  ],
  testCases: [testCase]
});
```

### 3. Batch Processing

```typescript
import { BatchEvaluation } from '../src/evaluation/strategies/batch-evaluation.js';

const evaluation = new BatchEvaluation({
  id: "batch-processing",
  name: "Batch Processing",
  description: "Process multiple inputs"
});

const result = await evaluation.run({
  model: { name: "gpt-4", provider: "openrouter" },
  testCases: [testCase1, testCase2, testCase3]
});
```

### 4. Complex Pipeline

```typescript
import { ComplexPipeline } from '../src/evaluation/strategies/complex-pipeline.js';

const pipeline = new ComplexPipeline({
  id: "complex-pipeline",
  name: "Complex Pipeline",
  description: "Multi-step evaluation"
});

const result = await pipeline.run({
  models: [model1, model2],
  steps: [
    { id: "step-1", strategy: "simple", stimulus: stimulus1, input: input1 },
    { id: "step-2", strategy: "simple", stimulus: stimulus2, input: input2, dependsOn: ["step-1"] }
  ]
});
```

## Error Handling

### Common Error Types

```typescript
// Rate limit errors
if (error instanceof RateLimitError) {
  console.log("Rate limit exceeded, retrying...");
  // Implement retry logic
}

// Authentication errors
if (error instanceof AuthenticationError) {
  console.error("Authentication failed:", error.message);
  // Check API keys
}

// Model errors
if (error instanceof ModelError) {
  console.error("Model error:", error.message);
  // Handle model-specific issues
}

// Validation errors
if (error instanceof ValidationError) {
  console.error("Validation error:", error.message);
  // Check input parameters
}
```

### Retry Logic

```typescript
import { retry } from '../src/utils/retry.js';

const result = await retry(
  () => evaluation.run({ model, testCases }),
  {
    maxAttempts: 3,
    delay: 1000,
    backoff: 'exponential'
  }
);
```

## Configuration

### Global Configuration

```typescript
import { Config } from '../src/config/config.js';

const config = new Config({
  cache: {
    enabled: true,
    ttl: 3600,
    strategy: 'balanced'
  },
  providers: {
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: 'https://openrouter.ai/api/v1'
    },
    google: {
      apiKey: process.env.GOOGLE_API_KEY,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
    }
  },
  evaluation: {
    defaultTimeout: 30000,
    maxRetries: 3,
    parallelLimit: 5
  }
});
```

### Per-Evaluation Configuration

```typescript
const evaluation = new SimpleEvaluation({
  id: "configured-evaluation",
  name: "Configured Evaluation",
  description: "An evaluation with custom configuration",
  
  config: {
    timeout: 60000,
    retries: 5,
    cache: {
      enabled: true,
      ttl: 1800
    }
  }
});
```

## TypeScript Support

The framework is built with TypeScript and provides comprehensive type definitions:

```typescript
import type { 
  ModelDetails, 
  ModelResponse, 
  EvaluationResult,
  TestCase,
  Stimulus
} from '../src/types/index.js';

// Type-safe model configuration
const model: ModelDetails = {
  name: "gpt-4",
  provider: "openrouter",
  costs: { promptTokens: 0.0001, completionTokens: 0.0001 }
};

// Type-safe evaluation result
const result: EvaluationResult = await evaluation.run({ model, testCases });
```

## Performance Considerations

### Caching

```typescript
const evaluation = new SimpleEvaluation({
  id: "cached-evaluation",
  name: "Cached Evaluation",
  description: "An evaluation with caching",
  
  cache: {
    enabled: true,
    ttl: 3600,
    strategy: 'aggressive'
  }
});
```

### Parallel Processing

```typescript
const evaluation = new SimpleEvaluation({
  id: "parallel-evaluation",
  name: "Parallel Evaluation",
  description: "An evaluation with parallel processing",
  
  parallel: {
    enabled: true,
    maxConcurrency: 5
  }
});
```

### Memory Management

```typescript
const evaluation = new SimpleEvaluation({
  id: "memory-optimized-evaluation",
  name: "Memory Optimized Evaluation",
  description: "An evaluation with memory optimization",
  
  memory: {
    maxCacheSize: '512MB',
    cleanupInterval: 300000, // 5 minutes
    gcThreshold: 0.8
  }
});
```

## Examples

See the `scripts/examples/` directory for complete working examples of each API component.

## Contributing

When contributing to the API:

1. Follow the existing patterns and conventions
2. Add comprehensive TypeScript types
3. Include JSDoc comments for all public methods
4. Write tests for new functionality
5. Update this documentation

## Support

For API-related questions:

- Check the [troubleshooting guide](../guide/troubleshooting.md)
- Review the [examples](../examples/README.md)
- Open an issue on GitHub
- Join the community discussions
