# Creating Evaluations

## Overview

This guide covers how to create effective evaluations using the umwelten framework. You'll learn about different evaluation strategies, how to design test cases, and best practices for getting reliable results.

## Evaluation Strategies

### 1. SimpleEvaluation

Use for basic single-model testing.

```typescript
import { SimpleEvaluation } from '../src/evaluation/strategies/simple-evaluation.js';

const evaluation = new SimpleEvaluation({
  id: "basic-test",
  name: "Basic Test",
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
    stimulus: myStimulus,
    input: { prompt: "Hello, world!" }
  }]
});
```

**When to use:**
- Single model testing
- Simple prompt-response evaluations
- Basic functionality verification

### 2. MatrixEvaluation

Compare multiple models on the same test cases.

```typescript
import { MatrixEvaluation } from '../src/evaluation/strategies/matrix-evaluation.js';

const evaluation = new MatrixEvaluation({
  id: "model-comparison",
  name: "Model Comparison",
  description: "Compare multiple models on creative writing"
});

const result = await evaluation.run({
  models: [
    { name: "gpt-4", provider: "openrouter" },
    { name: "claude-3", provider: "openrouter" },
    { name: "gemini-pro", provider: "google" }
  ],
  testCases: [{
    id: "creative-writing",
    name: "Creative Writing",
    stimulus: LiteraryAnalysisTemplate,
    input: { prompt: "Write a short story about a robot learning to paint" }
  }]
});
```

**When to use:**
- Model comparison
- Performance benchmarking
- A/B testing

### 3. BatchEvaluation

Process multiple inputs with the same model.

```typescript
import { BatchEvaluation } from '../src/evaluation/strategies/batch-evaluation.js';

const evaluation = new BatchEvaluation({
  id: "batch-processing",
  name: "Batch Processing",
  description: "Process multiple creative writing prompts"
});

const testCases = [
  { id: "story-1", stimulus: CreativeWritingTemplate, input: { prompt: "Write about a time traveler" } },
  { id: "story-2", stimulus: CreativeWritingTemplate, input: { prompt: "Write about a detective" } },
  { id: "story-3", stimulus: CreativeWritingTemplate, input: { prompt: "Write about a scientist" } }
];

const result = await evaluation.run({
  model: { name: "gpt-4", provider: "openrouter" },
  testCases
});
```

**When to use:**
- Bulk processing
- Dataset evaluation
- Batch analysis

### 4. ComplexPipeline

Advanced multi-step evaluations with dependencies.

```typescript
import { ComplexPipeline } from '../src/evaluation/strategies/complex-pipeline.js';

const pipeline = new ComplexPipeline({
  id: "complex-evaluation",
  name: "Complex Evaluation",
  description: "Multi-step creative writing evaluation"
});

const result = await pipeline.run({
  models: [model1, model2, model3],
  steps: [
    {
      id: "brainstorm",
      name: "Brainstorm Ideas",
      strategy: "simple",
      stimulus: BrainstormingTemplate,
      input: { topic: "artificial intelligence" }
    },
    {
      id: "outline",
      name: "Create Outline",
      strategy: "simple",
      stimulus: OutliningTemplate,
      input: { ideas: "step-1-output" },
      dependsOn: ["brainstorm"]
    },
    {
      id: "write",
      name: "Write Story",
      strategy: "simple",
      stimulus: CreativeWritingTemplate,
      input: { outline: "step-2-output" },
      dependsOn: ["outline"]
    }
  ]
});
```

**When to use:**
- Multi-step workflows
- Dependent evaluations
- Complex analysis pipelines

## Designing Test Cases

### 1. Clear Objectives

Define what you want to test:

```typescript
const testCase = {
  id: "creative-writing-test",
  name: "Creative Writing Test",
  stimulus: CreativeWritingTemplate,
  input: {
    prompt: "Write a short story about a robot learning to paint",
    requirements: [
      "Must be exactly 200 words",
      "Should include dialogue",
      "Must have a clear beginning, middle, and end"
    ]
  },
  expectedOutput: {
    length: "200 words",
    structure: "Three-act structure",
    elements: ["dialogue", "character development", "plot"]
  }
};
```

### 2. Appropriate Stimulus

Choose the right stimulus for your task:

```typescript
// For creative writing
import { CreativeWritingTemplate } from '../src/stimulus/templates/creative-templates.js';

// For code generation
import { CodeGenerationTemplate } from '../src/stimulus/templates/coding-templates.js';

// For analysis
import { DocumentAnalysisTemplate } from '../src/stimulus/templates/analysis-templates.js';
```

### 3. Realistic Inputs

Use realistic, representative inputs:

```typescript
const testCases = [
  {
    id: "simple-prompt",
    name: "Simple Prompt",
    stimulus: CreativeWritingTemplate,
    input: { prompt: "Write a story about a cat" }
  },
  {
    id: "complex-prompt",
    name: "Complex Prompt",
    stimulus: CreativeWritingTemplate,
    input: { 
      prompt: "Write a science fiction story about a time traveler who discovers they can only travel to moments of great historical significance, but each trip erases a small piece of their memory",
      constraints: [
        "Must be exactly 500 words",
        "Should explore themes of memory and identity",
        "Must include at least three time periods"
      ]
    }
  }
];
```

