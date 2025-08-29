# TypeScript API Reference

Comprehensive reference for Umwelten's TypeScript API, showing how to build custom evaluations, interact with models programmatically, and extend functionality. Use this API to create custom scripts and integrations like those in the `scripts/` directory.

## Quick Navigation

### Core APIs
- **[Core Classes](/api/core-classes)**: Essential classes for model interaction and evaluation
- **[Model Integration](/api/model-integration)**: Working with different AI model providers
- **[Evaluation Framework](/api/evaluation-framework)**: Building custom evaluation logic and runners
- **[Schema Validation](/api/schemas)**: Zod schemas and structured output validation

### Advanced Features
- **[MCP Integration](/MCP_IMPLEMENTATION_SUMMARY)**: Model Context Protocol implementation for tool integration
- **[Memory System](/api/memory-system)**: Conversation memory and fact extraction
- **[Rate Limiting](/api/rate-limiting)**: Managing API rate limits and costs

## Core Concepts

### Basic Model Interaction

The simplest way to interact with a model:

```typescript
import { BaseModelRunner } from '../src/cognition/runner.js';
import { Interaction } from '../src/interaction/interaction.js';
import { ModelDetails } from '../src/cognition/types.js';

// Define your model
const model: ModelDetails = {
  name: 'gemini-2.0-flash',
  provider: 'google'
};

// Create conversation with system prompt
const conversation = new Interaction(model, "You are a helpful assistant.");

// Add user message
conversation.addMessage({
  role: 'user',
  content: 'Explain quantum computing in simple terms.'
});

// Generate response
const runner = new BaseModelRunner();
const response = await runner.generateText(conversation);

console.log(response.content);
```

### Structured Output with Schemas

Extract structured data using Zod schemas:

```typescript
import { z } from 'zod';
import { BaseModelRunner } from '../src/cognition/runner.js';
import { Interaction } from '../src/interaction/interaction.js';

// Define your schema
const PersonSchema = z.object({
  name: z.string().describe('Full name of the person'),
  age: z.number().int().describe('Age in years'),
  occupation: z.string().describe('Current job or profession'),
  skills: z.array(z.string()).describe('List of key skills')
});

// Create conversation
const model = { name: 'gemini-2.0-flash', provider: 'google' };
const conversation = new Interaction(model, 'Extract person information from text.');
conversation.addMessage({
  role: 'user',
  content: 'John Smith is a 35-year-old software engineer with expertise in TypeScript, React, and Node.js.'
});

// Extract structured data
const runner = new BaseModelRunner();
const response = await runner.streamObject(conversation, PersonSchema);

// response.structuredOutput contains validated data matching PersonSchema
console.log(response.structuredOutput);
```

### File Attachments

Process files with model analysis:

```typescript
import { Interaction } from '../src/interaction/interaction.js';
import { BaseModelRunner } from '../src/cognition/runner.js';

const model = { name: 'gemini-2.0-flash', provider: 'google' };
const conversation = new Interaction(model, 'Analyze the attached image.');

// Add image attachment
await conversation.addAttachmentFromPath('./image.jpg');

const runner = new BaseModelRunner();
const response = await runner.generateText(conversation);

console.log(response.content);
```

## Building Custom Evaluations

### Simple Evaluation Function

Create reusable evaluation functions:

```typescript
import { BaseModelRunner } from '../src/cognition/runner.js';
import { ModelDetails, ModelResponse } from '../src/cognition/types.js';
import { Interaction } from '../src/interaction/interaction.js';
import { evaluate } from '../src/evaluation/evaluate.js';

export async function analyzeText(model: ModelDetails, text: string): Promise<ModelResponse> {
  const systemPrompt = "You are an expert text analyst.";
  const userPrompt = `Analyze the following text and provide insights: ${text}`;

  const conversation = new Interaction(model, systemPrompt);
  conversation.addMessage({
    role: 'user',
    content: userPrompt
  });

  const runner = new BaseModelRunner();
  return runner.generateText(conversation);
}

// Use the evaluation function
const model = { name: 'gemini-2.0-flash', provider: 'google' };
const result = await analyzeText(model, "Sample text to analyze");
console.log(result.content);
```

### Advanced Evaluation Runner

Build sophisticated evaluation workflows:

```typescript
import { EvaluationRunner } from '../src/evaluation/runner.js';
import { ModelDetails, ModelResponse } from '../src/cognition/types.js';
import { Interaction } from '../src/interaction/interaction.js';
import { BaseModelRunner } from '../src/cognition/runner.js';
import { z } from 'zod';

// Define schema for structured output
const AnalysisSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number().min(0).max(1),
  key_topics: z.array(z.string()),
  summary: z.string()
});

class TextAnalysisRunner extends EvaluationRunner {
  constructor() {
    super('text-analysis-evaluation');
  }

  async getTextData(): Promise<string> {
    // Cache expensive data loading
    return this.getCachedFile('input-text', async () => {
      // Load or fetch your text data
      return "Text content to analyze";
    });
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const text = await this.getTextData();
    
    const conversation = new Interaction(model, 'Analyze text sentiment and extract key information.');
    conversation.addMessage({
      role: 'user',
      content: `Analyze this text: ${text}`
    });

    const runner = new BaseModelRunner();
    return runner.streamObject(conversation, AnalysisSchema);
  }
}

// Run evaluation across multiple models
const runner = new TextAnalysisRunner();

await runner.evaluate({ name: 'gemini-2.0-flash', provider: 'google' });
await runner.evaluate({ name: 'gemma3:12b', provider: 'ollama' });
await runner.evaluate({ name: 'openai/gpt-4o-mini', provider: 'openrouter' });
```

