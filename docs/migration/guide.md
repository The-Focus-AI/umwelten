# Migration Guide

Step-by-step guide for migrating from TypeScript scripts to the Umwelten CLI. Learn how to convert existing script-based evaluations to CLI commands with improved functionality.

## Why Migrate to CLI?

The Umwelten CLI provides significant advantages over TypeScript scripts:

### Enhanced Features
- **Structured Output**: Built-in schema validation with DSL, JSON Schema, and Zod support
- **Batch Processing**: Concurrent file processing with intelligent error handling
- **Result Management**: Automatic organization and reporting of evaluation results
- **Cost Tracking**: Built-in cost analysis and optimization features
- **Resume Capability**: Continue interrupted evaluations where they left off

### Operational Benefits
- **No Build Step**: Direct execution without TypeScript compilation
- **Better Error Handling**: Graceful failure recovery and detailed error reporting
- **Unified Interface**: Consistent command structure across all operations
- **Performance Optimizations**: Concurrent processing and intelligent caching

## Migration Process

### Step 1: Analyze Your Script

Identify the key components of your TypeScript script:

```typescript
// Original script pattern
import { EvaluationRunner } from '../src/evaluation/runner.js';
import { ModelDetails, ModelResponse } from '../src/cognition/types.js';
import { Interaction } from '../src/interaction/interaction.js';
import { BaseModelRunner } from '../src/cognition/runner.js';

class MyEvaluationRunner extends EvaluationRunner {
  constructor() {
    super('my-evaluation-id');
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const conversation = new Interaction(model, 'System prompt here');
    conversation.addMessage({
      role: 'user',
      content: 'User prompt here'
    });

    const runner = new BaseModelRunner();
    return runner.generateText(conversation);
  }
}

// Run evaluation
const evaluation = new MyEvaluationRunner();
await evaluation.evaluate({ name: 'gemini-2.0-flash', provider: 'google' });
```

### Step 2: Extract Core Components

Identify these elements from your script:

1. **System Prompt**: The role/context for the AI model
2. **User Prompt**: The actual question or task
3. **Models**: Which models to evaluate
4. **Input Data**: Files, URLs, or text content
5. **Output Schema**: Expected structure of results (if any)

### Step 3: Convert to CLI Command

Transform the script components into CLI arguments:

```bash
# Basic conversion
umwelten eval run \
  --system "System prompt here" \
  --prompt "User prompt here" \
  --models "google:gemini-2.0-flash" \
  --id "my-evaluation-id"
```

## Common Migration Patterns

### Pattern 1: Simple Text Generation

**Before (TypeScript):**
```typescript
export async function generateText(model: ModelDetails): Promise<ModelResponse> {
  const conversation = new Interaction(model, "You are a helpful assistant");
  conversation.addMessage({
    role: "user",
    content: "Explain quantum computing"
  });

  const runner = new BaseModelRunner();
  return runner.generateText(conversation);
}

await evaluate(generateText, "quantum-explanation", "google-flash", 
  { name: "gemini-2.0-flash", provider: "google" });
```

**After (CLI):**
```bash
umwelten eval run \
  --system "You are a helpful assistant" \
  --prompt "Explain quantum computing" \
  --models "google:gemini-2.0-flash" \
  --id "quantum-explanation"
```

### Pattern 2: File Processing

**Before (TypeScript):**
```typescript
class DocumentAnalysis extends EvaluationRunner {
  constructor() {
    super('document-analysis');
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const conversation = new Interaction(model, 'Analyze documents');
    await conversation.addAttachmentFromPath('./document.pdf');
    conversation.addMessage({
      role: 'user',
      content: 'Summarize this document'
    });

    const runner = new BaseModelRunner();
    return runner.generateText(conversation);
  }
}
```

**After (CLI):**
```bash
umwelten eval run \
  --system "Analyze documents" \
  --prompt "Summarize this document" \
  --file "./document.pdf" \
  --models "google:gemini-2.0-flash" \
  --id "document-analysis"
```

