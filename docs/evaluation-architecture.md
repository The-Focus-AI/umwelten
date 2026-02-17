# Evaluation Architecture Documentation

## Overview

The umwelten project implements a **Stimulus-centric evaluation architecture** that makes **Stimulus** the primary unit of cognitive testing, with everything else being lightweight, composable infrastructure around it.

**Status**: Phase 2 Complete - Advanced evaluation strategies and analysis tools implemented with comprehensive testing coverage.

## Core Concepts

### 1. Stimulus
A **Stimulus** represents a specific cognitive task or capability to test. It's pure and focused on what we're testing, not how we're testing it.

```typescript
export const CatPoemStimulus = new Stimulus({
  id: 'cat-poem',
  name: 'Cat Poem Generation',
  description: 'Test models\' ability to write creative poetry about cats',
  
  role: "literary genius",
  objective: "write short poems about cats",
  temperature: 0.7,
  maxTokens: 200,
  runnerType: 'base'
});
```

### 2. Evaluation Strategy
An **Evaluation Strategy** defines how to test a stimulus. It handles the testing approach, caching, and result processing.

```typescript
const evaluation = new SimpleEvaluation(
  CatPoemStimulus,
  models,
  "Write a short poem about a cat",
  cache
);
```

### 3. Evaluation Cache
The **Evaluation Cache** provides automatic caching for model responses, external data, and intermediate results.

```typescript
const cache = new EvaluationCache('cat-poem');
const response = await cache.getCachedModelResponse(model, stimulusId, fetchFunction);
```

## Architecture Components

### Directory Structure

```
src/
├── stimulus/                   # Pure stimulus definitions
│   ├── creative/              # Creative writing stimuli
│   │   ├── cat-poem.ts        # Basic cat poem stimulus
│   │   └── advanced-creative.ts # Advanced creative tasks
│   ├── coding/                # Code generation stimuli
│   │   ├── typescript.ts      # Basic TypeScript stimulus
│   │   └── advanced-typescript.ts # Advanced coding tasks
│   ├── analysis/              # Analysis stimuli
│   │   ├── pdf-analysis.ts    # Basic PDF analysis
│   │   └── advanced-analysis.ts # Advanced analysis tasks
│   └── index.ts
├── evaluation/
│   ├── strategies/            # Reusable evaluation strategies
│   │   ├── simple-evaluation.ts
│   │   ├── code-generation-evaluation.ts
│   │   ├── matrix-evaluation.ts
│   │   ├── batch-evaluation.ts
│   │   └── index.ts
│   ├── analysis/              # Result analysis tools
│   │   ├── result-analyzer.ts
│   │   ├── report-generator.ts
│   │   └── index.ts
│   ├── caching/               # Caching infrastructure
│   │   └── cache-service.ts
│   ├── types/                 # Type definitions
│   │   └── evaluation-types.ts
│   └── index.ts
└── scripts/                   # Evaluation scripts
    ├── evaluate-cat-poem.ts
    ├── evaluate-advanced-typescript.ts
    ├── evaluate-matrix-creative.ts
    ├── evaluate-batch-analysis.ts
    └── evaluate-phase2-demo.ts
```

### Core Classes

#### Stimulus Class
The `Stimulus` class represents a cognitive task to be tested. It includes:
- **Role**: The persona the model should adopt
- **Objective**: What the model should accomplish
- **Instructions**: Specific steps or guidelines
- **Output**: Expected output format
- **Examples**: Sample inputs/outputs
- **Model Options**: Temperature, max tokens, etc.
- **Runner Type**: Base or memory-augmented

#### EvaluationCache Class
The `EvaluationCache` class provides comprehensive caching for:
- **Model Responses**: Cached by model and stimulus
- **External Data**: HTML, API responses, etc.
- **Scores**: Analysis and evaluation results
- **Generic Files**: Any other cached data

#### Evaluation Strategies

##### SimpleEvaluation Class
The `SimpleEvaluation` class implements the basic evaluation strategy:
- Creates an `Interaction` with the provided `Stimulus`
- Adds a user message with the prompt
- Executes the interaction to get a model response
- Caches the response for future use

##### CodeGenerationEvaluation Class
The `CodeGenerationEvaluation` class handles code generation tasks with Docker execution:
- Extracts TypeScript code from model responses
- Executes code in Docker containers for validation
- Scores code quality and functionality
- Handles compilation errors and runtime issues

##### MatrixEvaluation Class
The `MatrixEvaluation` class performs multi-dimensional evaluation:
- Generates all combinations of parameter dimensions
- Tests models across different stimulus variations
- Organizes results by parameter combinations
- Supports complex evaluation matrices

