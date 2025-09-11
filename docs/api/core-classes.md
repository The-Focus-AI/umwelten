# Core Classes

Essential classes for interacting with AI models, managing conversations, and building evaluations. These classes provide the foundation for all Umwelten functionality.

## BaseModelRunner

The primary class for executing model interactions and generating responses.

### Import
```typescript
import { BaseModelRunner } from '../src/cognition/runner.js';
```

### Methods

#### `generateText(interaction: Interaction): Promise<ModelResponse>`

Generate a text response from the model.

```typescript
const runner = new BaseModelRunner();
const conversation = new Interaction(model, "You are a helpful assistant");
conversation.addMessage({
  role: 'user',
  content: 'Explain quantum computing'
});

const response = await runner.generateText(conversation);
console.log(response.content); // Generated text
console.log(response.usage);   // Token usage stats
console.log(response.cost);    // Cost information
```

#### `streamObject<T>(interaction: Interaction, schema: ZodSchema<T>): Promise<ModelResponse>`

Generate structured output with real-time streaming, validated against a Zod schema.

```typescript
import { z } from 'zod';

const TaskSchema = z.object({
  title: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
  due_date: z.string().optional(),
  completed: z.boolean().default(false)
});

const runner = new BaseModelRunner();
const response = await runner.streamObject(conversation, TaskSchema);

// response.content contains the final JSON string
const task: z.infer<typeof TaskSchema> = JSON.parse(response.content);
```

**Important**: This method uses `partialObjectStream` internally to avoid hanging issues. The implementation iterates over partial objects and merges them to build the final result.

**Performance**:
- **Google Gemini**: ~600ms for streamObject
- **Ollama (gemma3:12b)**: ~500ms for streamObject
- **Real-time streaming**: Works without hanging or timeout issues

#### `streamText(interaction: Interaction): AsyncIterable<string>`

Stream text responses for real-time output.

```typescript
const runner = new BaseModelRunner();

for await (const chunk of runner.streamText(conversation)) {
  process.stdout.write(chunk); // Real-time output
}
```

### Streaming Patterns

The `BaseModelRunner` provides multiple methods for different streaming needs:

#### 1. For Immediate Results
```typescript
// Use generateObject for immediate structured results
const result = await runner.generateObject(interaction, schema);
const data = JSON.parse(result.content);
// data is immediately available
```

#### 2. For Real-Time Streaming
```typescript
// Use streamObject for real-time partial updates
const result = await runner.streamObject(interaction, schema);
const data = JSON.parse(result.content);
// data is built from partial object stream
```

#### 3. For Flexible JSON
```typescript
// Use generateText + JSON parsing for dynamic schemas
const result = await runner.generateText(interaction);
const jsonMatch = result.content.match(/\{.*\}/s);
const data = JSON.parse(jsonMatch[0]);
```

#### 4. For Text Streaming
```typescript
// Use streamText for real-time text chunks
const result = await runner.streamText(interaction);
// Process text chunks as they arrive
```

### Error Handling

The `BaseModelRunner` throws specific errors for different failure modes:

```typescript
import { BaseModelRunner } from '../src/cognition/runner.js';

try {
  const response = await runner.generateText(conversation);
  
  if (response.finishReason === 'error') {
    console.error('Generation failed');
  } else if (response.finishReason === 'length') {
    console.warn('Response truncated due to length limit');
  }
} catch (error) {
  if (error.message.includes('authentication')) {
    console.error('Invalid API key');
  } else if (error.message.includes('rate limit')) {
    console.error('Rate limit exceeded, wait and retry');
  } else {
    console.error('Unexpected error:', error.message);
  }
}
```

## Interaction

Manages conversations with models using the new Stimulus-driven architecture. Now requires both `modelDetails` and a `Stimulus` object.

### Import
```typescript
import { Interaction } from '../src/interaction/interaction.js';
import { Stimulus } from '../src/stimulus/stimulus.js';
```

### Constructor

```typescript
constructor(modelDetails: ModelDetails, stimulus: Stimulus)
```

Create a new conversation:

```typescript
import { ModelDetails } from '../src/cognition/types.js';

const model: ModelDetails = {
  name: 'gemini-2.0-flash',
  provider: 'google'
};

const stimulus = new Stimulus({
  role: "expert data analyst",
  objective: "analyze data and provide insights",
  instructions: [
    "Use statistical methods",
    "Provide clear visualizations",
    "Explain findings in business terms"
  ],
  temperature: 0.7,
  maxTokens: 1000
});

const interaction = new Interaction(model, stimulus);
```

### Methods

#### `addMessage(message: { role: 'user' | 'assistant', content: string }): void`

Add a message to the conversation:

```typescript
interaction.addMessage({
  role: 'user',
  content: 'Analyze this data and provide insights'
});

interaction.addMessage({
  role: 'assistant',
  content: 'Based on the data, I can see...'
});
```

#### `addAttachmentFromPath(filePath: string): Promise<void>`

Attach a file from the filesystem:

