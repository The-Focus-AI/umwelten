# Matrix Evaluation Example

This example demonstrates how to compare multiple models on the same test cases using the MatrixEvaluation strategy.

## Running the Example

```bash
pnpm tsx scripts/examples/matrix-evaluation-example.ts
```

## What This Example Shows

- **Model Comparison**: Side-by-side comparison of multiple models
- **MatrixEvaluation Strategy**: Built-in support for multi-model testing
- **Performance Benchmarking**: Compare response times, costs, and quality
- **Stimulus Templates**: Using templates across different models

## Code Walkthrough

### 1. Import Dependencies

```typescript
import { MatrixEvaluation } from '../../src/evaluation/strategies/matrix-evaluation.js';
import { CodeGenerationTemplate } from '../../src/stimulus/templates/coding-templates.js';
import { getAvailableModels } from '../../src/providers/index.js';
```

### 2. Create Matrix Evaluation

```typescript
const evaluation = new MatrixEvaluation({
  id: "code-generation-comparison",
  name: "Code Generation Comparison",
  description: "Compare multiple models on code generation tasks"
});
```

### 3. Define Test Cases

```typescript
const testCases = [
  {
    id: "fibonacci-function",
    name: "Fibonacci Function",
    stimulus: CodeGenerationTemplate,
    input: {
      prompt: "Write a Python function to calculate fibonacci numbers",
      requirements: [
        "Use memoization for efficiency",
        "Include proper error handling",
        "Add comprehensive docstring"
      ]
    }
  },
  {
    id: "sorting-algorithm",
    name: "Sorting Algorithm",
    stimulus: CodeGenerationTemplate,
    input: {
      prompt: "Implement quicksort algorithm in Python",
      requirements: [
        "Include both recursive and iterative versions",
        "Add time complexity analysis",
        "Include usage examples"
      ]
    }
  }
];
```

### 4. Select Models for Comparison

```typescript
const allModels = await getAvailableModels();
const models = allModels
  .filter(model => 
    ['gpt-4', 'claude-3', 'gemini-pro', 'llama-3'].includes(model.name)
  )
  .slice(0, 3); // Limit to 3 models for demo
```

### 5. Run Matrix Evaluation

```typescript
const result = await evaluation.run({
  models,
  testCases
});
```

### 6. Display Comparison Results

```typescript
console.log(`\n📊 Matrix Evaluation Results:`);
console.log(`- Models tested: ${models.length}`);
console.log(`- Test cases: ${testCases.length}`);
console.log(`- Total responses: ${result.responses.length}`);
console.log(`- Total cost: $${result.metrics.totalCost.toFixed(6)}`);

// Display results by model
for (const model of models) {
  const modelResponses = result.responses.filter(r => r.metadata.model === model.name);
  console.log(`\n🤖 ${model.name} (${model.provider}):`);
  console.log(`  - Responses: ${modelResponses.length}`);
  console.log(`  - Avg tokens: ${Math.round(modelResponses.reduce((sum, r) => sum + (r.metadata.tokenUsage?.total || 0), 0) / modelResponses.length)}`);
  console.log(`  - Avg time: ${Math.round(modelResponses.reduce((sum, r) => sum + (r.metadata.endTime - r.metadata.startTime), 0) / modelResponses.length)}ms`);
}
```

## Key Features Demonstrated

### Model Comparison
The MatrixEvaluation strategy automatically:
- Runs all test cases on all models
- Tracks performance metrics per model
- Provides aggregated statistics
- Handles errors gracefully

### Performance Benchmarking
Compare models across multiple dimensions:
- **Response Time**: How fast each model responds
- **Token Usage**: Efficiency in token consumption
- **Cost**: Total cost per model
- **Quality**: Response quality (requires manual assessment)

### Parallel Execution
Models are tested in parallel for efficiency:
```typescript
const evaluation = new MatrixEvaluation({
  // ... other options
  parallel: {
    enabled: true,
    maxConcurrency: 3 // Test up to 3 models simultaneously
  }
});
```

## Advanced Usage

### Custom Model Selection

```typescript
// Select models by specific criteria
const models = allModels
  .filter(model => 
    model.provider === 'openrouter' && 
    model.costs.completionTokens < 0.0001
  )
  .sort((a, b) => a.costs.completionTokens - b.costs.completionTokens)
  .slice(0, 5);
```