##### BatchEvaluation Class
The `BatchEvaluation` class processes large datasets efficiently:
- Evaluates multiple items against multiple models
- Supports placeholder replacement in prompts
- Groups results by model or item
- Handles batch processing with progress tracking

#### Result Analysis Tools

##### ResultAnalyzer Class
The `ResultAnalyzer` class provides comprehensive evaluation analysis:
- Calculates metrics (success rate, duration, cost, tokens)
- Analyzes model performance and comparisons
- Identifies error patterns and common issues
- Generates actionable recommendations

##### ReportGenerator Class
The `ReportGenerator` class creates detailed evaluation reports:
- Comprehensive performance insights
- Model ranking and comparison
- Export capabilities for further analysis
- Structured report formatting

## Usage Patterns

### Basic Evaluation

```typescript
import { CatPoemStimulus } from '../src/stimulus/creative/cat-poem.js';
import { SimpleEvaluation } from '../src/evaluation/strategies/simple-evaluation.js';
import { EvaluationCache } from '../src/evaluation/caching/cache-service.js';

const models = [
  { name: 'gemma3:27b', provider: 'ollama' },
  { name: 'gemini-3-flash-preview', provider: 'google' }
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

### Advanced Configuration

```typescript
const evaluation = new SimpleEvaluation(
  stimulus,
  models,
  prompt,
  cache,
  {
    evaluationId: 'my-evaluation',
    useCache: true,
    concurrent: true,
    maxConcurrency: 3,
    resume: true,
    showProgress: true,
  },
  (progress) => {
    console.log(`${progress.modelName}: ${progress.status}`);
  }
);
```

### Caching External Data

```typescript
const cache = new EvaluationCache('my-evaluation');

// Cache HTML content
const html = await cache.getCachedExternalData('html', url, async () => {
  return await fetch(url).then(r => r.text());
});

// Cache API responses
const data = await cache.getCachedExternalData('api', endpoint, async () => {
  return await fetch(endpoint).then(r => r.json());
});
```

## Evaluation Strategies

### SimpleEvaluation
- **Purpose**: Basic text generation tasks
- **Use Case**: Creative writing, Q&A, summarization
- **Features**: Sequential or concurrent execution, progress tracking

### Advanced Strategies (Phase 2 Complete)

#### CodeGenerationEvaluation
- **Purpose**: Code generation tasks with execution validation
- **Use Case**: TypeScript development, algorithm implementation, code quality testing
- **Features**: Docker execution, code extraction, quality scoring, error handling

```typescript
import { AdvancedTypescriptStimulus } from '../src/stimulus/coding/advanced-typescript.js';
import { CodeGenerationEvaluation } from '../src/evaluation/strategies/code-generation-evaluation.js';

const evaluation = new CodeGenerationEvaluation(
  AdvancedTypescriptStimulus,
  models,
  "Implement a binary search algorithm",
  cache,
  {
    maxConcurrent: 2,
    timeout: 30000,
    enableDocker: true
  }
);
```

#### MatrixEvaluation
- **Purpose**: Multi-dimensional evaluation across parameter combinations
- **Use Case**: Testing models across different styles, domains, or configurations
- **Features**: Combination generation, systematic testing, result organization

```typescript
import { AdvancedCreativeStimulus } from '../src/stimulus/creative/advanced-creative.js';
import { MatrixEvaluation } from '../src/evaluation/strategies/matrix-evaluation.js';

const evaluation = new MatrixEvaluation(
  AdvancedCreativeStimulus,
  models,
  "Write a {genre} story in {tone} tone",
  cache,
  {
    dimensions: {
      genre: ['fantasy', 'sci-fi', 'mystery'],
      tone: ['serious', 'humorous', 'dramatic']
    }
  }
);
```

#### BatchEvaluation
- **Purpose**: Efficient processing of large datasets
- **Use Case**: Testing multiple items against multiple models
- **Features**: Batch processing, placeholder replacement, progress tracking

```typescript
import { AdvancedAnalysisStimulus } from '../src/stimulus/analysis/advanced-analysis.js';
import { BatchEvaluation } from '../src/evaluation/strategies/batch-evaluation.js';