## Working with Different Providers

### Provider Configuration

```typescript
import { ModelDetails } from '../src/cognition/types.js';

// Google Gemini models
const googleModel: ModelDetails = {
  name: 'gemini-2.0-flash',
  provider: 'google'
  // Requires: GOOGLE_GENERATIVE_AI_API_KEY environment variable
};

// Ollama local models
const ollamaModel: ModelDetails = {
  name: 'gemma3:12b',
  provider: 'ollama'
  // Requires: Ollama server running (default: http://localhost:11434)
};

// OpenRouter hosted models
const openRouterModel: ModelDetails = {
  name: 'openai/gpt-4o-mini',
  provider: 'openrouter'
  // Requires: OPENROUTER_API_KEY environment variable
};

// LM Studio local models
const lmStudioModel: ModelDetails = {
  name: 'local-model-name',
  provider: 'lmstudio'
  // Requires: LM Studio server running (default: http://localhost:1234)
};
```

## Essential Interfaces and Types

### ModelDetails Interface

```typescript
interface ModelDetails {
  name: string;        // Model identifier
  provider: string;    // Provider name: 'google', 'ollama', 'openrouter', 'lmstudio'
  temperature?: number; // Creativity setting (0-2)
  maxTokens?: number;   // Maximum response tokens
}
```

### ModelResponse Interface

```typescript
interface ModelResponse {
  content: string;           // Generated text content
  usage?: TokenUsage;        // Token usage statistics
  structuredOutput?: any;    // Validated structured output (when using schemas)
  model: string;            // Model that generated the response
  finishReason?: string;    // Why generation stopped
  cost?: CostInfo;          // Cost information (if available)
}
```

### Interaction Class

The `Interaction` class manages conversations:

```typescript
class Interaction {
  constructor(model: ModelDetails, systemPrompt?: string);
  
  // Add messages
  addMessage(message: { role: 'user' | 'assistant', content: string }): void;
  
  // Add file attachments
  addAttachmentFromPath(filePath: string): Promise<void>;
  addAttachment(content: Buffer, mimeType: string, filename?: string): void;
  
  // Get conversation data
  getMessages(): Message[];
  getModel(): ModelDetails;
}
```

### BaseModelRunner Class

Core class for model execution:

```typescript
class BaseModelRunner {
  // Generate text response
  generateText(interaction: Interaction): Promise<ModelResponse>;
  
  // Generate structured output with schema validation
  streamObject<T>(interaction: Interaction, schema: ZodSchema<T>): Promise<ModelResponse>;
  
  // Stream responses (for real-time output)
  streamText(interaction: Interaction): AsyncIterable<string>;
}
```

## Common Patterns

### Error Handling

```typescript
import { BaseModelRunner } from '../src/cognition/runner.js';

try {
  const runner = new BaseModelRunner();
  const response = await runner.generateText(conversation);
  
  if (response.finishReason === 'error') {
    console.error('Model generation failed');
    return;
  }
  
  console.log(response.content);
} catch (error) {
  console.error('API call failed:', error.message);
  // Handle authentication, network, or rate limiting errors
}
```

### Batch Processing

```typescript
import { BaseModelRunner } from '../src/cognition/runner.js';
import { Interaction } from '../src/interaction/interaction.js';

async function processBatch(texts: string[], model: ModelDetails): Promise<ModelResponse[]> {
  const runner = new BaseModelRunner();
  const results: ModelResponse[] = [];
  
  for (const text of texts) {
    const conversation = new Interaction(model, 'Analyze this text.');
    conversation.addMessage({
      role: 'user',
      content: text
    });
    
    try {
      const response = await runner.generateText(conversation);
      results.push(response);
    } catch (error) {
      console.error(`Failed to process text: ${text.substring(0, 50)}...`);
      // Continue with next item or implement retry logic
    }
  }
  
  return results;
}
```

### Cost Tracking

```typescript
import { BaseModelRunner } from '../src/cognition/runner.js';

const runner = new BaseModelRunner();
let totalCost = 0;

const response = await runner.generateText(conversation);

if (response.cost) {
  totalCost += response.cost.total;
  console.log(`Request cost: $${response.cost.total}`);
  console.log(`Total cost: $${totalCost}`);
}
```

## Real-World Examples

All the patterns above are demonstrated in the `scripts/` directory:

- **[image-feature-extract.ts](../scripts/image-feature-extract.ts)**: Structured output with image analysis
- **[google-pricing.ts](../scripts/google-pricing.ts)**: Custom evaluation runner with caching
- **[frankenstein.ts](../scripts/frankenstein.ts)**: Simple model comparison
- **[pdf-parsing.ts](../scripts/pdf-parsing.ts)**: File processing with structured output

## Next Steps

- Explore [Core Classes](/api/core-classes) for detailed class documentation
- See [Evaluation Framework](/api/evaluation-framework) for building custom evaluations
- Check [Schema Validation](/api/schemas) for advanced Zod schema patterns
- Review [MCP Integration](/MCP_IMPLEMENTATION_SUMMARY) for tool integration