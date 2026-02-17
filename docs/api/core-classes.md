# Core Classes

Essential classes for interacting with AI models, managing conversations, and building evaluations.

## BaseModelRunner

The primary class for executing model interactions and generating responses.

### Import
```typescript
import { BaseModelRunner } from '../src/cognition/runner.js';
```

### Constructor

```typescript
const runner = new BaseModelRunner(config?: Partial<ModelRunnerConfig>);

interface ModelRunnerConfig {
  rateLimitConfig?: RateLimitConfig;
  maxRetries?: number;    // default: 3
  maxTokens?: number;     // default: 4096
}
```

### Methods

#### `generateText(interaction: Interaction): Promise<ModelResponse>`

Generate a text response from the model.

```typescript
import { Stimulus } from '../src/stimulus/stimulus.js';
import { Interaction } from '../src/interaction/core/interaction.js';

const stimulus = new Stimulus({
  role: "helpful assistant",
  objective: "answer questions clearly"
});

const interaction = new Interaction(
  { name: "gemini-3-flash-preview", provider: "google" },
  stimulus
);

interaction.addMessage({
  role: 'user',
  content: 'Explain quantum computing'
});

const runner = new BaseModelRunner();
const response = await runner.generateText(interaction);

console.log(response.content);                    // Generated text
console.log(response.metadata.tokenUsage);         // { promptTokens, completionTokens, total }
console.log(response.metadata.cost?.totalCost);    // Cost in dollars
```

#### `streamText(interaction: Interaction): Promise<ModelResponse>`

Stream text responses with real-time output to stdout, then return the complete `ModelResponse`.

```typescript
const runner = new BaseModelRunner();
const response = await runner.streamText(interaction);
// Text chunks are written to stdout during streaming
// response.content contains the full text when done
console.log(response.metadata.tokenUsage);
```

Streaming handles tool calls automatically — tool-call and tool-result messages are added to the interaction during the stream.

#### `generateObject(interaction: Interaction, schema: ZodSchema): Promise<ModelResponse>`

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
const response = await runner.generateObject(interaction, TaskSchema);

// Structured output is returned as JSON in response.content
const task = JSON.parse(response.content);
console.log(task.title);
console.log(task.priority);
```

#### `streamObject(interaction: Interaction, schema: ZodSchema): Promise<ModelResponse>`

Generate structured output with streaming via `partialObjectStream`. Returns the complete result when done.

```typescript
const runner = new BaseModelRunner();
const response = await runner.streamObject(interaction, TaskSchema);

// response.content is JSON string of the final object
const task = JSON.parse(response.content);
```

Uses `partialObjectStream` internally to avoid hanging issues. Partial objects are merged progressively to build the final result.

### All Methods Return ModelResponse

Every runner method returns the same shape:

```typescript
interface ModelResponse {
  content: string;              // Text or JSON string
  metadata: {
    startTime: Date;
    endTime: Date;
    tokenUsage: {
      promptTokens: number;
      completionTokens: number;
      total?: number;
    };
    cost?: CostBreakdown;
    provider: string;
    model: string;
  };
  reasoning?: string;           // Chain-of-thought (if supported)
  reasoningDetails?: Array<{
    type: 'text' | 'redacted';
    text?: string;
    data?: string;
    signature?: string;
  }>;
}
```

## Interaction

Manages conversations with models. Requires both `ModelDetails` and a `Stimulus` object.

### Import
```typescript
import { Interaction } from '../src/interaction/core/interaction.js';
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
  name: 'gemini-3-flash-preview',
  provider: 'google'
};

const stimulus = new Stimulus({
  role: "expert data analyst",
  objective: "analyze data and provide insights",
  instructions: [
    "Use statistical methods",
    "Explain findings clearly"
  ],
  temperature: 0.7,
  maxTokens: 1000
});