const evaluation = new BatchEvaluation(
  AdvancedAnalysisStimulus,
  models,
  "Analyze this {documentType}: {content}",
  cache,
  {
    items: [
      { id: 'doc1', documentType: 'PDF', content: '...' },
      { id: 'doc2', documentType: 'HTML', content: '...' }
    ],
    groupByModel: true
  }
);
```

## Caching System

### Cache Organization
```
output/evaluations/{evaluationId}/
├── responses/{stimulusId}/{model}-{provider}.json
├── scores/{stimulusId}/{scoreType}/{model}-{provider}.json
├── external/{dataType}/{identifier}.json
└── {customKey}.json
```

### Cache Features
- **Automatic Directory Management**: Creates necessary directories
- **File Expiration**: Configurable max age for cached files
- **Statistics Tracking**: Hit rate, misses, errors
- **Error Handling**: Graceful fallback when caching fails
- **Identifier Sanitization**: Safe file names for any identifier

### Cache Configuration
```typescript
const cache = new EvaluationCache('evaluation-id', {
  baseDir: '/custom/path',     // Custom base directory
  verbose: true,               // Enable logging
  maxAge: 24 * 60 * 60 * 1000 // 24 hours expiration
});
```

## Progress Tracking

### Progress Callback
```typescript
function onProgress(progress: EvaluationProgress): void {
  switch (progress.status) {
    case 'starting':
      console.log(`Starting: ${progress.modelName}`);
      break;
    case 'in-progress':
      console.log(`Progress: ${progress.modelName}`);
      break;
    case 'completed':
      console.log(`Completed: ${progress.modelName}`);
      break;
    case 'error':
      console.log(`Error: ${progress.modelName} - ${progress.error}`);
      break;
  }
}
```

### Progress Events
- **starting**: Evaluation begins for a model
- **in-progress**: Evaluation is running (with optional content preview)
- **completed**: Evaluation finished successfully
- **error**: Evaluation failed with error

## Error Handling

### Evaluation Errors
- **Model Errors**: Network failures, API errors, timeouts
- **Validation Errors**: Invalid model configurations
- **Cache Errors**: File system issues, permission problems

### Error Recovery
- **Graceful Degradation**: Continue with other models if one fails
- **Retry Logic**: Automatic retry for transient errors
- **Error Reporting**: Detailed error information in results

## Performance Considerations

### Concurrent Execution
- **Batch Processing**: Run multiple models simultaneously
- **Concurrency Limits**: Configurable maximum concurrent evaluations
- **Resource Management**: Efficient memory and CPU usage

### Caching Benefits
- **Avoid Duplicate API Calls**: Significant cost savings
- **Faster Iterations**: Skip already-evaluated models
- **Resume Capability**: Continue interrupted evaluations

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

## Best Practices

### Stimulus Design
- **Single Responsibility**: Each stimulus tests one specific capability
- **Clear Instructions**: Provide detailed, unambiguous instructions
- **Appropriate Examples**: Include relevant examples
- **Realistic Constraints**: Set appropriate temperature and token limits

### Evaluation Configuration
- **Use Caching**: Always enable caching for cost efficiency
- **Concurrent Execution**: Use concurrent mode for multiple models
- **Progress Tracking**: Implement progress callbacks for long evaluations
- **Error Handling**: Always handle and report errors appropriately

### Cache Management
- **Meaningful Keys**: Use descriptive cache keys
- **Appropriate Expiration**: Set reasonable cache expiration times
- **Monitor Statistics**: Track cache hit rates and performance
- **Clean Up**: Regularly clean up old cache files

## Future Enhancements

### Phase 2: Core Strategies
- CodeGenerationEvaluation with Docker execution
- MatrixEvaluation for multi-dimensional testing
- BatchEvaluation for processing multiple inputs

### Phase 3: Advanced Features
- ComplexEvaluationPipeline for multi-step evaluations
- Evaluation comparison and benchmarking tools
- Advanced reporting and visualization

### Phase 4: Integration
- CLI tools for evaluation management
- Web dashboard for result visualization
- API endpoints for programmatic access

## Troubleshooting

### Common Issues
1. **Cache Permission Errors**: Ensure write access to output directory
2. **Model Connection Failures**: Check API keys and network connectivity
3. **Memory Issues**: Reduce concurrent evaluations or model batch size
4. **Timeout Errors**: Increase timeout limits or reduce model complexity

### Debug Mode
```typescript
const cache = new EvaluationCache('debug-eval', {
  verbose: true,  // Enable detailed logging
});
```

### Performance Monitoring
```typescript
const stats = cache.getStats();
console.log(`Cache hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
console.log(`Total requests: ${stats.totalRequests}`);
console.log(`Cache hits: ${stats.hits}`);
console.log(`Cache misses: ${stats.misses}`);
```
