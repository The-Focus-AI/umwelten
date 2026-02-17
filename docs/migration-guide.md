# Migration Guide: Stimulus-Centric Evaluation Architecture

## Overview

This guide helps you migrate from the existing evaluation patterns to the new Stimulus-centric architecture. The new architecture makes **Stimulus** the primary unit of cognitive testing, with everything else being lightweight, composable infrastructure around it.

## Migration Benefits

### Before (Current Patterns)
- **3 Different Patterns**: Single Function, EvaluationRunner, Multi-Matrix
- **Inconsistent Interfaces**: Each pattern has different APIs
- **Limited Reusability**: Hard to reuse components across evaluations
- **Complex Boilerplate**: Lots of repetitive code
- **Manual Caching**: Inconsistent caching implementations

### After (New Architecture)
- **Single Pattern**: Stimulus + Evaluation Strategy
- **Consistent Interface**: All evaluations use the same pattern
- **High Reusability**: Stimuli and strategies are composable
- **Minimal Boilerplate**: Simple, clean code
- **Automatic Caching**: Built-in comprehensive caching

## Migration Patterns

### 1. Single Function Pattern → SimpleEvaluation

#### Before
```typescript
// scripts/cat-poem.ts
import { Interaction } from "../src/interaction/core/interaction.js";
import { Stimulus } from "../src/stimulus/stimulus.js";

const poemStimulus = new Stimulus({
  role: "literary genius",
  objective: "write short poems about cats",
  temperature: 0.5,
  maxTokens: 200,
  runnerType: 'base'
});

export async function catPoem(model: ModelDetails): Promise<ModelResponse> {
  const interaction = new Interaction(model, poemStimulus);
  interaction.addMessage({ role: 'user', content: 'Write a short poem about a cat' });
  return await interaction.execute();
}

// Usage
const models = [
  { name: "gemma3:27b", provider: "ollama" },
  { name: "gemini-3-flash-preview", provider: "google" }
];

for (const model of models) {
  const response = await catPoem(model);
  console.log(`${model.name}: ${response.content}`);
}
```

#### After
```typescript
// scripts/evaluate-cat-poem.ts
import { CatPoemStimulus } from '../src/stimulus/creative/cat-poem.js';
import { SimpleEvaluation } from '../src/evaluation/strategies/simple-evaluation.js';
import { EvaluationCache } from '../src/evaluation/caching/cache-service.js';

const models = [
  { name: "gemma3:27b", provider: "ollama" },
  { name: "gemini-3-flash-preview", provider: "google" }
];

const cache = new EvaluationCache('cat-poem-evaluation');
const evaluation = new SimpleEvaluation(
  CatPoemStimulus,
  models,
  "Write a short poem about a cat",
  cache
);

const results = await evaluation.run();
results.forEach(result => {
  console.log(`${result.model.name}: ${result.response.content}`);
});
```

### 2. EvaluationRunner Pattern → CodeGenerationEvaluation

#### Before
```typescript
// scripts/google-pricing.ts
import { EvaluationRunner } from "../src/evaluation/runner.js";

class GooglePricing extends EvaluationRunner {
  async getModelResponse(details: ModelDetails): Promise<ModelResponse> {
    const html = await this.getCachedFile("html", async () => {
      return await fetch("https://ai.google.dev/pricing").then(r => r.text());
    });
    
    const interaction = new Interaction(details, new Stimulus({
      role: "web scraping expert",
      objective: "extract pricing information from HTML"
    }));
    
    interaction.addMessage({ 
      role: 'user', 
      content: `Extract Google AI pricing from this HTML:\n\n${html}` 
    });
    
    return await interaction.execute();
  }
}

// Usage
const runner = new GooglePricing("google-pricing");
await runner.evaluate({ name: 'gpt-4o-mini', provider: 'openrouter' });
```

#### After
```typescript
// scripts/evaluate-google-pricing.ts
import { GooglePricingStimulus } from '../src/stimulus/analysis/google-pricing.js';
import { WebScrapingEvaluation } from '../src/evaluation/strategies/web-scraping-evaluation.js';
import { EvaluationCache } from '../src/evaluation/caching/cache-service.js';

const models = [
  { name: 'gpt-4o-mini', provider: 'openrouter' },
  { name: 'gemini-3-flash-preview', provider: 'google' }
];

const cache = new EvaluationCache('google-pricing-evaluation');
const evaluation = new WebScrapingEvaluation(
  GooglePricingStimulus,
  models,
  "https://ai.google.dev/pricing",
  cache
);

const results = await evaluation.run();
```

### 3. Multi-Matrix Pattern → MatrixEvaluation + CodeGenerationEvaluation