## Best Practices

### 1. Start Simple

Begin with basic evaluations and gradually add complexity:

```typescript
// Start with a simple test
const simpleTest = {
  id: "basic-test",
  name: "Basic Test",
  stimulus: SimpleTemplate,
  input: { prompt: "Hello, world!" }
};

// Add complexity gradually
const complexTest = {
  id: "complex-test",
  name: "Complex Test",
  stimulus: ComplexTemplate,
  input: { 
    prompt: "Complex prompt",
    context: "Additional context",
    constraints: ["Constraint 1", "Constraint 2"]
  }
};
```

### 2. Use Templates

Leverage existing templates when possible:

```typescript
// Use pre-defined templates
import { 
  LiteraryAnalysisTemplate,
  PoetryGenerationTemplate,
  CreativeWritingTemplate
} from '../src/stimulus/templates/creative-templates.js';

// Customize templates for specific needs
const customTemplate = new Stimulus({
  ...LiteraryAnalysisTemplate,
  instructions: [
    ...LiteraryAnalysisTemplate.instructions,
    "Focus specifically on character development",
    "Analyze the use of symbolism"
  ]
});
```

### 3. Test Multiple Models

Compare different models to understand their strengths:

```typescript
const models = [
  { name: "gpt-4", provider: "openrouter" },
  { name: "claude-3", provider: "openrouter" },
  { name: "gemini-pro", provider: "google" },
  { name: "llama-3", provider: "ollama" }
];

const evaluation = new MatrixEvaluation({
  id: "model-comparison",
  name: "Model Comparison",
  description: "Compare models on creative writing"
});

const result = await evaluation.run({ models, testCases });
```

### 4. Use Caching

Enable caching to improve performance and reduce costs:

```typescript
const evaluation = new SimpleEvaluation({
  id: "cached-evaluation",
  name: "Cached Evaluation",
  description: "An evaluation with caching enabled",
  
  cache: {
    enabled: true,
    ttl: 3600, // 1 hour
    strategy: 'balanced'
  }
});
```

### 5. Handle Errors Gracefully

Implement proper error handling:

```typescript
try {
  const result = await evaluation.run({ model, testCases });
  console.log("Evaluation completed successfully");
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log("Rate limit exceeded, retrying in 60 seconds...");
    await new Promise(resolve => setTimeout(resolve, 60000));
    // Retry logic
  } else if (error instanceof AuthenticationError) {
    console.error("Authentication failed:", error.message);
  } else {
    console.error("Unexpected error:", error);
  }
}
```

## Advanced Patterns

### 1. Custom Scoring

Implement custom scoring logic:

```typescript
const evaluation = new SimpleEvaluation({
  id: "scored-evaluation",
  name: "Scored Evaluation",
  description: "An evaluation with custom scoring",
  
  scoring: {
    enabled: true,
    strategy: 'custom',
    scorer: async (response, expected) => {
      // Custom scoring logic
      const score = calculateCustomScore(response, expected);
      return { score, details: "Custom scoring details" };
    }
  }
});
```

### 2. Conditional Evaluation

Run different tests based on conditions:

```typescript
const evaluation = new SimpleEvaluation({
  id: "conditional-evaluation",
  name: "Conditional Evaluation",
  description: "An evaluation with conditional logic",
  
  conditions: {
    modelCapability: 'image-analysis',
    minTokens: 1000,
    maxCost: 0.01
  }
});
```

### 3. Parallel Processing

Run multiple evaluations in parallel:

```typescript
const evaluations = [
  new SimpleEvaluation({ id: "eval-1", name: "Evaluation 1" }),
  new SimpleEvaluation({ id: "eval-2", name: "Evaluation 2" }),
  new SimpleEvaluation({ id: "eval-3", name: "Evaluation 3" })
];

const results = await Promise.all(
  evaluations.map(eval => eval.run({ model, testCases }))
);
```

## Monitoring and Debugging

### 1. Enable Debug Logging

```typescript
const evaluation = new SimpleEvaluation({
  id: "debug-evaluation",
  name: "Debug Evaluation",
  description: "An evaluation with debug logging",
  
  debug: true,
  logLevel: 'verbose'
});
```

### 2. Monitor Performance

```typescript
const result = await evaluation.run({ model, testCases });

console.log("Performance Metrics:");
console.log("- Total time:", result.metrics?.totalTime);
console.log("- Tokens used:", result.metrics?.totalTokens);
console.log("- Cost:", result.metrics?.totalCost);
console.log("- Cache hits:", result.metrics?.cacheHits);
```

### 3. Validate Results

```typescript
const result = await evaluation.run({ model, testCases });

// Validate response format
if (!result.responses[0]?.content) {
  throw new Error("No response content received");
}

// Validate response length
if (result.responses[0].content.length < 100) {
  console.warn("Response seems too short");
}

// Validate response quality
const qualityScore = await assessResponseQuality(result.responses[0]);
if (qualityScore < 0.7) {
  console.warn("Response quality may be low");
}
```

## Examples

See the `scripts/examples/` directory for complete examples of different evaluation patterns.

## Related Documentation

- [Writing Scripts](writing-scripts.md)
- [Stimulus Templates](stimulus-templates.md)
- [Tool Integration](tool-integration.md)
- [Best Practices](best-practices.md)
