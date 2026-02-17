# Getting Started

## Quick Start

Welcome to umwelten! This guide will help you get up and running in just a few minutes.

## Prerequisites

- Node.js 20+
- pnpm (recommended)
- API keys for your chosen AI providers

## Installation

1. **Clone the repository**
```bash
git clone https://github.com/The-Focus-AI/umwelten.git
cd umwelten
```

2. **Install dependencies**
```bash
pnpm install
```

3. **Set up environment variables**
```bash
cp env.template .env
# Edit .env with your API keys
```

Required env vars depend on your provider:
```bash
# Google Gemini (recommended for getting started)
GOOGLE_GENERATIVE_AI_API_KEY=your_key_here

# OpenRouter (for OpenAI, Anthropic, etc.)
OPENROUTER_API_KEY=your_key_here

# GitHub Models (free tier)
GITHUB_TOKEN=your_token_here

# Local providers (Ollama, LM Studio) need no env vars
```

4. **Build the project**
```bash
pnpm build
```

## CLI Usage

All CLI commands should be prefixed with `dotenvx run --` to load API keys from `.env`:

```bash
# List available models from a provider
dotenvx run -- pnpm run cli -- models --provider google

# Run a simple prompt
dotenvx run -- pnpm run cli -- run --provider google --model gemini-3-flash-preview "Explain quantum computing"

# Interactive chat
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-3-flash-preview

# Chat with memory (remembers facts across messages)
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-3-flash-preview --memory
```

## Your First Script

Create a file `my-first-script.ts`:

```typescript
import { Stimulus } from './src/stimulus/stimulus.js';
import { Interaction } from './src/interaction/core/interaction.js';

const stimulus = new Stimulus({
  role: "creative writer",
  objective: "write engaging short stories",
  instructions: [
    "Write vivid, imaginative stories",
    "Keep stories under 200 words"
  ],
  temperature: 0.8
});

const interaction = new Interaction(
  { name: "gemini-3-flash-preview", provider: "google" },
  stimulus
);

const response = await interaction.chat("Write a short story about a robot learning to paint");

console.log("Story:", response.content);
console.log("Tokens used:", response.metadata.tokenUsage.total);
if (response.metadata.cost) {
  console.log("Cost:", `$${response.metadata.cost.totalCost}`);
}
```

Run it:
```bash
dotenvx run -- pnpm tsx my-first-script.ts
```

## Structured Output

Extract structured data using Zod schemas:

```typescript
import { z } from 'zod';
import { Stimulus } from './src/stimulus/stimulus.js';
import { Interaction } from './src/interaction/core/interaction.js';

const BookSchema = z.object({
  title: z.string(),
  author: z.string(),
  year: z.number(),
  genre: z.string(),
  summary: z.string()
});

const stimulus = new Stimulus({
  role: "librarian",
  objective: "extract book information from text"
});

const interaction = new Interaction(
  { name: "gemini-3-flash-preview", provider: "google" },
  stimulus
);

interaction.addMessage({
  role: 'user',
  content: 'Tell me about "1984" by George Orwell'
});

const response = await interaction.generateObject(BookSchema);
const book = JSON.parse(response.content);
console.log(book.title);   // "1984"
console.log(book.author);  // "George Orwell"
```

## Your First Evaluation

Compare how different models handle the same task:

```typescript
import { EvaluationRunner } from './src/evaluation/runner.js';
import { ModelDetails, ModelResponse } from './src/cognition/types.js';
import { BaseModelRunner } from './src/cognition/runner.js';
import { Stimulus } from './src/stimulus/stimulus.js';
import { Interaction } from './src/interaction/core/interaction.js';

class CreativeWritingEval extends EvaluationRunner {
  constructor() {
    super('creative-writing-test');
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const stimulus = new Stimulus({
      role: "creative writer",
      objective: "write engaging stories",
      temperature: 0.8
    });

    const interaction = new Interaction(model, stimulus);
    interaction.addMessage({
      role: 'user',
      content: 'Write a haiku about the ocean'
    });

    const runner = new BaseModelRunner();
    return runner.generateText(interaction);
  }
}

const evaluation = new CreativeWritingEval();

// Compare across providers
await evaluation.evaluate({ name: 'gemini-3-flash-preview', provider: 'google' });
await evaluation.evaluate({ name: 'gemma3:12b', provider: 'ollama' });

// Results are saved in output/evaluations/creative-writing-test/
```

## Using Habitat

For a full agent environment with tools, sessions, and persistence:

```bash
# Start the habitat REPL
dotenvx run -- pnpm run cli -- habitat

# Start as a Telegram bot
dotenvx run -- pnpm run cli -- habitat telegram
```

The habitat provides:
- Agent management (sub-agents with their own skills)
- Session persistence
- Tool sets (file operations, search, secrets, code execution)
- Skills sharing between agents

## Custom Stimulus

Create reusable stimulus configurations:

```typescript
import { Stimulus } from './src/stimulus/stimulus.js';

// Analytical stimulus
const analyticalStimulus = new Stimulus({
  role: "data analyst",
  objective: "analyze data and provide actionable insights",
  instructions: [
    "Examine the data carefully",
    "Identify key patterns and trends",
    "Provide actionable recommendations"
  ],
  output: [
    "Structured analysis report",
    "Key findings",
    "Recommendations"
  ],
  temperature: 0.3,
  maxTokens: 1500
});

// Creative stimulus
const creativeStimulus = new Stimulus({
  role: "creative writer",
  objective: "write engaging content",
  instructions: [
    "Be creative and original",
    "Use vivid language"
  ],
  temperature: 0.9,
  maxTokens: 2000
});
```

## Using Tools

Add tools to give the AI capabilities:

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { Stimulus } from './src/stimulus/stimulus.js';
import { Interaction } from './src/interaction/core/interaction.js';

const calculatorTool = tool({
  description: "Performs basic arithmetic",
  parameters: z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    a: z.number(),
    b: z.number()
  }),
  execute: async ({ operation, a, b }) => {
    switch (operation) {
      case 'add': return { result: a + b };
      case 'subtract': return { result: a - b };
      case 'multiply': return { result: a * b };
      case 'divide': return { result: a / b };
    }
  }
});

const stimulus = new Stimulus({
  role: "math tutor",
  tools: { calculator: calculatorTool },
  toolInstructions: ["Use the calculator for arithmetic"],
  maxToolSteps: 5
});

const interaction = new Interaction(
  { name: "gemini-3-flash-preview", provider: "google" },
  stimulus
);

const response = await interaction.chat("What is 42 * 17?");
console.log(response.content);
```

## Troubleshooting

### API Key Errors
- Verify your API keys in `.env`
- Make sure to use `dotenvx run --` prefix when running commands
- Google uses `GOOGLE_GENERATIVE_AI_API_KEY` (not `GOOGLE_API_KEY`)

### Model Not Found
- Run `dotenvx run -- pnpm run cli -- models --provider <provider>` to see available models
- Model names must exactly match the provider's naming

### Rate Limit Errors
- The framework has built-in rate limiting
- Consider using caching in evaluations (`getCachedFile()`)
- Add delays between requests if needed

## What's Next?

1. **[Habitat Guide](/guide/habitat)** - Set up a full agent environment
2. **[Tools](/api/tools)** - Learn about stimulus tools and habitat tool sets
3. **[API Reference](/api/overview)** - Full TypeScript API documentation
4. **[Evaluation Framework](/api/evaluation-framework)** - Build sophisticated evaluations
