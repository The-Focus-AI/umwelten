# Cognition Module

The cognition module provides the core infrastructure for AI model execution, including runners, type definitions, and streaming capabilities. This module implements the semantic concept of "Cognition" - the reasoning and thinking processes of AI models.

## Overview

The cognition module consists of several key components:

- **BaseModelRunner**: Core model execution engine
- **SmartModelRunner**: Hookable runner with cognitive enhancements
- **Type Definitions**: Interfaces and schemas for model interactions
- **Streaming Support**: Real-time object and text streaming

## Core Classes

### BaseModelRunner

The primary class for executing model interactions and generating responses.

#### Import
```typescript
import { BaseModelRunner } from '../src/cognition/runner.js';
```

#### Constructor
```typescript
interface ModelRunnerConfig {
  rateLimitConfig?: RateLimitConfig;
  maxRetries?: number;
  maxTokens?: number;
}

const runner = new BaseModelRunner({
  maxRetries: 3,
  maxTokens: 4096,
  rateLimitConfig: { /* rate limiting options */ }
});
```

#### Methods

##### `generateText(interaction: Interaction): Promise<ModelResponse>`

Generate a text response from the model.

```typescript
const runner = new BaseModelRunner();
const stimulus = new Stimulus({
  role: "helpful assistant",
  objective: "answer questions clearly"
});
const interaction = new Interaction(modelDetails, stimulus);
interaction.addMessage({
  role: 'user',
  content: 'Explain quantum computing'
});

const response = await runner.generateText(interaction);
console.log(response.content); // Generated text
console.log(response.metadata.tokenUsage); // Token usage stats
console.log(response.metadata.cost); // Cost information
```

##### `generateObject<T>(interaction: Interaction, schema: z.ZodSchema<T>): Promise<ModelResponse>`

Generate structured output validated against a Zod schema.

```typescript
import { z } from 'zod';

const TaskSchema = z.object({
  title: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
  due_date: z.string().optional(),
  completed: z.boolean().default(false)
});

const runner = new BaseModelRunner();
const stimulus = new Stimulus({
  role: "task manager",
  objective: "create and manage tasks"
});
const interaction = new Interaction(modelDetails, stimulus);
interaction.setOutputFormat(TaskSchema);
interaction.addMessage({
  role: 'user',
  content: 'Create a task for reviewing the quarterly report'
});

const response = await runner.generateObject(interaction, TaskSchema);
const task = JSON.parse(response.content); // Validated and typed
```

##### `streamObject<T>(interaction: Interaction, schema: z.ZodSchema<T>): Promise<ModelResponse>`

Generate structured output with real-time streaming, validated against a Zod schema.

```typescript
import { z } from 'zod';

const RecipeSchema = z.object({
  name: z.string(),
  ingredients: z.array(z.string()),
  instructions: z.array(z.string()),
  prep_time: z.number(),
  cook_time: z.number()
});

const runner = new BaseModelRunner();
const stimulus = new Stimulus({
  role: "recipe generator",
  objective: "create recipes"
});
const interaction = new Interaction(modelDetails, stimulus);
interaction.setOutputFormat(RecipeSchema);
interaction.addMessage({
  role: 'user',
  content: 'Generate a recipe for chocolate chip cookies'
});

const response = await runner.streamObject(interaction, RecipeSchema);
const recipe = JSON.parse(response.content); // Built from partial object stream
```

**Important**: This method uses `partialObjectStream` internally to avoid hanging issues. The implementation iterates over partial objects and merges them to build the final result.

**Performance**:
- **Google Gemini**: ~600ms for streamObject
- **Ollama (gemma3:12b)**: ~500ms for streamObject
- **Real-time streaming**: Works without hanging or timeout issues

##### `streamText(interaction: Interaction): Promise<ModelResponse>`

Stream text responses for real-time output.

```typescript
const runner = new BaseModelRunner();
const stimulus = new Stimulus({
  role: "storyteller",
  objective: "tell engaging stories"
});
const interaction = new Interaction(modelDetails, stimulus);
interaction.addMessage({
  role: 'user',
  content: 'Tell me a story about a brave knight'
});

const response = await runner.streamText(interaction);
// response.content contains the complete text
console.log(response.content);
```

### SmartModelRunner

A hookable runner that supports before, during, and after execution hooks for cognitive enhancements.

