# Quick Reference Guide: Stimulus-Centric Evaluation Architecture

## Core Concepts

### Stimulus
A **Stimulus** represents a specific cognitive task or capability to test. It's pure and focused on what we're testing, not how we're testing it.

```typescript
export const CatPoemStimulus = new Stimulus({
  id: 'cat-poem',
  name: 'Cat Poem Generation',
  description: 'Test models\' ability to write creative poetry about cats',
  
  role: "literary genius",
  objective: "write short poems about cats",
  temperature: 0.5,
  maxTokens: 200,
  runnerType: 'base'
});
```

### Evaluation Strategy
An **Evaluation Strategy** defines how to test a stimulus. It handles the testing approach, caching, and result processing.

```typescript
const evaluation = new SimpleEvaluation(
  CatPoemStimulus,
  models,
  "Write a short poem about a cat",
  cache
);
```

### Evaluation Cache
The **Evaluation Cache** provides automatic caching for model responses, external data, and intermediate results.

```typescript
const cache = new EvaluationCache('cat-poem');
const response = await cache.getCachedModelResponse(model, stimulusId, fetchFunction);
```

## Directory Structure

```
src/
├── stimuli/                    # Pure stimulus definitions
│   ├── creative/              # Creative writing stimuli
│   ├── coding/                # Code generation stimuli
│   ├── analysis/              # Analysis stimuli
│   └── index.ts
├── evaluation/
│   ├── strategies/            # Reusable evaluation strategies
│   ├── caching/               # Caching infrastructure
│   ├── types/                 # Type definitions
│   └── index.ts
└── scripts/                   # Evaluation scripts
    ├── evaluate-*.ts          # Simple evaluation scripts
    ├── compare-*.ts           # Comparison scripts
    ├── benchmark-*.ts         # Benchmark scripts
    └── legacy/                # Original scripts (during migration)
```

## Common Patterns

### Simple Evaluation
```typescript
import { CatPoemStimulus } from '../src/stimulus/creative/cat-poem';
import { SimpleEvaluation } from '../src/evaluation/strategies/simple-evaluation';
import { EvaluationCache } from '../src/evaluation/caching/cache-service';

const models = [
  { name: 'gemma3:27b', provider: 'ollama' },
  { name: 'gemini-2.0-flash', provider: 'google' }
];

const cache = new EvaluationCache('cat-poem');
const evaluation = new SimpleEvaluation(
  CatPoemStimulus,
  models,
  "Write a short poem about a cat",
  cache
);

const results = await evaluation.run();
```

### Code Generation Evaluation
```typescript
import { TypeScriptCodeStimulus } from '../src/stimulus/coding/typescript';
import { CodeGenerationEvaluation } from '../src/evaluation/strategies/code-generation-evaluation';
import { EvaluationCache } from '../src/evaluation/caching/cache-service';

const cache = new EvaluationCache('typescript-code');
const evaluation = new CodeGenerationEvaluation(
  TypeScriptCodeStimulus,
  models,
  "Write a function that generates 1042 unique show names",
  'typescript',
  { docker: true, timeout: 30 },
  cache
);

const results = await evaluation.run();
```

### Matrix Evaluation
```typescript
import { TypeScriptCodeStimulus } from '../src/stimulus/coding/typescript';
import { MatrixEvaluation } from '../src/evaluation/strategies/matrix-evaluation';
import { EvaluationCache } from '../src/evaluation/caching/cache-service';

const cache = new EvaluationCache('multi-language');
const evaluation = new MatrixEvaluation(
  TypeScriptCodeStimulus,
  models,
  { language: ['typescript', 'python', 'javascript'] },
  (dims) => `Write a function that generates 1042 unique show names in ${dims.language}`,
  cache
);

const results = await evaluation.run();
```

### Batch Evaluation
```typescript
import { ImageAnalysisStimulus } from '../src/stimulus/analysis/image-analysis';
import { BatchEvaluation } from '../src/evaluation/strategies/batch-evaluation';
import { EvaluationCache } from '../src/evaluation/caching/cache-service';

const images = fs.readdirSync('input/images').filter(f => /\.(jpg|jpeg|png)$/i.test(f));
const cache = new EvaluationCache('image-analysis');
const evaluation = new BatchEvaluation(
  ImageAnalysisStimulus,
  models,
  images,
  async (imagePath, model) => {
    const interaction = new Interaction(model, ImageAnalysisStimulus);
    await interaction.addAttachmentFromPath(imagePath);
    return await interaction.execute();
  },
  cache
);

const results = await evaluation.run();
```

## Available Evaluation Strategies

