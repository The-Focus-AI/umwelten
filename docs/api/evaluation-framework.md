# Evaluation Framework

Build sophisticated evaluation workflows with caching, batch processing, result aggregation, and comprehensive reporting. The evaluation framework provides the foundation for systematic AI model testing and comparison.

## Core Concepts

The evaluation framework consists of three main components:

1. **EvaluationRunner**: Base class for building custom evaluations
2. **evaluate() function**: Simple utility for one-off evaluations  
3. **Result Management**: Automatic organization and storage of results

## EvaluationRunner Class

The `EvaluationRunner` provides a robust foundation for building repeatable, cacheable evaluations.

### Basic Implementation

```typescript
import { EvaluationRunner } from '../src/evaluation/runner.js';
import { ModelDetails, ModelResponse } from '../src/cognition/types.js';
import { BaseModelRunner } from '../src/cognition/runner.js';
import { Interaction } from '../src/interaction/interaction.js';

class SimpleEvaluationRunner extends EvaluationRunner {
  constructor() {
    super('simple-evaluation'); // Unique identifier
  }

  // Main evaluation logic - required override
  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const conversation = new Interaction(model, 'You are an expert analyst.');
    conversation.addMessage({
      role: 'user',
      content: 'Analyze the current state of artificial intelligence.'
    });

    const runner = new BaseModelRunner();
    return runner.generateText(conversation);
  }
}

// Usage
const evaluation = new SimpleEvaluationRunner();

// Run across multiple models
await evaluation.evaluate({ name: 'gemini-2.0-flash', provider: 'google' });
await evaluation.evaluate({ name: 'gemma3:12b', provider: 'ollama' });
await evaluation.evaluate({ name: 'openai/gpt-4o-mini', provider: 'openrouter' });
```

### Data Caching

Cache expensive operations to avoid repeated work:

```typescript
class WebAnalysisRunner extends EvaluationRunner {
  constructor() {
    super('web-analysis');
  }

  // Cache web scraping results
  async getWebContent(): Promise<string> {
    return this.getCachedFile('web-content', async () => {
      console.log('Fetching web content...');
      const response = await fetch('https://example.com/data');
      return response.text();
    });
  }

  // Cache file processing results
  async getProcessedData(): Promise<any> {
    return this.getCachedFile('processed-data', async () => {
      console.log('Processing data...');
      const rawData = await this.getWebContent();
      // Expensive processing logic here
      return processData(rawData);
    });
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    // This will use cached data on subsequent runs
    const data = await this.getProcessedData();
    
    const conversation = new Interaction(model, 'Analyze this web data');
    conversation.addMessage({
      role: 'user',
      content: `Analyze this data: ${JSON.stringify(data)}`
    });

    const runner = new BaseModelRunner();
    return runner.generateText(conversation);
  }
}
```

### File System Integration

Working with files and attachments:

```typescript
class DocumentAnalysisRunner extends EvaluationRunner {
  private documentPath: string;

  constructor(documentPath: string) {
    super('document-analysis');
    this.documentPath = documentPath;
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const conversation = new Interaction(model, 'You are a document analyst.');
    
    // Add document attachment
    await conversation.addAttachmentFromPath(this.documentPath);
    
    conversation.addMessage({
      role: 'user',
      content: 'Analyze this document and provide key insights.'
    });

    const runner = new BaseModelRunner();
    return runner.generateText(conversation);
  }
}

// Usage with different documents
const pdfAnalysis = new DocumentAnalysisRunner('./report.pdf');
await pdfAnalysis.evaluate({ name: 'gemini-2.0-flash', provider: 'google' });

const imageAnalysis = new DocumentAnalysisRunner('./chart.png');
await imageAnalysis.evaluate({ name: 'gemini-2.0-flash', provider: 'google' });
```

### Structured Output Evaluation

Combine evaluation framework with schema validation:

```typescript
import { z } from 'zod';

const AnalysisSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number().min(0).max(1),
  key_themes: z.array(z.string()),
  summary: z.string().max(500),
  actionable_insights: z.array(z.object({
    insight: z.string(),
    priority: z.enum(['high', 'medium', 'low']),
    effort_required: z.enum(['minimal', 'moderate', 'significant'])
  }))
});

class StructuredAnalysisRunner extends EvaluationRunner {
  constructor() {
    super('structured-analysis');
  }

  async getInputData(): Promise<string> {
    return this.getCachedFile('input-text', async () => {
      // Load your input data
      return "Sample text for analysis...";
    });
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const inputData = await this.getInputData();
    
    const conversation = new Interaction(model, 'You are an expert data analyst.');
    conversation.addMessage({
      role: 'user',
      content: `Analyze this content and provide structured insights: ${inputData}`
    });

    const runner = new BaseModelRunner();
    return runner.streamObject(conversation, AnalysisSchema);
  }
}

// Results will include validated structured data
const analysis = new StructuredAnalysisRunner();
await analysis.evaluate({ name: 'gemini-2.5-pro-exp-03-25', provider: 'google' });
```

## Simple evaluate() Function

For quick, one-off evaluations without the full framework:

```typescript
import { evaluate } from '../src/evaluation/evaluate.js';
import { ModelDetails, ModelResponse } from '../src/cognition/types.js';
import { BaseModelRunner } from '../src/cognition/runner.js';
import { Interaction } from '../src/interaction/interaction.js';

// Define evaluation function
async function quickSummary(model: ModelDetails): Promise<ModelResponse> {
  const conversation = new Interaction(model, 'Provide concise summaries.');
  conversation.addMessage({
    role: 'user',
    content: 'Summarize the key benefits of renewable energy in 2 sentences.'
  });

  const runner = new BaseModelRunner();
  return runner.generateText(conversation);
}

// Run evaluation
await evaluate(
  quickSummary,                                           // Evaluation function
  'renewable-energy-summary',                             // Evaluation ID
  'google-flash',                                         // Result identifier
  { name: 'gemini-2.0-flash', provider: 'google' }      // Model details
);
```

## Real-World Examples

### Multi-Source Data Analysis

Based on `scripts/google-pricing.ts`:

```typescript
class PricingAnalysisRunner extends EvaluationRunner {
  private pricingUrl: string;

  constructor(pricingUrl: string) {
    super('pricing-analysis');
    this.pricingUrl = pricingUrl;
  }

  // Cache expensive web requests
  async getPricingHTML(): Promise<string> {
    return this.getCachedFile('pricing-html', async () => {
      console.log(`Fetching pricing data from ${this.pricingUrl}...`);
      const response = await fetch(this.pricingUrl);
      return response.text();
    });
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const html = await this.getPricingHTML();
    
    const pricingSchema = z.object({
      pricing: z.array(z.object({
        model: z.string(),
        modelId: z.string(),
        inputCost: z.number(),
        outputCost: z.number(),
        description: z.string(),
        contextLength: z.number(),
        caching: z.boolean()
      }))
    });

    const conversation = new Interaction(model, 'Extract pricing information from HTML.');
    conversation.addMessage({
      role: 'user',
      content: html
    });

    const runner = new BaseModelRunner();
    return runner.streamObject(conversation, pricingSchema);
  }
}

// Run pricing analysis
const pricing = new PricingAnalysisRunner('https://ai.google.dev/gemini-api/docs/pricing');
await pricing.evaluate({ name: 'gemini-2.0-flash', provider: 'google' });
await pricing.evaluate({ name: 'openai/gpt-4o-mini', provider: 'openrouter' });
```

### Image Feature Extraction

Based on `scripts/image-feature-extract.ts`:

```typescript
const ImageFeatureSchema = z.object({
  able_to_parse: z.object({
    value: z.boolean(),
    confidence: z.number().min(0).max(1)
  }),
  image_description: z.object({
    value: z.string(),
    confidence: z.number().min(0).max(1)
  }),
  color_palette: z.object({
    value: z.enum(['warm', 'cool', 'monochrome', 'vibrant', 'neutral']),
    confidence: z.number().min(0).max(1)
  }),
  scene_type: z.object({
    value: z.enum(['indoor', 'outdoor', 'unknown']),
    confidence: z.number().min(0).max(1)
  }),
  people_count: z.object({
    value: z.number().int(),
    confidence: z.number().min(0).max(1)
  })
});

class ImageFeatureRunner extends EvaluationRunner {
  private imagePath: string;

  constructor(imagePath: string) {
    super('image-features');
    this.imagePath = imagePath;
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const conversation = new Interaction(model, 'You are an expert image analyst.');
    
    await conversation.addAttachmentFromPath(this.imagePath);
    
    conversation.addMessage({
      role: 'user',
      content: 'Analyze this image and extract detailed features.'
    });

    const runner = new BaseModelRunner();
    return runner.streamObject(conversation, ImageFeatureSchema);
  }
}

// Analyze different images with multiple models
const imageAnalysis = new ImageFeatureRunner('./test-image.jpg');
await imageAnalysis.evaluate({ name: 'gemini-2.0-flash', provider: 'google' });
await imageAnalysis.evaluate({ name: 'qwen2.5vl:latest', provider: 'ollama' });
```

### Batch File Processing

Process multiple files systematically:

```typescript
class BatchDocumentRunner extends EvaluationRunner {
  private documentPaths: string[];

  constructor(documentPaths: string[]) {
    super('batch-documents');
    this.documentPaths = documentPaths;
  }

  // Override to handle multiple documents
  async evaluate(model: ModelDetails): Promise<void> {
    for (const [index, documentPath] of this.documentPaths.entries()) {
      console.log(`Processing document ${index + 1}/${this.documentPaths.length}: ${documentPath}`);
      
      const conversation = new Interaction(model, 'Analyze this document.');
      await conversation.addAttachmentFromPath(documentPath);
      conversation.addMessage({
        role: 'user',
        content: 'Extract key information and provide summary.'
      });

      const runner = new BaseModelRunner();
      const response = await runner.generateText(conversation);
      
      // Save with document-specific identifier
      await this.saveResponse(response, model, `doc-${index}-${path.basename(documentPath)}`);
    }
  }

  // Not used in this implementation, but required by base class
  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    throw new Error('Use evaluate() method directly for batch processing');
  }
}

// Process multiple documents
const documents = ['./doc1.pdf', './doc2.pdf', './doc3.pdf'];
const batchProcessor = new BatchDocumentRunner(documents);
await batchProcessor.evaluate({ name: 'gemini-2.0-flash', provider: 'google' });
```

## Advanced Patterns

### Comparative Analysis

Compare model performance across multiple dimensions:

```typescript
class ModelComparisonRunner extends EvaluationRunner {
  private testPrompts: string[];

  constructor(testPrompts: string[]) {
    super('model-comparison');
    this.testPrompts = testPrompts;
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const results = [];
    const runner = new BaseModelRunner();

    for (const [index, prompt] of this.testPrompts.entries()) {
      const conversation = new Interaction(model, 'Respond accurately and concisely.');
      conversation.addMessage({ role: 'user', content: prompt });

      const startTime = Date.now();
      const response = await runner.generateText(conversation);
      const duration = Date.now() - startTime;

      results.push({
        prompt_index: index,
        prompt: prompt.substring(0, 100) + '...',
        response: response.content,
        duration,
        tokens: response.metadata?.tokenUsage?.total || 0,
        cost: response.metadata?.cost?.totalCost || 0
      });
    }

    // Return aggregated results
    return {
      content: JSON.stringify({
        model: `${model.provider}:${model.name}`,
        results,
        summary: {
          total_prompts: results.length,
          avg_duration: results.reduce((sum, r) => sum + r.duration, 0) / results.length,
          total_tokens: results.reduce((sum, r) => sum + r.tokens, 0),
          total_cost: results.reduce((sum, r) => sum + r.cost, 0)
        }
      }, null, 2),
      model: `${model.provider}:${model.name}`,
      metadata: {
        tokenUsage: {
          total: results.reduce((sum, r) => sum + r.tokens, 0),
          promptTokens: 0,
          completionTokens: 0
        },
        cost: {
          totalCost: results.reduce((sum, r) => sum + r.cost, 0),
          promptCost: 0,
          completionCost: 0,
          usage: { promptTokens: 0, completionTokens: 0 }
        }
      }
    };
  }
}

// Compare models across various tasks
const testPrompts = [
  'Explain quantum computing in simple terms',
  'Write a Python function to calculate fibonacci numbers',
  'Analyze the pros and cons of renewable energy',
  'Describe the water cycle for a 10-year-old'
];

const comparison = new ModelComparisonRunner(testPrompts);
await comparison.evaluate({ name: 'gemini-2.0-flash', provider: 'google' });
await comparison.evaluate({ name: 'gemma3:12b', provider: 'ollama' });
await comparison.evaluate({ name: 'openai/gpt-4o-mini', provider: 'openrouter' });
```

