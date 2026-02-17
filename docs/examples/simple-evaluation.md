# Simple Evaluation Example

This example demonstrates how to use the new infrastructure for basic evaluations using stimulus templates and evaluation strategies.

## Running the Example

```bash
pnpm tsx scripts/examples/simple-evaluation-example.ts
```

## What This Example Shows

- **Stimulus Templates**: Using pre-defined templates for common tasks
- **SimpleEvaluation Strategy**: Basic single-model evaluation
- **Model Discovery**: Automatically finding available models
- **Result Analysis**: Basic performance metrics and cost tracking

## Code Walkthrough

### 1. Import Dependencies

```typescript
import { SimpleEvaluation } from '../../src/evaluation/strategies/simple-evaluation.js';
import { LiteraryAnalysisTemplate } from '../../src/stimulus/templates/creative-templates.js';
import { getAvailableModels } from '../../src/providers/index.js';
```

### 2. Create Evaluation

```typescript
const evaluation = new SimpleEvaluation({
  id: "literary-analysis-demo",
  name: "Literary Analysis Demo",
  description: "Demonstrates literary analysis using stimulus templates"
});
```

### 3. Define Test Case

```typescript
const testCase = {
  id: "frankenstein-analysis",
  name: "Frankenstein Analysis",
  stimulus: LiteraryAnalysisTemplate,
  input: {
    prompt: "Analyze the themes in Mary Shelley's Frankenstein",
    requirements: [
      "Focus on the theme of creation and responsibility",
      "Discuss the relationship between creator and creation",
      "Consider the moral implications of scientific advancement"
    ]
  }
};
```

### 4. Run Evaluation

```typescript
const result = await evaluation.run({
  model: selectedModel,
  testCases: [testCase]
});
```

### 5. Display Results

```typescript
console.log(`\n📊 Evaluation Results:`);
console.log(`- Model: ${result.responses[0].metadata.model}`);
console.log(`- Tokens: ${result.metrics.totalTokens}`);
console.log(`- Cost: $${result.metrics.totalCost.toFixed(6)}`);
console.log(`- Time: ${result.metrics.totalTime}ms`);
console.log(`\n📝 Response:`);
console.log(result.responses[0].content);
```

## Key Features Demonstrated

### Stimulus Templates
The example uses `LiteraryAnalysisTemplate` which provides:
- Pre-configured role and objective
- Structured instructions for literary analysis
- Appropriate temperature and token settings
- Consistent output format

### Model Discovery
```typescript
const allModels = await getAvailableModels();
const models = allModels
  .filter(model => ['gpt-4', 'gpt-3.5-turbo', 'gemini-3-flash-preview'].includes(model.name))
  .slice(0, 2);
```

### Performance Metrics
The evaluation automatically tracks:
- Response time
- Token usage
- Cost calculation
- Cache hits (if enabled)

## Customization Options

### Using Different Stimulus Templates

```typescript
import { 
  CreativeWritingTemplate,
  PoetryGenerationTemplate,
  CodeGenerationTemplate
} from '../../src/stimulus/templates/creative-templates.js';

// For creative writing
const creativeTest = {
  id: "creative-writing",
  name: "Creative Writing",
  stimulus: CreativeWritingTemplate,
  input: { prompt: "Write a short story about a robot learning to paint" }
};

// For poetry generation
const poetryTest = {
  id: "poetry-generation",
  name: "Poetry Generation", 
  stimulus: PoetryGenerationTemplate,
  input: { prompt: "Write a haiku about the ocean" }
};
```

### Custom Stimulus

```typescript
import { Stimulus } from '../../src/stimulus/stimulus.js';

const customStimulus = new Stimulus({
  id: 'custom-analysis',
  name: 'Custom Analysis',
  description: 'A custom stimulus for specific needs',
  
  role: 'expert analyst',
  objective: 'analyze data and provide insights',
  instructions: [
    'Examine the data carefully',
    'Identify key patterns and trends',
    'Provide actionable recommendations'
  ],
  output: [
    'Structured analysis report',
    'Key findings and insights',
    'Recommendations for next steps'
  ],
  
  temperature: 0.7,
  maxTokens: 1500,
  runnerType: 'base'
});
```

### Multiple Test Cases

```typescript
const testCases = [
  {
    id: "analysis-1",
    name: "Theme Analysis",
    stimulus: LiteraryAnalysisTemplate,
    input: { prompt: "Analyze the themes in 'To Kill a Mockingbird'" }
  },
  {
    id: "analysis-2", 
    name: "Character Analysis",
    stimulus: LiteraryAnalysisTemplate,
    input: { prompt: "Analyze the character development of Scout Finch" }
  },
  {
    id: "analysis-3",
    name: "Symbolism Analysis", 
    stimulus: LiteraryAnalysisTemplate,
    input: { prompt: "Analyze the symbolism in 'The Great Gatsby'" }
  }
];

const result = await evaluation.run({
  model: selectedModel,
  testCases
});
```

## Expected Output

```
🎭 Simple Evaluation Example: Literary Analysis
==================================================
📚 Using 2 models: gpt-4, gemini-3-flash-preview
🤖 Selected model: gpt-4 (openrouter)

📊 Evaluation Results:
- Model: gpt-4
- Tokens: 1250
- Cost: $0.001250
- Time: 2340ms

📝 Response:
The themes in Mary Shelley's Frankenstein are deeply rooted in the Romantic era's concerns about scientific advancement and human nature. The central theme of creation and responsibility explores Victor Frankenstein's failure to take responsibility for his creation, leading to tragic consequences...

✅ Simple evaluation completed successfully!
```

## Next Steps

- Try the [Matrix Evaluation Example](/examples/matrix-evaluation) to compare multiple models
- Explore the [Batch Evaluation Example](/examples/batch-evaluation) for processing multiple inputs
- Check out the [Complex Pipeline Example](/examples/complex-pipeline) for advanced workflows