### Filtering Results

```typescript
// Get results for a specific model
const gpt4Results = result.responses.filter(r => r.metadata.model === 'gpt-4');

// Get results for a specific test case
const fibonacciResults = result.responses.filter(r => r.metadata.testCaseId === 'fibonacci-function');

// Get results by provider
const openrouterResults = result.responses.filter(r => r.metadata.provider === 'openrouter');
```

### Cost Analysis

```typescript
// Calculate cost per model
const costByModel = models.reduce((acc, model) => {
  const modelResponses = result.responses.filter(r => r.metadata.model === model.name);
  const totalCost = modelResponses.reduce((sum, r) => sum + (r.metadata.cost?.totalCost || 0), 0);
  acc[model.name] = totalCost;
  return acc;
}, {});

console.log('💰 Cost by Model:');
Object.entries(costByModel).forEach(([model, cost]) => {
  console.log(`  ${model}: $${cost.toFixed(6)}`);
});
```

### Quality Comparison

```typescript
// Simple quality metrics (you can implement more sophisticated analysis)
const qualityByModel = models.reduce((acc, model) => {
  const modelResponses = result.responses.filter(r => r.metadata.model === model.name);
  const avgLength = modelResponses.reduce((sum, r) => sum + r.content.length, 0) / modelResponses.length;
  const avgTokens = modelResponses.reduce((sum, r) => sum + (r.metadata.tokenUsage?.total || 0), 0) / modelResponses.length;
  
  acc[model.name] = {
    avgLength,
    avgTokens,
    efficiency: avgLength / avgTokens // characters per token
  };
  return acc;
}, {});

console.log('📈 Quality Metrics:');
Object.entries(qualityByModel).forEach(([model, metrics]) => {
  console.log(`  ${model}:`);
  console.log(`    Avg Length: ${metrics.avgLength.toFixed(0)} chars`);
  console.log(`    Avg Tokens: ${metrics.avgTokens.toFixed(0)}`);
  console.log(`    Efficiency: ${metrics.efficiency.toFixed(2)} chars/token`);
});
```

## Expected Output

```
🔄 Matrix Evaluation Example: Code Generation Comparison
========================================================
📚 Using 3 models: gpt-4, claude-3, gemini-pro
🧪 Test cases: 2

📊 Matrix Evaluation Results:
- Models tested: 3
- Test cases: 2
- Total responses: 6
- Total cost: $0.003450

🤖 gpt-4 (openrouter):
  - Responses: 2
  - Avg tokens: 450
  - Avg time: 2100ms

🤖 claude-3 (openrouter):
  - Responses: 2
  - Avg tokens: 520
  - Avg time: 1800ms

🤖 gemini-pro (google):
  - Responses: 2
  - Avg tokens: 380
  - Avg time: 1500ms

💰 Cost by Model:
  gpt-4: $0.001200
  claude-3: $0.001300
  gemini-pro: $0.000950

📈 Quality Metrics:
  gpt-4:
    Avg Length: 1200 chars
    Avg Tokens: 450
    Efficiency: 2.67 chars/token
  claude-3:
    Avg Length: 1350 chars
    Avg Tokens: 520
    Efficiency: 2.60 chars/token
  gemini-pro:
    Avg Length: 1100 chars
    Avg Tokens: 380
    Efficiency: 2.89 chars/token

✅ Matrix evaluation completed successfully!
```

## Use Cases

### Model Selection
Use matrix evaluation to:
- Compare new models against existing ones
- Find the best model for specific tasks
- Evaluate cost vs. quality trade-offs
- Test model performance across different providers

### Performance Benchmarking
- Measure response times across models
- Compare token efficiency
- Analyze cost effectiveness
- Track performance over time

### A/B Testing
- Test different model configurations
- Compare prompt engineering approaches
- Evaluate different temperature settings
- Test model updates and improvements

## Next Steps

- Try the [Batch Evaluation Example](/examples/batch-evaluation) for processing multiple inputs
- Explore the [Complex Pipeline Example](/examples/complex-pipeline) for advanced workflows
- Check out the [Comprehensive Analysis Example](/examples/comprehensive-analysis) for detailed performance analysis