### Iterative Refinement

Build evaluations that improve over multiple iterations:

```typescript
class IterativeRefinementRunner extends EvaluationRunner {
  constructor() {
    super('iterative-refinement');
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const runner = new BaseModelRunner();
    
    // Initial analysis
    const initial = new Interaction(model, 'Provide initial analysis.');
    initial.addMessage({
      role: 'user',
      content: 'Analyze the current state of AI development.'
    });
    
    const initialResponse = await runner.generateText(initial);
    
    // Refinement based on initial response
    const refinement = new Interaction(model, 'Refine and improve analysis.');
    refinement.addMessage({
      role: 'user',
      content: `Here was your initial analysis: ${initialResponse.content}`
    });
    refinement.addMessage({
      role: 'user',
      content: 'Now provide a more detailed analysis addressing any gaps or limitations.'
    });
    
    const finalResponse = await runner.generateText(refinement);
    
    // Combine results
    return {
      content: JSON.stringify({
        initial_analysis: initialResponse.content,
        refined_analysis: finalResponse.content,
        improvement_notes: 'Refinement added depth and addressed gaps'
      }, null, 2),
      model: finalResponse.model,
      metadata: {
        tokenUsage: {
          total: (initialResponse.metadata?.tokenUsage?.total || 0) + (finalResponse.metadata?.tokenUsage?.total || 0),
          promptTokens: (initialResponse.metadata?.tokenUsage?.promptTokens || 0) + (finalResponse.metadata?.tokenUsage?.promptTokens || 0),
          completionTokens: (initialResponse.metadata?.tokenUsage?.completionTokens || 0) + (finalResponse.metadata?.tokenUsage?.completionTokens || 0)
        },
        cost: {
          totalCost: (initialResponse.metadata?.cost?.totalCost || 0) + (finalResponse.metadata?.cost?.totalCost || 0),
          promptCost: (initialResponse.metadata?.cost?.promptCost || 0) + (finalResponse.metadata?.cost?.promptCost || 0),
          completionCost: (initialResponse.metadata?.cost?.completionCost || 0) + (finalResponse.metadata?.cost?.completionCost || 0),
          usage: { promptTokens: 0, completionTokens: 0 }
        }
      }
    };
  }
}
```

## Result Management

### File Organization

The evaluation framework automatically organizes results:

```
output/evaluations/evaluation-id/
├── responses/
│   ├── google_gemini-2.0-flash.json     # Raw model response
│   ├── ollama_gemma3_12b.json
│   └── openrouter_openai_gpt-4o-mini.json
├── cached-data/                          # getCachedFile() results
│   ├── web-content.txt
│   └── processed-data.json
└── metadata.json                         # Evaluation metadata
```

### Custom Result Processing

```typescript
class CustomResultsRunner extends EvaluationRunner {
  constructor() {
    super('custom-results');
  }

  // Override to add custom result processing
  async saveResponse(response: ModelResponse, model: ModelDetails, suffix?: string): Promise<void> {
    // Call parent to save standard results
    await super.saveResponse(response, model, suffix);
    
    // Add custom processing
    const customResults = {
      model: `${model.provider}:${model.name}`,
      timestamp: new Date().toISOString(),
      word_count: response.content.split(' ').length,
      character_count: response.content.length,
      estimated_reading_time: Math.ceil(response.content.split(' ').length / 200) // 200 WPM
    };
    
    // Save custom analysis
    const customPath = path.join(this.getOutputPath(), 'custom-analysis', `${this.getModelKey(model, suffix)}.json`);
    await fs.ensureDir(path.dirname(customPath));
    await fs.writeJson(customPath, customResults, { spaces: 2 });
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const conversation = new Interaction(model, 'Write a comprehensive analysis.');
    conversation.addMessage({
      role: 'user',
      content: 'Analyze the future of artificial intelligence.'
    });

    const runner = new BaseModelRunner();
    return runner.generateText(conversation);
  }
}
```