#### Import
```typescript
import { SmartModelRunner } from '../src/cognition/smart_runner.js';
```

#### Constructor
```typescript
interface SmartModelRunnerConfig {
  beforeHooks?: RunnerHook[];
  duringHooks?: RunnerHook[];
  afterHooks?: RunnerHook[];
  baseRunner: ModelRunner;
}

const smartRunner = new SmartModelRunner({
  baseRunner: new BaseModelRunner(),
  beforeHooks: [
    async (interaction) => {
      // Pre-processing logic
      console.log('Before execution:', interaction.prompt);
    }
  ],
  afterHooks: [
    async (interaction) => {
      // Post-processing logic
      console.log('After execution completed');
    }
  ]
});
```

#### Hook Types

##### RunnerHook
```typescript
type RunnerHook = (interaction: Interaction) => Promise<void | RunnerAbort | RunnerModification>;
```

##### RunnerAbort
```typescript
export class RunnerAbort {
  constructor(public reason: string) {}
}

// Usage in hook
async function validationHook(interaction: Interaction) {
  if (!interaction.prompt.trim()) {
    return new RunnerAbort('Empty prompt provided');
  }
}
```

##### RunnerModification
```typescript
export class RunnerModification {
  constructor(public modify: (interaction: Interaction) => Interaction) {}
}

// Usage in hook
async function enhancementHook(interaction: Interaction) {
  return new RunnerModification((interaction) => {
    // Modify the interaction
    interaction.addMessage({
      role: 'system',
      content: 'Additional context added by hook'
    });
    return interaction;
  });
}
```

## Type Definitions

### ModelDetails

Core interface for model configuration:

```typescript
interface ModelDetails {
  name: string;                    // Model identifier
  provider: string;                // Provider name (google, openrouter, ollama, etc.)
  temperature?: number;            // Sampling temperature (0-2)
  topP?: number;                   // Top-p sampling parameter
  topK?: number;                   // Top-k sampling parameter
  numCtx?: number;                 // Context window size
  contextLength?: number;          // Maximum context length
  costs?: {                        // Cost per million tokens
    promptTokens: number;
    completionTokens: number;
  };
  description?: string;            // Model description
  addedDate?: Date;                // When model was added
  lastUpdated?: Date;              // Last update timestamp
  details?: Record<string, unknown>; // Additional metadata
  originalProvider?: string;       // Original provider for routed models
}
```

### ModelOptions

Configuration options for model execution:

```typescript
interface ModelOptions {
  temperature?: number;            // Sampling temperature (0-2)
  maxTokens?: number;              // Maximum tokens to generate
  stop?: string[];                 // Stop sequences
}
```

### ModelResponse

Standard response format for all model interactions:

```typescript
interface ModelResponse {
  content: string;                 // Generated content
  metadata: ResponseMetadata;      // Execution metadata
  reasoning?: string;              // Reasoning chain (if enabled)
  reasoningDetails?: Array<{       // Detailed reasoning
    type: 'text' | 'redacted';
    text?: string;
    data?: string;
    signature?: string;
  }>;
}
```

### ResponseMetadata

Metadata about the model execution:

```typescript
interface ResponseMetadata {
  startTime: Date;                 // Execution start time
  endTime: Date;                   // Execution end time
  tokenUsage: TokenUsage;          // Token consumption
  provider: string;                // Model provider
  model: string;                   // Model name
  cost: CostBreakdown;             // Cost information
}
```

## Streaming Patterns

The cognition module provides multiple methods for different streaming needs:

### 1. For Immediate Results
```typescript
// Use generateObject for immediate structured results
const result = await runner.generateObject(interaction, schema);
const data = JSON.parse(result.content);
// data is immediately available
```

### 2. For Real-Time Streaming
```typescript
// Use streamObject for real-time partial updates
const result = await runner.streamObject(interaction, schema);
const data = JSON.parse(result.content);
// data is built from partial object stream
```

### 3. For Flexible JSON
```typescript
// Use generateText + JSON parsing for dynamic schemas
const result = await runner.generateText(interaction);
const jsonMatch = result.content.match(/\{.*\}/s);
const data = JSON.parse(jsonMatch[0]);
```

