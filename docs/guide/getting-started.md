# Getting Started

## Quick Start

Welcome to umwelten! This guide will help you get up and running with the evaluation framework in just a few minutes.

## Prerequisites

- Node.js 20+ 
- pnpm (recommended) or npm
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

4. **Build the project**
```bash
pnpm build
```

## Running Examples

The easiest way to get started is by running the example scripts:

```bash
# Simple evaluation example
pnpm tsx scripts/examples/simple-evaluation-example.ts

# Matrix evaluation (compare multiple models)
pnpm tsx scripts/examples/matrix-evaluation-example.ts

# Batch evaluation (process multiple inputs)
pnpm tsx scripts/examples/batch-evaluation-example.ts

# Complex pipeline (multi-step evaluation)
pnpm tsx scripts/examples/complex-pipeline-example.ts

# Comprehensive analysis
pnpm tsx scripts/examples/comprehensive-analysis-example.ts
```

## CLI Usage

You can also use the umwelten CLI directly:

```bash
# List available models
pnpm cli models

# Run a simple evaluation
pnpm cli run "Hello, world!" --model gpt-4

# Interactive chat
pnpm cli chat --memory

# Run evaluation with specific model
pnpm cli eval run --prompt "Explain quantum computing" --models "gpt-4,claude-3"
```

## Your First Evaluation

Let's create a simple evaluation to test a model's creative writing capabilities.

### 1. Create a Basic Script

Create a new file `my-first-evaluation.ts`:

```typescript
import { ModelDetails } from "./src/cognition/types.js";
import { Interaction } from "./src/interaction/interaction.js";
import { LiteraryAnalysisTemplate } from "./src/stimulus/templates/creative-templates.js";
import { SimpleEvaluation } from "./src/evaluation/strategies/simple-evaluation.js";

// Create evaluation
const evaluation = new SimpleEvaluation({
  id: "my-first-evaluation",
  name: "My First Evaluation",
  description: "A simple creative writing test"
});

// Define test case
const testCase = {
  id: "creative-writing-test",
  name: "Creative Writing Test",
  stimulus: LiteraryAnalysisTemplate,
  input: {
    prompt: "Write a short story about a robot learning to paint"
  }
};

// Run evaluation
const result = await evaluation.run({
  model: {
    name: "gpt-4",
    provider: "openrouter",
    costs: {
      promptTokens: 0.0001,
      completionTokens: 0.0001
    },
    maxTokens: 1000,
    temperature: 0.7
  },
  testCases: [testCase]
});

console.log("Evaluation completed!");
console.log("Response:", result.responses[0]?.content);
```

### 2. Run the Evaluation

```bash
npx tsx my-first-evaluation.ts
```

## Understanding the Results

The evaluation returns a result object with:

- **Responses**: Model responses for each test case
- **Metrics**: Performance data (time, tokens, cost)
- **Metadata**: Additional information about the evaluation

```typescript
console.log("Response:", result.responses[0]?.content);
console.log("Tokens used:", result.metrics?.totalTokens);
console.log("Cost:", result.metrics?.totalCost);
console.log("Time taken:", result.metrics?.totalTime);
```

## Next Steps

### 1. Try Different Models

```typescript
const models = [
  { name: "gpt-4", provider: "openrouter" },
  { name: "claude-3", provider: "openrouter" },
  { name: "gemini-pro", provider: "google" }
];

for (const model of models) {
  const result = await evaluation.run({ model, testCases: [testCase] });
  console.log(`${model.name}: ${result.responses[0]?.content?.substring(0, 100)}...`);
}
```

### 2. Use Different Stimulus Templates

```typescript
import { PoetryGenerationTemplate } from "./src/stimulus/templates/creative-templates.js";
import { CodeGenerationTemplate } from "./src/stimulus/templates/coding-templates.js";

// Creative writing
const creativeTest = {
  id: "poetry-test",
  name: "Poetry Generation",
  stimulus: PoetryGenerationTemplate,
  input: { prompt: "Write a haiku about the ocean" }
};

// Code generation
const codingTest = {
  id: "code-test",
  name: "Code Generation",
  stimulus: CodeGenerationTemplate,
  input: { prompt: "Write a Python function to calculate fibonacci numbers" }
};
```

