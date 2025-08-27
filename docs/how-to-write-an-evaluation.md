# How to Write an Evaluation Script

This guide explains how to write evaluation scripts for running data through multiple models and comparing their outputs. It covers both the legacy script-based approach and the new CLI-based structured schema evaluations.

## Quick Start: CLI-Based Evaluations (Recommended)

For most use cases, use the CLI with structured schemas instead of writing custom scripts:

```bash
# Simple structured evaluation
umwelten eval run \
  --prompt "Extract person information from: John Smith, age 25, works at Google" \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o-mini" \
  --id "person-extraction" \
  --schema "name, age int, company"

# Generate report
umwelten eval report --id person-extraction
```

For complex custom evaluations, you can still write scripts using the patterns below.

-   **Core Logic Script (e.g., `image-feature-extract.ts`):** A file that defines a single, reusable task. It contains the prompt, the Zod schema for the expected output, and a function that takes an input (like an image path) and returns a model response.
-   **Orchestrator Script (e.g., `image-feature-batch.ts`):** A file that manages the evaluation process. It defines the list of models and inputs, calls the core logic for each combination, and handles scoring and reporting.

---

## Modern Approach: Schema-Based Evaluations

### Using Built-in Templates

```bash
# Person extraction using built-in template
umwelten eval run \
  --prompt "Extract contact info from this business card" \
  --models "google:gemini-2.0-flash" \
  --id "business-card-extraction" \
  --schema-template contact \
  --attach "./business_card.jpg"
```

### Custom DSL Schemas

```bash
# Financial data extraction
umwelten eval run \
  --prompt "Extract Q3 financial metrics from this report" \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o" \
  --id "financial-metrics" \
  --schema "quarter int, revenue num: revenue in millions, profit num, growth num: growth percentage" \
  --attach "./q3-report.pdf"
```

### Advanced Zod Schemas

For complex validation, create a Zod schema file:

```typescript
// schemas/product-analysis.ts
import { z } from 'zod';

export const schema = z.object({
  productName: z.string().describe('Product name'),
  category: z.string().describe('Product category'),
  price: z.number().positive().describe('Price in dollars'),
  features: z.array(z.string()).describe('Key features'),
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  competitors: z.array(z.object({
    name: z.string(),
    price: z.number().positive()
  })).optional(),
  recommendation: z.enum(['buy', 'wait', 'avoid'])
});
```

```bash
umwelten eval run \
  --prompt "Analyze this product review and extract structured information" \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o-mini" \
  --id "product-analysis" \
  --zod-schema "./schemas/product-analysis.ts" \
  --validate-output \
  --coerce-types
```

### Schema Evaluation Benefits

- **Consistent Output**: Same structure across all models
- **Automatic Validation**: Built-in type checking and error reporting  
- **Type Coercion**: Convert "25" to 25, "true" to true automatically
- **Rich Reports**: Validation success rates and common errors
- **No Custom Code**: Define schema, run evaluation, get results

---

## Custom Scripts (Advanced Use Cases)

For scenarios requiring custom logic, file processing, or complex orchestration, write custom evaluation scripts.

## 1. **Best Practices: Use the Framework**
- **Always use the provided base classes and helpers:**
  - `evaluate()`: A utility that wraps a single evaluation run, handling caching and saving the output file correctly.
  - `EvaluationScorer`: The base class for scoring model responses against ground truth.
  - `EvaluationReporter`: The base class for generating human-readable reports from the collected responses.
- **This ensures:**
  - DRY, maintainable code.
  - Consistent output structure.
  - Automatic caching and reuse of model responses.
  - Easy integration with reporting tools.

---

## 2. Script Structure & CLI Usage
- Each evaluation is a standalone script in `scripts/`, run via a CLI command (e.g., `pnpm tsx scripts/image-feature-batch.ts extract`).
- Scripts should support multiple commands for different stages of the process, such as `extract`, `score`, and `report`.

---

## 3. Example: A Complete Image Feature Evaluation

### Step 1: Define the Core Logic (`image-feature-extract.ts`)

First, define the schema for the data you want to extract and create a function to perform the extraction for a single input.

```ts
// scripts/image-feature-extract.ts
import { z } from 'zod';
import { Prompt } from '../src/conversation/prompt.js';
import { ModelDetails, ModelResponse } from '../src/models/types.js';
import { Conversation } from '../src/conversation/conversation.js';
import { BaseModelRunner } from '../src/models/runner.js';

// 1. Define the output schema with Zod
export const ImageFeatureSchema = z.object({
  color_palette: z.object({
    value: z.enum(["warm", "cool", "neutral", "unknown"]),
    confidence: z.number().min(0).max(1),
  }),
  people_count: z.object({
    value: z.number().int(),
    confidence: z.number().min(0).max(1),
  }),
  // ... other features
});

// 2. Create a reusable extraction function
const featurePrompt = new Prompt('You are an expert image analyst. Given an image, extract features and return them as a JSON object.');

export async function imageFeatureExtract(imagePath: string, model: ModelDetails): Promise<ModelResponse> {
  const conversation = new Conversation(model, featurePrompt.getPrompt());
  await conversation.addAttachmentFromPath(imagePath);
  const runner = new BaseModelRunner();
  return runner.streamObject(conversation, ImageFeatureSchema);
}
```

### Step 2: Create the Orchestrator (`image-feature-batch.ts`)

This script runs the core logic across multiple models and images, and also handles reporting.