### Pattern 3: Structured Output

**Before (TypeScript):**
```typescript
const PersonSchema = z.object({
  name: z.string(),
  age: z.number().int(),
  occupation: z.string()
});

export async function extractPerson(model: ModelDetails): Promise<ModelResponse> {
  const conversation = new Interaction(model, 'Extract person info');
  conversation.addMessage({
    role: 'user',
    content: 'John Smith is a 35-year-old engineer'
  });

  const runner = new BaseModelRunner();
  return runner.streamObject(conversation, PersonSchema);
}
```

**After (CLI):**
```bash
umwelten eval run \
  --system "Extract person info" \
  --prompt "John Smith is a 35-year-old engineer" \
  --schema "name, age int, occupation" \
  --models "google:gemini-2.0-flash" \
  --id "person-extraction"
```

### Pattern 4: Batch Processing

**Before (TypeScript):**
```typescript
class ImageBatchRunner extends EvaluationRunner {
  private imagePaths: string[];

  constructor(imagePaths: string[]) {
    super('image-batch');
    this.imagePaths = imagePaths;
  }

  async evaluate(model: ModelDetails): Promise<void> {
    for (const imagePath of this.imagePaths) {
      const conversation = new Interaction(model, 'Analyze images');
      await conversation.addAttachmentFromPath(imagePath);
      conversation.addMessage({
        role: 'user',
        content: 'Describe this image'
      });

      const runner = new BaseModelRunner();
      const response = await runner.generateText(conversation);
      await this.saveResponse(response, model, path.basename(imagePath));
    }
  }
}
```

**After (CLI):**
```bash
umwelten eval batch \
  --system "Analyze images" \
  --prompt "Describe this image" \
  --directory "./images" \
  --file-pattern "*.{jpg,png}" \
  --models "google:gemini-2.0-flash" \
  --id "image-batch" \
  --concurrent
```

### Pattern 5: Multiple Models

**Before (TypeScript):**
```typescript
const models = [
  { name: 'gemini-2.0-flash', provider: 'google' },
  { name: 'gemma3:12b', provider: 'ollama' },
  { name: 'openai/gpt-4o-mini', provider: 'openrouter' }
];

for (const model of models) {
  await evaluation.evaluate(model);
}
```

**After (CLI):**
```bash
umwelten eval run \
  --prompt "Your prompt here" \
  --models "google:gemini-2.0-flash,ollama:gemma3:12b,openrouter:openai/gpt-4o-mini" \
  --id "multi-model-evaluation" \
  --concurrent
```

## Advanced Migration Scenarios

### Data Caching

**Before (TypeScript):**
```typescript
class CachedEvaluation extends EvaluationRunner {
  async getWebData(): Promise<string> {
    return this.getCachedFile('web-data', async () => {
      const response = await fetch('https://example.com/data');
      return response.text();
    });
  }

  async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    const data = await this.getWebData();
    // Process with model...
  }
}
```

**After (CLI):**
```bash
# Fetch and cache data externally, then use with CLI
curl -o cached-web-data.txt "https://example.com/data"

umwelten eval run \
  --prompt "Analyze this web data" \
  --file "./cached-web-data.txt" \
  --models "google:gemini-2.0-flash" \
  --id "cached-evaluation"
```

### Complex Schemas with Zod Files

**Before (TypeScript):**
```typescript
const ComplexSchema = z.object({
  analysis: z.object({
    sentiment: z.enum(['positive', 'negative', 'neutral']),
    themes: z.array(z.string()),
    confidence: z.number().min(0).max(1)
  }),
  metadata: z.object({
    word_count: z.number().int(),
    complexity: z.enum(['low', 'medium', 'high'])
  })
});

return runner.streamObject(conversation, ComplexSchema);
```

**After (CLI):**
```bash
# Create schema file: schemas/complex-analysis.ts
# Export the schema as shown in original script

umwelten eval run \
  --prompt "Analyze this content" \
  --zod-schema "./schemas/complex-analysis.ts" \
  --models "google:gemini-2.0-flash" \
  --id "complex-analysis"
```