#### Before
```typescript
// scripts/ollama-typescript-evaluation.ts
const OLLAMA_MODELS = [
  { name: 'gpt-oss:20b', provider: 'ollama' },
  { name: 'gemma3:12b', provider: 'ollama' },
  // ... more models
];

// PASS 1: Generate responses
for (const model of OLLAMA_MODELS) {
  const runner = new FunctionEvaluationRunner("ollama-typescript-eval", "responses", async (details) => {
    const interaction = new Interaction(details, new Stimulus({
      role: "TypeScript expert",
      objective: "write TypeScript code"
    }));
    interaction.addMessage({ role: 'user', content: PROMPT });
    return await interaction.execute();
  });
  
  await runner.evaluate({ name: model.name, provider: 'ollama' });
}

// PASS 2: Extract code
// ... complex code extraction logic

// PASS 3: Docker execution
// ... Docker testing logic

// PASS 4: AI scoring
// ... AI evaluation logic
```

#### After
```typescript
// scripts/evaluate-typescript-code.ts
import { TypeScriptStimulus } from '../src/stimulus/coding/typescript.js';
import { CodeGenerationEvaluation } from '../src/evaluation/strategies/code-generation-evaluation.js';
import { EvaluationCache } from '../src/evaluation/caching/cache-service.js';

const models = [
  { name: 'gpt-oss:20b', provider: 'ollama' },
  { name: 'gemma3:12b', provider: 'ollama' },
  // ... more models
];

const cache = new EvaluationCache('typescript-evaluation');
const evaluation = new CodeGenerationEvaluation(
  TypeScriptStimulus,
  models,
  "Write a TypeScript function that generates 1042 unique show names",
  cache,
  {
    extractCode: true,
    runDocker: true,
    aiScoring: true
  }
);

const results = await evaluation.run();
```

## Step-by-Step Migration Process

### Step 1: Identify Current Pattern

1. **Single Function Pattern**: Simple function that takes ModelDetails and returns ModelResponse
2. **EvaluationRunner Pattern**: Extends EvaluationRunner with custom getModelResponse
3. **Multi-Matrix Pattern**: Complex pipeline with multiple passes and Docker execution

### Step 2: Create Stimulus Definition

Extract the cognitive task into a reusable Stimulus:

```typescript
// src/stimulus/{category}/{task-name}.ts
export const TaskStimulus = new Stimulus({
  id: 'task-name',
  name: 'Task Name',
  description: 'Description of what this tests',
  
  role: "appropriate role",
  objective: "what to accomplish",
  instructions: [
    "specific instructions",
    "step by step guidance"
  ],
  output: [
    "expected output format",
    "requirements"
  ],
  examples: [
    "example input/output"
  ],
  temperature: 0.5,
  maxTokens: 1000,
  runnerType: 'base'
});
```

### Step 3: Choose Evaluation Strategy

- **SimpleEvaluation**: Basic text generation tasks
- **CodeGenerationEvaluation**: Code generation with Docker execution
- **WebScrapingEvaluation**: External data processing
- **MatrixEvaluation**: Multi-dimensional evaluation
- **BatchEvaluation**: Processing multiple inputs

### Step 4: Create Evaluation Script

```typescript
// scripts/evaluate-{task-name}.ts
import { TaskStimulus } from '../src/stimulus/{category}/{task-name}.js';
import { AppropriateEvaluation } from '../src/evaluation/strategies/{strategy}.js';
import { EvaluationCache } from '../src/evaluation/caching/cache-service.js';

const models = [/* your models */];
const cache = new EvaluationCache('task-evaluation');
const evaluation = new AppropriateEvaluation(
  TaskStimulus,
  models,
  "Your prompt here",
  cache
);

const results = await evaluation.run();
```

### Step 5: Test and Validate

1. **Run the new evaluation script**
2. **Compare results with old implementation**
3. **Verify caching works correctly**
4. **Check error handling**
5. **Validate performance**

## Migration Checklist

### For Each Script

- [ ] **Identify Pattern**: Determine which of the 3 patterns the script uses
- [ ] **Extract Stimulus**: Create a reusable Stimulus definition
- [ ] **Choose Strategy**: Select appropriate evaluation strategy
- [ ] **Create Script**: Write new evaluation script
- [ ] **Test Functionality**: Ensure it produces same results
- [ ] **Test Caching**: Verify caching works correctly
- [ ] **Test Error Handling**: Ensure errors are handled properly
- [ ] **Update Documentation**: Update any related docs
- [ ] **Remove Old Script**: Delete the old implementation

### For Stimulus Definitions

- [ ] **Clear Purpose**: Stimulus has a single, clear purpose
- [ ] **Good Instructions**: Detailed, unambiguous instructions
- [ ] **Appropriate Examples**: Relevant examples included
- [ ] **Realistic Constraints**: Appropriate temperature and token limits
- [ ] **Proper Categorization**: Placed in correct category directory

### For Evaluation Scripts

- [ ] **Uses New Architecture**: Implements Stimulus + Strategy pattern
- [ ] **Proper Caching**: Uses EvaluationCache for all data
- [ ] **Error Handling**: Handles errors gracefully
- [ ] **Progress Tracking**: Implements progress callbacks
- [ ] **Configuration**: Uses appropriate configuration options
- [ ] **Documentation**: Well-documented and commented