### SimpleEvaluation
- **Use Case**: Basic text generation tasks
- **Features**: Model response caching, simple error handling
- **Example**: Creative writing, Q&A, analysis

### CodeGenerationEvaluation
- **Use Case**: Code generation with execution validation
- **Features**: Code extraction, Docker execution, validation
- **Example**: TypeScript, Python, JavaScript code generation

### MatrixEvaluation
- **Use Case**: Multi-dimensional evaluation
- **Features**: Dimension combination, prompt templating
- **Example**: Multi-language evaluation, parameter sweeps

### BatchEvaluation
- **Use Case**: Processing multiple inputs
- **Features**: Batch processing, progress tracking
- **Example**: Image analysis, document processing

## Caching Features

### Automatic Caching
- Model responses are automatically cached
- External data (HTML, API responses) is cached
- Intermediate results (extracted code, Docker results) are cached
- Scores and analysis results are cached

### Cache Keys
- **Model Responses**: `responses/{stimulusId}/{model}-{provider}.json`
- **External Data**: `external/{dataType}/{identifier}`
- **Scores**: `scores/{stimulusId}/{scoreType}/{model}-{provider}.json`
- **Custom**: `{customKey}` for any other data

### Cache Management
```typescript
const cache = new EvaluationCache('my-evaluation');

// Generic file caching
const data = await cache.getCachedFile('my-data', async () => {
  return await fetchData();
});

// Model response caching
const response = await cache.getCachedModelResponse(model, stimulusId, async () => {
  return await generateResponse();
});

// External data caching
const html = await cache.getCachedExternalData('html', url, async () => {
  return await fetch(url).then(r => r.text());
});
```

## Migration from Old Patterns

### Single Function Pattern → SimpleEvaluation
```typescript
// Old
export async function catPoem(model: ModelDetails): Promise<ModelResponse> {
  const stimulus = new Stimulus({...});
  const interaction = new Interaction(model, stimulus);
  return await interaction.execute();
}

// New
const evaluation = new SimpleEvaluation(CatPoemStimulus, models, prompt, cache);
const results = await evaluation.run();
```

### EvaluationRunner Pattern → CodeGenerationEvaluation
```typescript
// Old
class GooglePricing extends EvaluationRunner {
  async getModelResponse(details: ModelDetails): Promise<ModelResponse> {
    const html = await this.getCachedFile("html", async () => {
      return await fetch(pricingPage).then(r => r.text());
    });
    return parseGooglePricing(html, details);
  }
}

// New
const evaluation = new WebScrapingEvaluation(
  GooglePricingStimulus,
  models,
  pricingPage,
  cache
);
const results = await evaluation.run();
```

### Multi-Matrix Pattern → MatrixEvaluation + CodeGenerationEvaluation
```typescript
// Old
async function main() {
  for (const language of LANGUAGES) {
    for (const model of MODELS) {
      // Complex pipeline logic
    }
  }
}

// New
const evaluation = new MatrixEvaluation(
  TypeScriptCodeStimulus,
  models,
  { language: LANGUAGES },
  (dims) => `Write code in ${dims.language}`,
  cache
);
const results = await evaluation.run();
```

## Best Practices

### Stimulus Design
- Keep stimuli focused on a single capability
- Use clear, descriptive names and descriptions
- Include appropriate role, objective, and instructions
- Don't include evaluation logic in stimuli

### Evaluation Strategy Selection
- Use SimpleEvaluation for basic text generation
- Use CodeGenerationEvaluation for code with execution
- Use MatrixEvaluation for multi-dimensional testing
- Use BatchEvaluation for multiple inputs

### Caching Strategy
- Always use caching for expensive operations
- Use appropriate cache keys for organization
- Consider cache invalidation for dynamic data
- Monitor cache performance and usage

### Error Handling
- Implement comprehensive error handling
- Provide clear error messages
- Handle network errors gracefully
- Log errors for debugging

### Testing
- Test each evaluation strategy thoroughly
- Test caching behavior
- Test error scenarios
- Test with different models and providers

## Troubleshooting

### Common Issues
- **Caching not working**: Check cache keys and file permissions
- **Evaluation failing**: Check model availability and API keys
- **Performance issues**: Check caching configuration and network
- **Type errors**: Check TypeScript types and imports

### Debug Tips
- Enable debug logging for evaluation strategies
- Check cache files in `output/evaluations/`
- Verify model responses are being cached
- Test with simple examples first

### Getting Help
- Check the main specification document
- Review the migration tracking document
- Look at example scripts in `scripts/`
- Check the test files for usage examples

This quick reference guide provides the essential information needed to work with the new Stimulus-centric evaluation architecture.