const interaction = new Interaction(model, stimulus);
```

### High-Level Methods

The Interaction class has convenience methods that internally create a `BaseModelRunner`:

#### `chat(message: string): Promise<ModelResponse>`

Add a user message and get a response:

```typescript
const response = await interaction.chat("Analyze this dataset");
console.log(response.content);
```

#### `generateText(): Promise<ModelResponse>`

Generate without adding a new user message (uses existing messages):

```typescript
interaction.addMessage({ role: 'user', content: 'Hello' });
const response = await interaction.generateText();
```

#### `streamText(): Promise<ModelResponse>`

Stream with real-time output:

```typescript
const response = await interaction.streamText();
console.log(response.content);  // Full text after streaming completes
```

#### `generateObject(schema: ZodSchema): Promise<ModelResponse>`

Generate structured output:

```typescript
const response = await interaction.generateObject(AnalysisSchema);
const analysis = JSON.parse(response.content);
```

#### `streamObject(schema: ZodSchema): Promise<ModelResponse>`

Stream structured output:

```typescript
const response = await interaction.streamObject(TaskSchema);
const task = JSON.parse(response.content);
```

### Message Management

#### `addMessage(message: CoreMessage): void`

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

#### `getMessages(): CoreMessage[]`

Get all messages in the conversation.

#### `addAttachmentFromPath(filePath: string): Promise<void>`

Attach a file from the filesystem:

```typescript
await interaction.addAttachmentFromPath('./chart.png');
await interaction.addAttachmentFromPath('./report.pdf');
```

Supported file types: JPG, JPEG, PNG, WebP, GIF (images), PDF (documents).

### Context Management

```typescript
// Set checkpoint before a long conversation
interaction.setCheckpoint();

// ... have conversation ...

// Compact context to manage token usage
const result = await interaction.compactContext();

if (result) {
  console.log(`Compacted segment [${result.segmentStart}..${result.segmentEnd}]`);
  console.log(`Replaced with ${result.replacementCount} message(s)`);
}
```

### Tools

```typescript
// Check if interaction has tools
interaction.hasTools();       // boolean

// Get Vercel AI SDK tools
interaction.getVercelTools(); // Record<string, Tool>

// Set max tool steps
interaction.setMaxSteps(10);

// Set output format for structured generation
interaction.setOutputFormat(zodSchema);
```

## Stimulus

Configuration object that defines AI behavior. Does not run anything — it's pure configuration.

### Import
```typescript
import { Stimulus } from '../src/stimulus/stimulus.js';
```

### Constructor

```typescript
const stimulus = new Stimulus(options: StimulusOptions);
```

### StimulusOptions

```typescript
interface StimulusOptions {
  id?: string;
  name?: string;
  description?: string;
  role?: string;                    // System role
  objective?: string;               // What the AI should accomplish
  instructions?: string[];          // Specific behavioral instructions
  reasoning?: string;               // Reasoning style guidance
  output?: string[];                // Output format instructions
  examples?: (string | { input: string; output: string })[];

  // Tools
  tools?: Record<string, Tool>;     // Vercel AI SDK tools
  toolInstructions?: string[];      // Tool usage guidance
  maxToolSteps?: number;            // Max tool call rounds

  // Model options
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;

  // Runner
  runnerType?: 'base' | 'memory';   // 'memory' enables automatic fact extraction

  // Context
  systemContext?: string;

  // Skills
  skills?: SkillDefinition[];
  skillsDirs?: string[];
  skillsFromGit?: string[];
  skillsCacheRoot?: string;
}
```

### Key Methods

```typescript
stimulus.getPrompt();     // Returns the assembled system prompt string
stimulus.getTools();      // Returns the tools record
```

## EvaluationRunner

Abstract base class for building evaluation workflows with caching, multiple model support, and result management.

### Import
```typescript
import { EvaluationRunner } from '../src/evaluation/runner.js';
```

### Basic Usage

Extend `EvaluationRunner` to create custom evaluation logic:

```typescript
import { EvaluationRunner } from '../src/evaluation/runner.js';
import { ModelDetails, ModelResponse } from '../src/cognition/types.js';
import { BaseModelRunner } from '../src/cognition/runner.js';
import { Stimulus } from '../src/stimulus/stimulus.js';
import { Interaction } from '../src/interaction/core/interaction.js';