## Migration Checklist

### Pre-Migration
- [ ] Identify all system prompts used in the script
- [ ] Extract user prompts and input data sources  
- [ ] Note which models are being evaluated
- [ ] Document any schema validation requirements
- [ ] List file attachments or external data sources

### During Migration
- [ ] Convert system prompts to `--system` arguments
- [ ] Convert user prompts to `--prompt` arguments  
- [ ] Replace model configurations with `--models` lists
- [ ] Convert file processing to `--file` or batch processing
- [ ] Migrate schemas to DSL or external schema files
- [ ] Add appropriate timeout and concurrency settings

### Post-Migration Validation
- [ ] Test CLI command produces expected results
- [ ] Verify schema validation works correctly (if used)
- [ ] Confirm all models execute successfully
- [ ] Check output format matches expectations
- [ ] Validate batch processing handles all files
- [ ] Test resume functionality for large batches

## Benefits Realized After Migration

### Example: Image Feature Extraction

**Before Migration:**
- Manual TypeScript compilation required
- No built-in batch processing
- Basic error handling
- Manual result organization

**After Migration:**
- Direct CLI execution
- Built-in concurrent batch processing  
- Automatic error recovery and resume
- Organized output with reports

```bash
# Enhanced functionality not available in original script
umwelten eval batch \
  --prompt "Extract detailed image features" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --directory "./images" \
  --file-pattern "*.{jpg,png}" \
  --schema "description, objects array, colors array, scene_type, confidence number" \
  --id "enhanced-image-features" \
  --concurrent \
  --max-concurrency 4 \
  --resume
```

### Result Management

The CLI provides automatic result organization:

```
output/evaluations/enhanced-image-features/
├── responses/
│   ├── image1.jpg/
│   │   ├── google_gemini-2.0-flash.json
│   │   └── ollama_qwen2.5vl_latest.json
│   └── image2.jpg/
│       ├── google_gemini-2.0-flash.json
│       └── ollama_qwen2.5vl_latest.json
└── reports/
    ├── results.html
    ├── results.md
    └── results.csv
```

## Common Issues and Solutions

### Issue: Complex Data Processing

**Problem**: Script performs complex data transformation before model processing.

**Solution**: Use external preprocessing and file input:

```bash
# Preprocess data with separate script/tool
node preprocess-data.js input.json > processed-data.json

# Use processed data with CLI
umwelten eval run \
  --prompt "Analyze this processed data" \
  --file "./processed-data.json" \
  --models "google:gemini-2.0-flash" \
  --id "processed-analysis"
```

### Issue: Dynamic Model Selection

**Problem**: Script chooses models based on content analysis.

**Solution**: Use multiple CLI commands or model cascading:

```bash
# First: Quick analysis to determine complexity
umwelten eval run \
  --prompt "Rate the complexity of this task (1-10)" \
  --models "google:gemini-2.0-flash" \
  --schema "complexity int: 1-10, reasoning" \
  --id "complexity-assessment"

# Then: Use appropriate model based on results
umwelten eval run \
  --prompt "Detailed analysis of complex topic" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "detailed-analysis"
```

### Issue: Custom Result Processing

**Problem**: Script has custom logic for processing model responses.

**Solution**: Use CLI for generation, external scripts for processing:

```bash
# Generate responses with CLI
umwelten eval run \
  --prompt "Generate analysis" \
  --models "google:gemini-2.0-flash" \
  --format json \
  --id "raw-analysis"

# Process results with custom script
node process-results.js output/evaluations/raw-analysis/responses/
```

## Next Steps

- Review [Migration Status](/migration/status) to see what's been migrated
- Check [Completed Migrations](/migration/completed) for successful examples
- See [Examples](/examples/) for CLI usage patterns
- Try the [Interactive Tutorial](/guide/getting-started) to get familiar with CLI commands