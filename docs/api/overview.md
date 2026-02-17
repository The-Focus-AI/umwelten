# TypeScript API Reference

Comprehensive reference for Umwelten's TypeScript API, showing how to build custom evaluations, interact with models programmatically, and extend functionality.

## Quick Navigation

### Core APIs
- **[Stimulus + Interaction Pattern](/api/interaction-interface-pattern)**: The core pattern — Stimulus defines behavior, Interaction manages conversations
- **[Cognition Module](/api/cognition)**: Model execution runners (generateText, streamText, generateObject, streamObject)
- **[Core Classes](/api/core-classes)**: Essential classes — BaseModelRunner, Interaction, EvaluationRunner
- **[Providers](/api/providers)**: Working with Google, OpenRouter, Ollama, LM Studio, GitHub Models
- **[Tools](/api/tools)**: Stimulus tools and Habitat tool sets
- **[Memory System](/api/memory)**: Conversation memory and fact extraction
- **[Evaluation Framework](/api/evaluation-framework)**: Building custom evaluation logic and runners
- **[Schema Validation](/api/schemas)**: Zod schemas and structured output validation

### Infrastructure
- **[Habitat](/guide/habitat)**: Managed agent environments with tools, sessions, and persistence
- **[CLI](/api/cli)**: Command-line interface (models, chat, eval, habitat, telegram)

## Core Concepts

### Stimulus + Interaction Pattern

Everything starts with a **Stimulus** (configuration) and an **Interaction** (conversation):

```typescript
import { Stimulus } from '../src/stimulus/stimulus.js';
import { Interaction } from '../src/interaction/core/interaction.js';

// Stimulus defines what the AI should do
const stimulus = new Stimulus({
  role: "helpful AI assistant",
  objective: "be conversational and helpful",
  instructions: ["Be concise", "Use tools when needed"],
  tools: { calculator: calculatorTool },
  runnerType: 'memory',    // automatic fact extraction
  maxToolSteps: 5
});

// Interaction manages the conversation
const interaction = new Interaction(
  { name: "gemini-3-flash-preview", provider: "google" },
  stimulus
);

const response = await interaction.chat("What's the weather like?");
console.log(response.content);
```

### Structured Output with Schemas

Extract structured data using Zod schemas:

```typescript
import { z } from 'zod';
import { Stimulus } from '../src/stimulus/stimulus.js';
import { Interaction } from '../src/interaction/core/interaction.js';

const PersonSchema = z.object({
  name: z.string().describe('Full name of the person'),
  age: z.number().int().describe('Age in years'),
  occupation: z.string().describe('Current job or profession'),
  skills: z.array(z.string()).describe('List of key skills')
});

const stimulus = new Stimulus({
  role: "information extraction system",
  objective: "extract person information from text"
});

const interaction = new Interaction(
  { name: "gemini-3-flash-preview", provider: "google" },
  stimulus
);

interaction.addMessage({
  role: 'user',
  content: 'John Smith is a 35-year-old software engineer with expertise in TypeScript, React, and Node.js.'
});

// generateObject returns structured data as JSON in response.content
const response = await interaction.generateObject(PersonSchema);
const person = JSON.parse(response.content);
console.log(person.name);    // "John Smith"
console.log(person.skills);  // ["TypeScript", "React", "Node.js"]
```

### File Attachments

Process files with model analysis:

```typescript
import { Stimulus } from '../src/stimulus/stimulus.js';
import { Interaction } from '../src/interaction/core/interaction.js';

const stimulus = new Stimulus({
  role: "image analyst",
  objective: "analyze attached images"
});

const interaction = new Interaction(
  { name: "gemini-3-flash-preview", provider: "google" },
  stimulus
);

await interaction.addAttachmentFromPath('./image.jpg');
const response = await interaction.chat("Describe what you see in this image");
console.log(response.content);
```

## Building Custom Evaluations

### Simple Evaluation Function

```typescript
import { Stimulus } from '../src/stimulus/stimulus.js';
import { Interaction } from '../src/interaction/core/interaction.js';
import { ModelDetails, ModelResponse } from '../src/cognition/types.js';

export async function analyzeText(model: ModelDetails, text: string): Promise<ModelResponse> {
  const stimulus = new Stimulus({
    role: "expert text analyst",
    objective: "analyze text and provide insights"
  });

  const interaction = new Interaction(model, stimulus);
  return interaction.chat(`Analyze the following text and provide insights: ${text}`);
}

const model = { name: "gemini-3-flash-preview", provider: "google" };
const result = await analyzeText(model, "Sample text to analyze");
console.log(result.content);
```

### Advanced Evaluation Runner

Build sophisticated evaluation workflows:

