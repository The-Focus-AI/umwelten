# Evaluation Framework

## Overview

The evaluation framework provides a comprehensive set of strategies for testing AI models. It's designed to be composable, reusable, and extensible, allowing you to build complex evaluations from simple building blocks.

## Core Concepts

### Evaluation Strategy
An evaluation strategy defines how to run a specific type of evaluation. Strategies handle:
- Model execution
- Input processing
- Result collection
- Error handling
- Caching

### Test Case
A test case defines a specific test to run:
- **Stimulus**: The cognitive task to perform
- **Input**: The input data for the test
- **Expected Output**: Optional expected results
- **Metadata**: Additional test information

### Evaluation Result
The result of running an evaluation:
- **Responses**: Model responses for each test case
- **Metrics**: Performance metrics (time, tokens, cost)
- **Scores**: Evaluation scores (if applicable)
- **Metadata**: Additional result information

## Available Strategies

### 1. SimpleEvaluation

The most basic evaluation strategy for single-model testing.

```typescript
import { SimpleEvaluation } from '../src/evaluation/strategies/simple-evaluation.js';

const evaluation = new SimpleEvaluation({
  id: "my-evaluation",
  name: "My Evaluation",
  description: "A simple evaluation example"
});

const result = await evaluation.run({
  model: {
    name: "gpt-4",
    provider: "openrouter",
    // ... other model details
  },
  testCases: [{
    id: "test-1",
    name: "Test 1",
    stimulus: myStimulus,
    input: { prompt: "Hello, world!" }
  }]
});
```

**Use Cases:**
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
  description: "Compare multiple models"
});

const result = await evaluation.run({
  models: [
    { name: "gpt-4", provider: "openrouter" },
    { name: "claude-3", provider: "openrouter" },
    { name: "gemini-pro", provider: "google" }
  ],
  testCases: [{
    id: "test-1",
    name: "Test 1",
    stimulus: myStimulus,
    input: { prompt: "Hello, world!" }
  }]
});
```

**Use Cases:**
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
  description: "Process multiple inputs"
});

const result = await evaluation.run({
  model: {
    name: "gpt-4",
    provider: "openrouter"
  },
  testCases: [
    { id: "test-1", stimulus: myStimulus, input: { prompt: "Input 1" } },
    { id: "test-2", stimulus: myStimulus, input: { prompt: "Input 2" } },
    { id: "test-3", stimulus: myStimulus, input: { prompt: "Input 3" } }
  ]
});
```

**Use Cases:**
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
  description: "Multi-step evaluation with dependencies"
});

const result = await pipeline.run({
  models: [model1, model2, model3],
  steps: [
    {
      id: "step-1",
      name: "Initial Analysis",
      strategy: "simple",
      stimulus: analysisStimulus,
      input: { data: "input data" }
    },
    {
      id: "step-2",
      name: "Refinement",
      strategy: "simple",
      stimulus: refinementStimulus,
      input: { data: "step-1-output" },
      dependsOn: ["step-1"]
    },
    {
      id: "step-3",
      name: "Final Review",
      strategy: "simple",
      stimulus: reviewStimulus,
      input: { data: "step-2-output" },
      dependsOn: ["step-2"]
    }
  ]
});
```

**Use Cases:**
- Multi-step workflows
- Dependent evaluations
- Complex analysis pipelines

### 5. ComprehensiveAnalyzer

Advanced analysis combining performance and quality metrics.

```typescript
import { ComprehensiveAnalyzer } from '../src/evaluation/analysis/comprehensive-analyzer.js';

const analyzer = new ComprehensiveAnalyzer();

const analysis = await analyzer.analyze({
  evaluations: [result1, result2, result3],
  models: [model1, model2, model3],
  testCases: [testCase1, testCase2, testCase3]
});

console.log('Performance Analysis:', analysis.performance);
console.log('Quality Analysis:', analysis.quality);
console.log('Recommendations:', analysis.recommendations);
```

**Use Cases:**
- Performance analysis and optimization
- Quality assessment across multiple dimensions
- Model comparison and benchmarking
- Cost analysis and efficiency metrics
- Actionable insights and recommendations

## Caching System

The evaluation framework includes comprehensive caching to improve performance and reduce costs.

### Model Response Caching
- Cache model responses to avoid re-running expensive calls
- Automatic cache invalidation based on model parameters
- Configurable cache TTL and storage options

### File Caching
- Cache processed files and metadata
- Automatic file change detection
- Support for large file processing

### Score Caching
- Cache evaluation scores and results
- Avoid re-computing expensive scoring functions
- Support for different scoring strategies

## Error Handling

The framework provides robust error handling:

### Retry Logic
- Automatic retries for transient failures
- Exponential backoff for rate limits
- Configurable retry policies

### Error Classification
- **Transient Errors**: Network issues, rate limits
- **Permanent Errors**: Authentication failures, invalid inputs
- **Model Errors**: Model-specific issues

### Graceful Degradation
- Continue evaluation even if some tests fail
- Detailed error reporting
- Partial results when possible

## Performance Optimization

### Parallel Processing
- Run multiple evaluations in parallel
- Configurable concurrency limits
- Resource management

### Memory Management
- Efficient data structures
- Garbage collection optimization
- Memory monitoring

### Cost Optimization
- Caching to reduce redundant calls
- Cost tracking and monitoring
- Budget limits and alerts

## Best Practices

### 1. Choose the Right Strategy
- Use `SimpleEvaluation` for basic testing
- Use `MatrixEvaluation` for model comparison
- Use `BatchEvaluation` for bulk processing
- Use `ComplexPipeline` for advanced workflows
- Use `ComprehensiveAnalyzer` for detailed analysis and optimization

### 2. Design Effective Test Cases
- Clear, specific prompts
- Appropriate input data
- Realistic expectations
- Good test coverage

### 3. Use Caching Effectively
- Enable caching for expensive operations
- Set appropriate TTL values
- Monitor cache hit rates
- Clean up old cache entries

### 4. Handle Errors Gracefully
- Implement proper error handling
- Use retry logic for transient errors
- Provide meaningful error messages
- Log errors for debugging

### 5. Monitor Performance
- Track evaluation metrics
- Monitor costs and usage
- Optimize based on results
- Set up alerts for issues

## Examples

See the `scripts/examples/` directory for complete examples of each evaluation strategy.

## API Reference

For detailed API documentation, see the [API Reference](../api/evaluation-strategies.md).