class CustomEvaluationRunner extends EvaluationRunner {
  constructor() {
    super('custom-evaluation-id');
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const stimulus = new Stimulus({
      role: "expert analyst",
      objective: "perform analysis"
    });

    const interaction = new Interaction(model, stimulus);
    interaction.addMessage({
      role: 'user',
      content: 'Perform your analysis task here'
    });

    const runner = new BaseModelRunner();
    return runner.generateText(interaction);
  }
}

const evaluation = new CustomEvaluationRunner();
await evaluation.evaluate({ name: 'gemini-3-flash-preview', provider: 'google' });
```

### Data Caching

Cache expensive operations to avoid repeated work:

```typescript
class WebScrapingEvaluation extends EvaluationRunner {
  constructor() {
    super('web-scraping-eval');
  }

  async getWebData(): Promise<string> {
    return this.getCachedFile('scraped-data', async () => {
      const response = await fetch('https://example.com/data');
      return response.text();
    });
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const webData = await this.getWebData();

    const stimulus = new Stimulus({
      role: "web content analyst",
      objective: "analyze web content"
    });

    const interaction = new Interaction(model, stimulus);
    interaction.addMessage({ role: 'user', content: `Analyze: ${webData}` });

    const runner = new BaseModelRunner();
    return runner.generateText(interaction);
  }
}
```

### Multi-Model Evaluation

```typescript
const runner = new CustomEvaluationRunner();

await runner.evaluate({ name: 'gemini-3-flash-preview', provider: 'google' });
await runner.evaluate({ name: 'gemma3:12b', provider: 'ollama' });
await runner.evaluate({ name: 'openai/gpt-4o-mini', provider: 'openrouter' });

// Results are automatically organized in:
// output/evaluations/<evaluation-id>/responses/<provider>_<model>.json
```

## Types and Interfaces

### ModelDetails

```typescript
interface ModelDetails {
  name: string;          // Model identifier (e.g., 'gemini-3-flash-preview')
  provider: string;      // Provider ('google', 'ollama', 'openrouter', 'lmstudio', 'github-models')
  temperature?: number;  // Creativity/randomness (0-2)
  topP?: number;         // Nucleus sampling parameter
  topK?: number;         // Top-K sampling parameter
  numCtx?: number;       // Context token count (Ollama)
  description?: string;
  contextLength?: number;
  costs?: {
    promptTokens: number;       // Cost per million prompt tokens
    completionTokens: number;   // Cost per million completion tokens
  };
}
```

### ModelResponse

```typescript
interface ModelResponse {
  content: string;
  metadata: {
    startTime: Date;
    endTime: Date;
    tokenUsage: {
      promptTokens: number;
      completionTokens: number;
      total?: number;
    };
    cost?: {
      promptCost: number;
      completionCost: number;
      totalCost: number;
      usage: TokenUsage;
    };
    provider: string;
    model: string;
  };
  reasoning?: string;
  reasoningDetails?: Array<{
    type: 'text' | 'redacted';
    text?: string;
    data?: string;
    signature?: string;
  }>;
}
```

### ModelRunner Interface

```typescript
interface ModelRunner {
  generateText(interaction: Interaction): Promise<ModelResponse>;
  streamText(interaction: Interaction): Promise<ModelResponse>;
  generateObject(interaction: Interaction, schema: ZodSchema): Promise<ModelResponse>;
  streamObject(interaction: Interaction, schema: ZodSchema): Promise<ModelResponse>;
}
```

## Next Steps

- See [Providers](/api/providers) for provider-specific details
- Check [Evaluation Framework](/api/evaluation-framework) for advanced evaluation patterns
- Explore [Schema Validation](/api/schemas) for structured output techniques
- Review [Tools](/api/tools) for adding tool capabilities