```ts
// scripts/image-feature-batch.ts
import fs from 'fs';
import path from 'path';
import { evaluate } from '../src/evaluation/evaluate.js';
import { imageFeatureExtract } from './image-feature-extract.js';
import { ModelDetails, ModelResponse } from '../src/models/types.js';
import { EvaluationReporter } from '../src/evaluation/reporter.js';

const evaluationId = 'image-feature-extraction';

// 1. Define models and inputs
const models: ModelDetails[] = [
  { name: 'gemma3:4b', provider: 'ollama' },
  { name: 'gemini-2.0-flash-lite', provider: 'google' },
];
const inputDir = path.resolve('input/images');

// 2. Create a batch extraction function using the `evaluate` helper
async function batchExtract() {
  const images = fs.readdirSync(inputDir).filter(f => f.endsWith('.jpeg'));
  for (const model of models) {
    for (const image of images) {
      const imagePath = path.join(inputDir, image);
      // The `evaluate` function handles running, caching, and saving
      await evaluate(
        (details) => imageFeatureExtract(imagePath, details),
        evaluationId,
        image, // Used for the output subdirectory
        model
      );
    }
  }
}

// 3. Create a reporter to generate a summary
class ImageFeatureReporter extends EvaluationReporter {
  // ... (Implementation for loading responses and generating a report)
}

// 4. Create a CLI entrypoint
async function main() {
  const mode = process.argv[2];
  if (mode === 'extract') {
    await batchExtract();
  } else if (mode === 'report') {
    // ... call reporter
  }
}

main();
```

---

## 4. Input/Output Structure
- **Inputs**:
  - Data files (e.g., images) should be placed in a dedicated folder, like `input/images/`.
  - Ground truth data, if used, should be in a file like `input/image-feature-extrator/ground_truth.csv`.
- **Outputs**:
  - The `evaluate` helper saves responses to `output/evaluations/<evaluationId>/`.
  - **Crucially, it creates a subdirectory for each input file.**
  - The final structure is: `output/evaluations/<evaluationId>/<input_filename>/<model_name>.json`.
  - Reports should be saved to `output/evaluations/<evaluationId>/reports/`.

---

## 5. Reporting Best Practices
When building a reporter, keep these in mind:

- **Load from Nested Directories**: Your `loadResponses` logic must scan the subdirectories for each input file to find all the JSON results.
- **Image Context**: Always show the image being analyzed in the report for context. Use a relative path from the report file.
- **Feature Comparison**: For comparing models, a table with models as rows and features as columns works well.
- **Performance Metrics**: Include processing time and cost for each run to evaluate model efficiency.
- **Clear Organization**: Group results by image to make comparisons intuitive.

---

## 6. Common Pitfalls
- **Incorrect Output Path**: Forgetting that the `evaluate` helper creates a subdirectory for each input file. Your reporter must account for this nested structure.
- **Manual File Handling**: Writing your own file caching or directory creation logic instead of using the `evaluate` helper.
- **Not Including Context**: Generating reports without including the source image, making it hard to interpret the results.
- **Parsing Without Error Handling**: Not wrapping `JSON.parse()` in a `try...catch` block when processing model responses, which can crash the entire reporting process.

For a full, working example, see the `scripts/image-feature-batch.ts` and `scripts/image-feature-extract.ts` files.

---

## Migrating Existing Scripts to Schema-Based Evaluations

If you have existing Zod-based evaluation scripts, you can easily migrate them to use the CLI approach:

### Before: Custom Script
```typescript
// scripts/person-extraction.ts
import { z } from 'zod';
import { EvaluationRunner } from '../src/evaluation/runner.js';

const PersonSchema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email()
});

class PersonEvaluationRunner extends EvaluationRunner {
  // ... custom implementation
}

// Run manually
const runner = new PersonEvaluationRunner('person-extraction');
await runner.evaluate({ name: 'gemini-2.0-flash', provider: 'google' });
```

### After: CLI with Schema
```bash
# Convert the Zod schema to a file
echo 'import { z } from "zod";
export const schema = z.object({
  name: z.string(),
  age: z.number(), 
  email: z.string().email()
});' > schemas/person.ts

# Run via CLI
umwelten eval run \
  --prompt "Extract person information from this text" \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o-mini" \
  --id "person-extraction" \
  --zod-schema "./schemas/person.ts"
```

### Schema-Based Custom Runners (Advanced)

For custom evaluation logic with schema validation:

```typescript
import { SchemaEvaluationRunner } from '../src/evaluation/schema-runner.js';

class CustomPersonExtractor extends SchemaEvaluationRunner {
  constructor() {
    super('person-extraction', {
      schema: { type: 'zod-file', path: './schemas/person.ts' },
      validateOutput: true,
      coerceOutput: true
    });
  }

  async getModelResponse(details: ModelDetails): Promise<ModelResponse> {
    // Custom extraction logic
    const conversation = new Interaction(details, this.buildPrompt());
    const runner = new BaseModelRunner();
    return runner.streamObject(conversation, await this.getInstructionSchema());
  }
}

// Use the custom runner
const extractor = new CustomPersonExtractor();
await extractor.evaluate({ name: 'gemini-2.0-flash', provider: 'google' });

// Get validation summary
const summary = await extractor.getValidationSummary();
console.log(`Validation success rate: ${summary.validationRate * 100}%`);
```

This approach combines the flexibility of custom scripts with the power of automatic schema validation.