## Performance and Scaling

### Parallel Execution

```typescript
class ParallelEvaluationRunner extends EvaluationRunner {
  constructor() {
    super('parallel-evaluation');
  }

  // Run multiple models in parallel
  async evaluateMultiple(models: ModelDetails[]): Promise<void> {
    const promises = models.map(model => this.evaluate(model));
    await Promise.all(promises);
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const conversation = new Interaction(model, 'Provide analysis.');
    conversation.addMessage({
      role: 'user',
      content: 'Analyze current market trends.'
    });

    const runner = new BaseModelRunner();
    return runner.generateText(conversation);
  }
}

// Run multiple models concurrently
const parallel = new ParallelEvaluationRunner();
await parallel.evaluateMultiple([
  { name: 'gemini-2.0-flash', provider: 'google' },
  { name: 'gemma3:12b', provider: 'ollama' },
  { name: 'openai/gpt-4o-mini', provider: 'openrouter' }
]);
```

### Resource Management

```typescript
class ResourceManagedRunner extends EvaluationRunner {
  private maxConcurrency: number;
  private activeEvaluations: number = 0;

  constructor(maxConcurrency: number = 3) {
    super('resource-managed');
    this.maxConcurrency = maxConcurrency;
  }

  async evaluate(model: ModelDetails): Promise<void> {
    // Wait if too many concurrent evaluations
    while (this.activeEvaluations >= this.maxConcurrency) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.activeEvaluations++;
    try {
      await super.evaluate(model);
    } finally {
      this.activeEvaluations--;
    }
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const conversation = new Interaction(model, 'Provide resource-efficient analysis.');
    conversation.addMessage({
      role: 'user',
      content: 'Analyze this efficiently.'
    });

    const runner = new BaseModelRunner();
    return runner.generateText(conversation);
  }
}
```

## Best Practices

### Design Principles

1. **Single Responsibility**: Each evaluation should test one specific capability
2. **Reproducibility**: Use caching and fixed seeds when possible
3. **Scalability**: Design for multiple models and large datasets
4. **Error Handling**: Gracefully handle provider failures and network issues

### Code Organization

```typescript
// Good: Focused, reusable evaluation
class SentimentAnalysisRunner extends EvaluationRunner {
  constructor() {
    super('sentiment-analysis');
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    // Focused on sentiment analysis only
  }
}

// Good: Parameterized for different use cases
class TextAnalysisRunner extends EvaluationRunner {
  constructor(private analysisType: 'sentiment' | 'topic' | 'summary') {
    super(`text-analysis-${analysisType}`);
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    // Behavior changes based on analysisType
  }
}
```

### Testing Strategies

```typescript
// Test evaluation logic separately from model calls
class TestableRunner extends EvaluationRunner {
  constructor() {
    super('testable');
  }

  // Testable data processing logic
  processInput(input: string): string {
    return input.trim().toLowerCase();
  }

  // Testable result formatting
  formatResponse(response: ModelResponse): any {
    return {
      content: response.content,
      word_count: response.content.split(' ').length
    };
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const processedInput = this.processInput('Raw Input Data');
    
    const conversation = new Interaction(model, 'Process data');
    conversation.addMessage({ role: 'user', content: processedInput });

    const runner = new BaseModelRunner();
    return runner.generateText(conversation);
  }
}
```

## Next Steps

- See [Schema Validation](/api/schemas) for structured output in evaluations
- Check [Model Integration](/api/model-integration) for provider-specific evaluation strategies  
- Explore [Core Classes](/api/core-classes) for detailed API documentation