```typescript
// Attach an image
await interaction.addAttachmentFromPath('./chart.png');

// Attach a document
await interaction.addAttachmentFromPath('./report.pdf');

// Attach any supported file type
await interaction.addAttachmentFromPath('./data.csv');
```

#### `addAttachment(content: Buffer, mimeType: string, filename?: string): void`

Attach file content directly:

```typescript
const fileBuffer = fs.readFileSync('./image.jpg');
interaction.addAttachment(fileBuffer, 'image/jpeg', 'analysis-chart.jpg');
```

#### `getMessages(): Message[]`

Get all messages in the conversation:

```typescript
const messages = interaction.getMessages();
for (const message of messages) {
  console.log(`${message.role}: ${message.content}`);
}
```

#### `streamText(): Promise<ModelResponse>`

Generate a text response from the model:

```typescript
const response = await interaction.streamText();
console.log('Response:', response.content);
console.log('Usage:', response.usage);
```

#### `streamObject<T>(schema: z.ZodSchema<T>): Promise<ModelResponse>`

Generate structured output with real-time streaming:

```typescript
import { z } from 'zod';

const TaskSchema = z.object({
  title: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
  completed: z.boolean().default(false)
});

const response = await interaction.streamObject(TaskSchema);
const task = JSON.parse(response.content);
```

#### `getModel(): ModelDetails`

Get the model configuration:

```typescript
const model = interaction.getModel();
console.log(`Using ${model.provider}:${model.name}`);
```

### Supported File Types

The `Interaction` class supports various file formats:

- **Images**: JPG, JPEG, PNG, WebP, GIF
- **Documents**: PDF
- **Text**: TXT, MD (model-dependent)

```typescript
// Vision models can analyze images
const vision = new Interaction({ name: 'gemini-2.0-flash', provider: 'google' });
await vision.addAttachmentFromPath('./screenshot.png');
vision.addMessage({
  role: 'user',
  content: 'Describe what you see in this image'
});

// Document analysis
const docs = new Interaction({ name: 'gemini-2.0-flash', provider: 'google' });
await docs.addAttachmentFromPath('./research-paper.pdf');
docs.addMessage({
  role: 'user',
  content: 'Summarize the key findings of this research'
});
```

## EvaluationRunner

Abstract base class for building sophisticated evaluation workflows with caching, multiple model support, and result management.

### Import
```typescript
import { EvaluationRunner } from '../src/evaluation/runner.js';
```

### Basic Usage

Extend `EvaluationRunner` to create custom evaluation logic:

```typescript
import { EvaluationRunner } from '../src/evaluation/runner.js';
import { ModelDetails, ModelResponse } from '../src/cognition/types.js';

class CustomEvaluationRunner extends EvaluationRunner {
  constructor() {
    super('custom-evaluation-id'); // Unique identifier for this evaluation
  }

  // Implement the main evaluation logic
  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const runner = new BaseModelRunner();
    const conversation = new Interaction(model, 'You are an expert analyst');
    
    conversation.addMessage({
      role: 'user',
      content: 'Perform your analysis task here'
    });

    return runner.generateText(conversation);
  }
}

// Use the evaluation
const evaluation = new CustomEvaluationRunner();
await evaluation.evaluate({ name: 'gemini-2.0-flash', provider: 'google' });
```

### Advanced Features

#### Data Caching

Cache expensive operations to avoid repeated work:

```typescript
class WebScrapingEvaluation extends EvaluationRunner {
  constructor() {
    super('web-scraping-eval');
  }

  async getWebData(): Promise<string> {
    // This will only run once, then cache the result
    return this.getCachedFile('scraped-data', async () => {
      const response = await fetch('https://example.com/data');
      return response.text();
    });
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const webData = await this.getWebData(); // Uses cached data
    
    const conversation = new Interaction(model, 'Analyze web content');
    conversation.addMessage({
      role: 'user',
      content: `Analyze this web content: ${webData}`
    });

    const runner = new BaseModelRunner();
    return runner.generateText(conversation);
  }
}
```

#### Multi-Model Evaluation

Run the same evaluation across multiple models:

```typescript
const runner = new CustomEvaluationRunner();

// Test across different providers
await runner.evaluate({ name: 'gemini-2.0-flash', provider: 'google' });
await runner.evaluate({ name: 'gemma3:12b', provider: 'ollama' });
await runner.evaluate({ name: 'openai/gpt-4o-mini', provider: 'openrouter' });

// Results are automatically organized and stored
```

#### File Organization

The `EvaluationRunner` automatically organizes results:

```
output/evaluations/custom-evaluation-id/
├── responses/
│   ├── google_gemini-2.0-flash.json
│   ├── ollama_gemma3_12b.json
│   └── openrouter_openai_gpt-4o-mini.json
├── cached-data/
│   └── scraped-data.txt
└── metadata.json
```

### Real-World Example

Based on `scripts/google-pricing.ts`:

```typescript
class GooglePricingAnalysis extends EvaluationRunner {
  constructor() {
    super('google-pricing-analysis');
  }

  async getPricingData(): Promise<string> {
    return this.getCachedFile('pricing-html', async () => {
      const response = await fetch('https://ai.google.dev/gemini-api/docs/pricing');
      return response.text();
    });
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const html = await this.getPricingData();
    
    const pricingSchema = z.object({
      pricing: z.array(z.object({
        model: z.string(),
        inputCost: z.number(),
        outputCost: z.number(),
        description: z.string()
      }))
    });

    const conversation = new Interaction(model, 'Extract pricing information');
    conversation.addMessage({
      role: 'user',
      content: html
    });

    const runner = new BaseModelRunner();
    return runner.streamObject(conversation, pricingSchema);
  }
}

// Run the evaluation
const pricing = new GooglePricingAnalysis();
await pricing.evaluate({ name: 'gemini-2.0-flash', provider: 'google' });
```

## Types and Interfaces

### ModelDetails

Configuration for AI models:

```typescript
interface ModelDetails {
  name: string;        // Model identifier (e.g., 'gemini-2.0-flash')
  provider: string;    // Provider ('google', 'ollama', 'openrouter', 'lmstudio')
  temperature?: number; // Creativity/randomness (0-2, default: 1.0)
  maxTokens?: number;   // Maximum response length
  topP?: number;       // Nucleus sampling parameter
  topK?: number;       // Top-K sampling parameter
}
```

### ModelResponse

Response from model generation:

```typescript
interface ModelResponse {
  content: string;           // Generated text content
  model: string;             // Model that generated the response
  usage?: {                  // Token usage statistics
    promptTokens: number;
    completionTokens: number;
    total: number;
  };
  cost?: {                   // Cost information (when available)
    inputCost: number;
    outputCost: number;
    total: number;
  };
  finishReason?: string;     // Why generation stopped ('stop', 'length', 'error')
  structuredOutput?: any;    // Validated structured data (when using schemas)
  timing?: {                 // Performance metrics
    total: number;           // Total time in ms
    firstToken?: number;     // Time to first token
  };
}
```

### Message

Individual message in a conversation:

```typescript
interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: Attachment[];
}

interface Attachment {
  content: Buffer;
  mimeType: string;
  filename?: string;
}
```

## Error Types

### Common Error Scenarios

```typescript
// Authentication errors
try {
  await runner.generateText(conversation);
} catch (error) {
  if (error.message.includes('401') || error.message.includes('authentication')) {
    console.error('Invalid API key. Check your environment variables.');
  }
}

// Rate limiting errors
try {
  await runner.generateText(conversation);
} catch (error) {
  if (error.message.includes('429') || error.message.includes('rate limit')) {
    console.error('Rate limit exceeded. Wait before retrying.');
    await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 minute
  }
}

// Network errors
try {
  await runner.generateText(conversation);
} catch (error) {
  if (error.message.includes('ECONNREFUSED') || error.message.includes('timeout')) {
    console.error('Network error. Check your connection and try again.');
  }
}
```

### Schema Validation Errors

When using structured output with invalid schemas:

```typescript
import { z } from 'zod';

const StrictSchema = z.object({
  count: z.number().min(0).max(100),
  category: z.enum(['A', 'B', 'C'])
});

try {
  const response = await runner.streamObject(conversation, StrictSchema);
  console.log(response.structuredOutput); // Validated data
} catch (error) {
  if (error.name === 'ZodError') {
    console.error('Schema validation failed:', error.issues);
    // Handle each validation issue
    error.issues.forEach(issue => {
      console.error(`${issue.path}: ${issue.message}`);
    });
  }
}
```

## Best Practices

### Resource Management

```typescript
// Reuse runners when possible
const runner = new BaseModelRunner();

// Process multiple conversations with the same runner
for (const conversation of conversations) {
  const response = await runner.generateText(conversation);
  // Process response...
}
```

### Error Recovery

```typescript
async function robustGeneration(conversation: Interaction, maxRetries = 3): Promise<ModelResponse> {
  const runner = new BaseModelRunner();
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await runner.generateText(conversation);
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      
      if (attempt === maxRetries) {
        throw error; // Final attempt failed
      }
      
      // Wait before retry (exponential backoff)
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

### Memory Management

```typescript
// For large batch processing, process in chunks
async function processBatch(items: string[], chunkSize = 10) {
  const runner = new BaseModelRunner();
  const results = [];
  
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    
    const chunkPromises = chunk.map(async (item) => {
      const conversation = new Interaction(model, 'Process this item');
      conversation.addMessage({ role: 'user', content: item });
      return runner.generateText(conversation);
    });
    
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
    
    // Optional: Add delay between chunks to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return results;
}
```

## Next Steps

- See [Model Integration](/api/model-integration) for provider-specific details
- Check [Evaluation Framework](/api/evaluation-framework) for advanced evaluation patterns
- Explore [Schema Validation](/api/schemas) for structured output techniques