### 3. Compare Multiple Models

```typescript
import { MatrixEvaluation } from "./src/evaluation/strategies/matrix-evaluation.js";

const matrixEvaluation = new MatrixEvaluation({
  id: "model-comparison",
  name: "Model Comparison",
  description: "Compare multiple models on the same task"
});

const result = await matrixEvaluation.run({
  models: [
    { name: "gpt-4", provider: "openrouter" },
    { name: "claude-3", provider: "openrouter" },
    { name: "gemini-pro", provider: "google" }
  ],
  testCases: [testCase]
});
```

## Common Patterns

### 1. Batch Processing

```typescript
import { BatchEvaluation } from "./src/evaluation/strategies/batch-evaluation.js";

const batchEvaluation = new BatchEvaluation({
  id: "batch-processing",
  name: "Batch Processing",
  description: "Process multiple inputs with the same model"
});

const testCases = [
  { id: "test-1", stimulus: myStimulus, input: { prompt: "Input 1" } },
  { id: "test-2", stimulus: myStimulus, input: { prompt: "Input 2" } },
  { id: "test-3", stimulus: myStimulus, input: { prompt: "Input 3" } }
];

const result = await batchEvaluation.run({
  model: { name: "gpt-4", provider: "openrouter" },
  testCases
});
```

### 2. Custom Stimulus

```typescript
import { Stimulus } from "./src/stimulus/stimulus.js";

const customStimulus = new Stimulus({
  id: "custom-stimulus",
  name: "Custom Stimulus",
  description: "A custom stimulus for specific needs",
  
  role: "expert analyst",
  objective: "analyze data and provide insights",
  instructions: [
    "Examine the data carefully",
    "Identify key patterns and trends",
    "Provide actionable recommendations"
  ],
  output: [
    "Structured analysis report",
    "Key findings and insights",
    "Recommendations for next steps"
  ],
  
  temperature: 0.7,
  maxTokens: 1500,
  runnerType: 'base'
});
```

### 3. Using Tools

```typescript
import { PDFTools } from "./src/stimulus/tools/pdf-tools.js";

const stimulusWithTools = new Stimulus({
  // ... other properties
  tools: {
    extractText: PDFTools.extractText,
    extractMetadata: PDFTools.extractMetadata
  }
});
```

## Configuration

### Environment Variables

```bash
# OpenRouter API key
OPENROUTER_API_KEY=your_openrouter_key

# Google API key
GOOGLE_API_KEY=your_google_key

# Ollama base URL (optional)
OLLAMA_BASE_URL=http://localhost:11434

# LM Studio base URL (optional)
LMSTUDIO_BASE_URL=http://localhost:1234
```

### Model Configuration

```typescript
const model: ModelDetails = {
  name: "gpt-4",
  provider: "openrouter",
  costs: {
    promptTokens: 0.0001,
    completionTokens: 0.0001
  },
  maxTokens: 1000,
  temperature: 0.7,
  // ... other model-specific settings
};
```

## Troubleshooting

### Common Issues

#### API Key Errors
- Verify your API keys are set correctly
- Check the provider documentation for key format
- Ensure the key has the necessary permissions

#### Model Not Found
- Verify the model name is correct
- Check if the model is available in your region
- Ensure you have access to the model

#### Rate Limit Errors
- The framework automatically handles rate limits
- Consider using caching to reduce API calls
- Implement delays between requests if needed

### Getting Help

- Check the [API Reference](../api/README.md)
- Look at [examples](../examples/README.md)
- Review [troubleshooting guide](troubleshooting.md)
- Open an issue on GitHub

## What's Next?

Now that you have the basics, explore:

1. **[Creating Evaluations](creating-evaluations.md)** - Learn how to create more complex evaluations
2. **[Writing Scripts](writing-scripts.md)** - Best practices for writing test scripts
3. **[Stimulus Templates](stimulus-templates.md)** - Using and creating stimulus templates
4. **[Tool Integration](tool-integration.md)** - Integrating external tools
5. **[Advanced Features](advanced-features.md)** - Complex evaluation patterns

Happy evaluating! 🚀