```typescript
import { EvaluationRunner } from '../src/evaluation/runner.js';
import { ModelDetails, ModelResponse } from '../src/cognition/types.js';
import { Stimulus } from '../src/stimulus/stimulus.js';
import { Interaction } from '../src/interaction/core/interaction.js';
import { z } from 'zod';

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
    return this.getCachedFile('input-text', async () => {
      return "Text content to analyze";
    });
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const text = await this.getTextData();

    const stimulus = new Stimulus({
      role: "text analyst",
      objective: "analyze text sentiment and extract key information"
    });

    const interaction = new Interaction(model, stimulus);
    interaction.addMessage({ role: 'user', content: `Analyze this text: ${text}` });

    const runner = new BaseModelRunner();
    return runner.streamObject(interaction, AnalysisSchema);
  }
}

const runner = new TextAnalysisRunner();
await runner.evaluate({ name: 'gemini-3-flash-preview', provider: 'google' });
await runner.evaluate({ name: 'gemma3:12b', provider: 'ollama' });
```

## Working with Different Providers

```typescript
import { ModelDetails } from '../src/cognition/types.js';

// Google Gemini (requires GOOGLE_GENERATIVE_AI_API_KEY)
const googleModel: ModelDetails = {
  name: 'gemini-3-flash-preview',
  provider: 'google'
};

// Ollama local models (requires Ollama server at localhost:11434)
const ollamaModel: ModelDetails = {
  name: 'gemma3:12b',
  provider: 'ollama'
};

// OpenRouter hosted models (requires OPENROUTER_API_KEY)
const openRouterModel: ModelDetails = {
  name: 'openai/gpt-4o-mini',
  provider: 'openrouter'
};

// GitHub Models (requires GITHUB_TOKEN)
const githubModel: ModelDetails = {
  name: 'gpt-4o-mini',
  provider: 'github-models'
};

// LM Studio local models (requires LM Studio at localhost:1234)
const lmStudioModel: ModelDetails = {
  name: 'local-model-name',
  provider: 'lmstudio'
};
```

## Essential Types

### ModelResponse

Every generation method returns a `ModelResponse`:

```typescript
interface ModelResponse {
  content: string;              // The text response (or JSON string for structured output)
  metadata: {
    startTime: Date;
    endTime: Date;
    tokenUsage: {
      promptTokens: number;
      completionTokens: number;
      total?: number;
    };
    cost?: {                    // Cost breakdown (when available)
      promptCost: number;
      completionCost: number;
      totalCost: number;
      usage: TokenUsage;
    };
    provider: string;
    model: string;
  };
  reasoning?: string;           // Chain-of-thought (if model supports it)
  reasoningDetails?: Array<{
    type: 'text' | 'redacted';
    text?: string;
    data?: string;
    signature?: string;
  }>;
}
```

### ModelDetails

```typescript
interface ModelDetails {
  name: string;          // Model identifier (e.g., 'gemini-3-flash-preview')
  provider: string;      // Provider ('google', 'ollama', 'openrouter', 'lmstudio', 'github-models')
  temperature?: number;  // Creativity setting (0-2)
  topP?: number;         // Nucleus sampling
  topK?: number;         // Top-K sampling
  numCtx?: number;       // Context token count (Ollama)
  description?: string;
  contextLength?: number;
  costs?: {
    promptTokens: number;       // Cost per million prompt tokens
    completionTokens: number;   // Cost per million completion tokens
  };
}
```

## Common Patterns

### Cost Tracking

```typescript
const response = await interaction.chat("Hello");

if (response.metadata.cost) {
  console.log(`Request cost: $${response.metadata.cost.totalCost}`);
  console.log(`Tokens: ${response.metadata.tokenUsage.total}`);
}
```

### Error Handling

```typescript
import { BaseModelRunner } from '../src/cognition/runner.js';

try {
  const runner = new BaseModelRunner();
  const response = await runner.generateText(interaction);
  console.log(response.content);
} catch (error) {
  if (error.message.includes('Invalid model details')) {
    console.error('Model not found on provider');
  } else if (error.message.includes('Rate limit exceeded')) {
    console.error('Rate limit exceeded, wait and retry');
  } else {
    console.error('API call failed:', error.message);
  }
}
```

### Batch Processing

```typescript
import { Stimulus } from '../src/stimulus/stimulus.js';
import { Interaction } from '../src/interaction/core/interaction.js';
import { ModelDetails, ModelResponse } from '../src/cognition/types.js';

async function processBatch(texts: string[], model: ModelDetails): Promise<ModelResponse[]> {
  const results: ModelResponse[] = [];

  for (const text of texts) {
    const stimulus = new Stimulus({
      role: "text processor",
      objective: "analyze text"
    });

    const interaction = new Interaction(model, stimulus);

    try {
      const response = await interaction.chat(text);
      results.push(response);
    } catch (error) {
      console.error(`Failed to process: ${text.substring(0, 50)}...`);
    }
  }

  return results;
}
```

## Next Steps

- Explore [Core Classes](/api/core-classes) for detailed class documentation
- See [Evaluation Framework](/api/evaluation-framework) for building custom evaluations
- Check [Schema Validation](/api/schemas) for advanced Zod schema patterns
- Review [Tools](/api/tools) for adding tool capabilities