### 4. For Text Streaming
```typescript
// Use streamText for real-time text chunks
const result = await runner.streamText(interaction);
// Process text chunks as they arrive
```

## Error Handling

The cognition module provides comprehensive error handling:

### Rate Limiting
```typescript
try {
  const response = await runner.generateText(interaction);
} catch (error) {
  if (error.message.includes('rate limit')) {
    console.error('Rate limit exceeded, retrying...');
    // Implement retry logic
  }
}
```

### Model Validation
```typescript
try {
  const response = await runner.generateObject(interaction, schema);
} catch (error) {
  if (error.message.includes('Invalid model details')) {
    console.error('Model configuration error:', error.message);
  }
}
```

### Schema Validation
```typescript
try {
  const response = await runner.generateObject(interaction, schema);
} catch (error) {
  if (error.message.includes('schema validation')) {
    console.error('Output validation failed:', error.message);
  }
}
```

## Best Practices

### Model Selection
- **Google Gemini**: Excellent for structured output and streaming
- **OpenRouter GPT-4**: Best for complex reasoning tasks
- **Ollama Models**: Good for local development and testing
- **Multiple Models**: Use for validation and comparison

### Performance Optimization
- Use appropriate timeouts for different model types
- Implement retry logic for transient failures
- Monitor token usage and costs
- Use streaming for interactive applications

### Error Prevention
- Validate model details before execution
- Test schemas with simple examples first
- Handle rate limits gracefully
- Monitor for model-specific errors

## Examples

### Basic Text Generation
```typescript
import { BaseModelRunner } from '../src/cognition/runner.js';
import { Interaction } from '../src/interaction/core/interaction.js';
import { Stimulus } from '../src/stimulus/stimulus.js';

const runner = new BaseModelRunner();
const modelDetails = {
  name: 'gemini-3-flash-preview',
  provider: 'google',
  temperature: 0.7
};

const stimulus = new Stimulus({
  role: "helpful assistant",
  objective: "explain concepts clearly"
});
const interaction = new Interaction(modelDetails, stimulus);
interaction.addMessage({
  role: 'user',
  content: 'Explain machine learning in simple terms'
});

const response = await runner.generateText(interaction);
console.log(response.content);
```

### Structured Output with Streaming
```typescript
import { BaseModelRunner } from '../src/cognition/runner.js';
import { Interaction } from '../src/interaction/core/interaction.js';
import { Stimulus } from '../src/stimulus/stimulus.js';
import { z } from 'zod';

const ProductSchema = z.object({
  name: z.string(),
  price: z.number(),
  category: z.string(),
  features: z.array(z.string())
});

const runner = new BaseModelRunner();
const modelDetails = {
  name: 'gemini-3-flash-preview',
  provider: 'google',
  temperature: 0.1
};

const stimulus = new Stimulus({
  role: "product analyzer",
  objective: "analyze products and extract features"
});
const interaction = new Interaction(modelDetails, stimulus);
interaction.setOutputFormat(ProductSchema);
interaction.addMessage({
  role: 'user',
  content: 'Analyze this product: iPhone 15 Pro'
});

const response = await runner.streamObject(interaction, ProductSchema);
const product = JSON.parse(response.content);
console.log('Product analysis:', product);
```

### Hookable Runner with Validation
```typescript
import { SmartModelRunner, RunnerAbort } from '../src/cognition/smart_runner.js';
import { BaseModelRunner } from '../src/cognition/runner.js';

const validationHook = async (interaction) => {
  if (!interaction.prompt.trim()) {
    return new RunnerAbort('Empty prompt provided');
  }
  if (interaction.prompt.length > 1000) {
    return new RunnerAbort('Prompt too long');
  }
};

const smartRunner = new SmartModelRunner({
  baseRunner: new BaseModelRunner(),
  beforeHooks: [validationHook]
});

// This will be aborted by the validation hook
try {
  await smartRunner.generateText(interaction);
} catch (error) {
  console.error('Execution aborted:', error.message);
}
```

## Integration with Other Modules

### Interaction Module
The cognition module works closely with the Interaction module for managing conversations and context.

### Providers Module
Model execution relies on the providers module for model instantiation and validation.

### Memory Module
The SmartModelRunner can integrate with the memory module for persistent context and knowledge retrieval.

### Evaluation Module
The cognition module provides the foundation for systematic model evaluation and comparison. 