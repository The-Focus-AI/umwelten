# Reasoning and Streaming Examples

Examples demonstrating reasoning token capture and streaming responses from AI models.

## Overview

Some AI models (particularly Qwen3 and Gemma3 variants) support "thinking" or "reasoning" tokens - internal deliberation that happens before generating the final response. Umwelten captures and exposes these reasoning tokens when available.

## Running the Examples

```bash
# Simple reasoning test
npx tsx src/test/test-reasoning-streaming-simple.ts

# Complex reasoning test
npx tsx src/test/test-reasoning-complex.ts

# Multi-model reasoning comparison
npx tsx src/test/test-reasoning-streaming.ts

# Basic Ollama token usage
npx tsx src/test/test-ollama-tokens.ts
```

## Example 1: Simple Reasoning Capture

Testing reasoning with a simple coding task:

```typescript
import { Interaction } from '../interaction/core/interaction.js';
import { BaseModelRunner } from '../cognition/runner.js';

async function testSimpleReasoning() {
  const modelDetails = { name: 'qwen3:8b', provider: 'ollama' };
  const prompt = 'Write a short TypeScript function that adds two numbers. Think through this step by step.';

  const interaction = new Interaction(
    modelDetails,
    'You are a TypeScript developer. Generate working TypeScript code. Think through your approach step by step.'
  );
  interaction.addMessage({ role: 'user', content: prompt });

  const runner = new BaseModelRunner();
  const response = await runner.streamText(interaction);

  console.log('Model:', response.metadata.model);
  console.log('Response Length:', response.content.length, 'characters');
  console.log('Tokens Used:', response.metadata.tokenUsage.completionTokens);

  if (response.reasoning) {
    console.log('\nReasoning captured:');
    console.log(response.reasoning);
  }

  // Extract code from response
  const codeMatch = response.content.match(/```(?:typescript|ts)\n([\s\S]*?)\n```/);
  if (codeMatch) {
    console.log('\nExtracted TypeScript code:');
    console.log(codeMatch[1]);
  }
}

testSimpleReasoning().catch(console.error);
```

## Example 2: Complex Reasoning Task

Testing with a more challenging generation task:

```typescript
import { Interaction } from '../interaction/core/interaction.js';
import { BaseModelRunner } from '../cognition/runner.js';

async function testComplexReasoning() {
  const modelDetails = { name: 'qwen3:14b', provider: 'ollama' };
  const prompt = `
    I need a script that will give me at least 1042 distinct but made up show names.
    They should be funny and grammatically correct and written in TypeScript.
    Think through this step by step.
  `;

  const interaction = new Interaction(
    modelDetails,
    'You are a TypeScript developer. Generate working TypeScript code. Think through your approach step by step.'
  );
  interaction.addMessage({ role: 'user', content: prompt });

  const runner = new BaseModelRunner();

  console.log('Starting streaming...');
  const response = await runner.streamText(interaction);

  console.log('\nResults:');
  console.log('Model:', response.metadata.model);
  console.log('Response Length:', response.content.length, 'characters');
  console.log('Completion Tokens:', response.metadata.tokenUsage.completionTokens);

  if (response.reasoning) {
    console.log(`\nReasoning captured (${response.reasoning.length} chars):`);
    console.log(response.reasoning);
  }
}

testComplexReasoning().catch(console.error);
```

## Example 3: Multi-Model Comparison

Comparing reasoning capabilities across different models:

```typescript
import { Interaction } from '../interaction/core/interaction.js';
import { BaseModelRunner } from '../cognition/runner.js';

async function compareModels() {
  const models = [
    { name: 'gemma3:12b', provider: 'ollama' },
    { name: 'gemma3:27b', provider: 'ollama' },
  ];

  const prompt = `
    I need a script that will give me at least 1042 distinct but made up show names.
    They should be funny and grammatically correct and written in TypeScript.
    Think through this step by step.
  `;

  for (const modelDetails of models) {
    console.log(`\nTesting ${modelDetails.name}...`);

    const interaction = new Interaction(
      modelDetails,
      'You are a TypeScript developer. Generate working TypeScript code that compiles and runs successfully. Always wrap your code in ```typescript code blocks. Think through your approach step by step.'
    );
    interaction.addMessage({ role: 'user', content: prompt });

    const runner = new BaseModelRunner();

    try {
      const response = await runner.streamText(interaction);

      console.log('Model:', response.metadata.model);
      console.log('Provider:', response.metadata.provider);
      console.log('Response Length:', response.content.length, 'characters');
      console.log('Tokens:', response.metadata.tokenUsage.completionTokens, 'completion');

      if (response.reasoning) {
        console.log(`\nReasoning captured (${response.reasoning.length} chars)`);
      } else {
        console.log('\nNo reasoning captured');
      }

      // Check for TypeScript code
      const codeMatch = response.content.match(/```typescript\n([\s\S]*?)\n```/);
      if (codeMatch) {
        console.log(`TypeScript code extracted (${codeMatch[1].length} chars)`);
      } else {
        console.log('No TypeScript code blocks found');
      }
    } catch (error) {
      console.error(`Error testing ${modelDetails.name}:`, error);
    }
  }
}

compareModels().catch(console.error);
```

## Example 4: Basic Token Usage

Simple test of Ollama token reporting:

```typescript
import { ollama } from 'ai-sdk-ollama';
import { generateText } from 'ai';

async function testTokenUsage() {
  const model = ollama('llama3.2:latest');

  const result = await generateText({
    model,
    prompt: 'Hello, how are you today?',
  });

  console.log('Response:', result.text);

  console.log('\nToken Usage:');
  if (result.usage) {
    console.log('Prompt tokens:', result.usage.promptTokens);
    console.log('Completion tokens:', result.usage.completionTokens);
    console.log('Total tokens:', result.usage.totalTokens);
  }
}

testTokenUsage().catch(console.error);
```

## Understanding Reasoning Tokens

### Models with Reasoning Support

Not all models support reasoning tokens. Models known to have reasoning capabilities:

- **Qwen3 family** (qwen3:8b, qwen3:14b, etc.)
- **Gemma3 family** (gemma3:12b, gemma3:27b, etc.)

### Accessing Reasoning Content

The `ModelResponse` type includes an optional `reasoning` field:

```typescript
interface ModelResponse {
  content: string;           // Main response content
  reasoning?: string;        // Reasoning/thinking tokens (if available)
  metadata: ResponseMetadata;
}
```

### Prompting for Reasoning

Including phrases like "think through this step by step" in your prompt often triggers more detailed reasoning:

```typescript
const systemPrompt = 'Think through your approach step by step.';
const userPrompt = 'Solve this problem and explain your reasoning.';
```

## Response Structure

### Full Response Type

```typescript
interface ModelResponse {
  content: string;
  reasoning?: string;
  metadata: {
    startTime: Date;
    endTime: Date;
    tokenUsage: {
      promptTokens: number;
      completionTokens: number;
    };
    provider: string;
    model: string;
    cost?: {
      promptCost: number;
      completionCost: number;
      totalCost: number;
    };
  };
}
```

### Checking for Reasoning

```typescript
const response = await runner.streamText(interaction);

if (response.reasoning) {
  console.log('Model provided reasoning:');
  console.log(response.reasoning);
} else {
  console.log('No reasoning tokens available for this model');
}
```

## Streaming vs Non-Streaming

### Streaming (Recommended)

```typescript
const response = await runner.streamText(interaction);
// Returns full response after streaming completes
```

### Non-Streaming

```typescript
const response = await runner.generateText(interaction);
// Waits for complete response before returning
```

Both methods capture reasoning tokens when available, but streaming provides better UX for long responses.

## Requirements

- **Ollama**: Must be running locally (`ollama serve`)
- **Models**: Must have reasoning-capable models pulled:
  ```bash
  ollama pull qwen3:8b
  ollama pull gemma3:12b
  ```

## Tips for Better Reasoning

1. **Be explicit**: Ask the model to "think step by step"
2. **Set expectations**: Include reasoning requirements in the system prompt
3. **Use capable models**: Larger models typically provide better reasoning
4. **Allow time**: Reasoning takes additional tokens and time

## Related Documentation

- [Running Prompts](/guide/running-prompts) - Basic prompt execution
- [Interactive Chat](/guide/interactive-chat) - Chat mode with reasoning
- [Model Discovery](/guide/model-discovery) - Finding reasoning-capable models