## Common Migration Issues

### Issue 1: Stimulus Too Complex
**Problem**: Trying to put too much into one Stimulus
**Solution**: Break down into multiple, focused Stimuli

```typescript
// Bad: Too complex
const ComplexStimulus = new Stimulus({
  // ... 20 different instructions for different tasks
});

// Good: Focused stimuli
const CodeGenerationStimulus = new Stimulus({
  // ... focused on code generation
});

const TestingStimulus = new Stimulus({
  // ... focused on testing
});
```

### Issue 2: Missing Caching
**Problem**: Not using the new caching system
**Solution**: Always use EvaluationCache

```typescript
// Bad: Manual caching
const html = await fetch(url).then(r => r.text());
fs.writeFileSync('cached.html', html);

// Good: Use EvaluationCache
const html = await cache.getCachedExternalData('html', url, async () => {
  return await fetch(url).then(r => r.text());
});
```

### Issue 3: Wrong Strategy Choice
**Problem**: Using SimpleEvaluation for complex tasks
**Solution**: Choose appropriate strategy

```typescript
// Bad: Using SimpleEvaluation for code generation
const evaluation = new SimpleEvaluation(stimulus, models, prompt, cache);

// Good: Use CodeGenerationEvaluation
const evaluation = new CodeGenerationEvaluation(stimulus, models, prompt, cache);
```

### Issue 4: Not Handling Errors
**Problem**: Not handling model errors gracefully
**Solution**: Always handle errors in evaluation results

```typescript
// Bad: Letting errors crash the evaluation
const results = await evaluation.run();
results.forEach(r => console.log(r.response.content));

// Good: Handle errors gracefully
const results = await evaluation.run();
results.forEach(r => {
  if (r.metadata.error) {
    console.error(`${r.model.name}: ${r.metadata.error}`);
  } else {
    console.log(`${r.model.name}: ${r.response.content}`);
  }
});
```

## Performance Considerations

### Caching Benefits
- **Cost Savings**: Avoid duplicate API calls
- **Faster Iterations**: Skip already-evaluated models
- **Resume Capability**: Continue interrupted evaluations

### Concurrent Execution
- **Faster Evaluation**: Run multiple models simultaneously
- **Resource Management**: Use appropriate concurrency limits
- **Progress Tracking**: Monitor concurrent evaluations

### Memory Usage
- **Batch Processing**: Process models in batches for large evaluations
- **Cache Cleanup**: Regularly clean up old cache files
- **Resource Monitoring**: Monitor memory usage during evaluation

## Testing Migration

### Unit Tests
```typescript
// Test stimulus definition
describe('TaskStimulus', () => {
  it('should have correct properties', () => {
    expect(TaskStimulus.options.id).toBe('task-name');
    expect(TaskStimulus.options.role).toBe('appropriate role');
  });
});

// Test evaluation strategy
describe('TaskEvaluation', () => {
  it('should run evaluation successfully', async () => {
    const results = await evaluation.run();
    expect(results).toHaveLength(models.length);
    expect(results[0]).toHaveProperty('model');
    expect(results[0]).toHaveProperty('response');
    expect(results[0]).toHaveProperty('metadata');
  });
});
```

### Integration Tests
```typescript
// Test full evaluation pipeline
describe('Task Evaluation Pipeline', () => {
  it('should complete end-to-end evaluation', async () => {
    const results = await evaluation.run();
    
    // Check all models were evaluated
    expect(results).toHaveLength(models.length);
    
    // Check successful evaluations
    const successful = results.filter(r => !r.metadata.error);
    expect(successful.length).toBeGreaterThan(0);
    
    // Check caching worked
    const stats = cache.getStats();
    expect(stats.hitRate).toBeGreaterThan(0);
  });
});
```

## Rollback Plan

If migration issues occur:

1. **Keep Old Scripts**: Don't delete old scripts until migration is verified
2. **Gradual Migration**: Migrate one script at a time
3. **A/B Testing**: Run both old and new versions in parallel
4. **Performance Monitoring**: Monitor performance and error rates
5. **Quick Rollback**: Have a plan to quickly revert if needed

## Support and Resources

### Documentation
- **Architecture Guide**: `docs/evaluation-architecture.md`
- **API Reference**: `docs/api/`
- **Examples**: `scripts/` directory

### Testing
- **Unit Tests**: `src/**/*.test.ts`
- **Integration Tests**: `tests/integration/`
- **Example Scripts**: `scripts/evaluate-*.ts`

### Getting Help
- **Check Tests**: Look at existing tests for examples
- **Review Examples**: Study the example scripts
- **Ask Questions**: Reach out to the team for help

## Conclusion

The new Stimulus-centric architecture provides a cleaner, more maintainable approach to model evaluation. While migration requires some effort, the benefits in terms of code reusability, consistency, and maintainability make it worthwhile.

Start with simple migrations (Single Function Pattern) and gradually work up to more complex ones. The new architecture will make future evaluations much easier to create and maintain.
