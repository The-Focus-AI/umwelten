# Script Migration Overview

This section documents the migration of evaluation scripts from the `scripts/` directory to CLI commands. The migration provides enhanced functionality, better error handling, and a consistent interface while maintaining all original capabilities.

## Migration Status

### ✅ Fully Migrated Scripts

These scripts have been completely replaced by CLI commands:

| Script | Primary Example | CLI Command | Status |
|--------|----------------|-------------|---------|
| `cat-poem.ts` | [Creative Writing](/examples/creative-writing) | `eval run` | ✅ Complete |
| `temperature.ts` | [Creative Writing](/examples/creative-writing) | `eval run --temperature` | ✅ Complete |
| `frankenstein.ts` | [Analysis & Reasoning](/examples/analysis-reasoning) | `eval run` | ✅ Complete |
| `google-pricing.ts` | [Cost Optimization](/examples/cost-optimization) | `eval run` + `eval report` | ✅ Complete |
| `image-parsing.ts` | [Basic Image Analysis](/examples/image-analysis) | `eval run --attach` | ✅ Complete |
| `image-feature-extract.ts` | [Structured Image Features](/examples/image-features) | `eval run --zod-schema` | ✅ Complete |
| `image-feature-batch.ts` | [Batch Image Processing](/examples/image-batch) | `eval batch` | ✅ Complete |
| `pdf-identify.ts` | [PDF Analysis](/examples/pdf-analysis) | `eval run --attach` | ✅ Complete |
| `pdf-parsing.ts` | [PDF Analysis](/examples/pdf-analysis) | `eval run --attach` | ✅ Complete |

### 🔄 Partially Migrated Scripts

These scripts work with CLI but may need additional features:

| Script | Status | Missing Features | Workaround |
|--------|--------|------------------|------------|
| `roadtrip.ts` | Basic functionality works | Complex nested schema validation | Use simpler schema or JSON Schema files |
| `multi-language-evaluation.ts` | Core evaluation works | Pipeline orchestration commands | Run evaluation phases separately |

### 📋 Complex Scripts Needing Specialized Commands

These scripts require additional CLI development:

| Script | Required Features | Priority |
|--------|------------------|----------|
| `transcribe.ts` | Audio file attachment support | Low |
| `site-info.ts` | URL input and web scraping | Medium |
| `analyze-docker-outputs.ts` | Docker execution result analysis | Low |
| `test-multi-language.ts` | Test framework integration | Low |

## Migration Benefits

### Enhanced Features
- **Concurrent Processing**: Up to 20x faster execution with `--concurrent`
- **Interactive UI**: Real-time progress with `--ui` flag
- **Better Error Handling**: Comprehensive validation and helpful troubleshooting
- **Cost Transparency**: Accurate cost calculations with integrated pricing
- **Resume Capability**: Skip completed evaluations unless `--resume` is specified
- **Multiple Report Formats**: Markdown, HTML, JSON, CSV outputs

### Consistent Interface
- Unified command structure across all evaluation types
- Standardized options and flags
- Comprehensive help documentation
- Predictable output formats and directory structure

### Improved Developer Experience
- No need to modify scripts for different use cases
- Better debugging with detailed error messages
- Integrated validation and type checking
- Easy extensibility through configuration

## Quick Migration Examples

### Before (Script) vs After (CLI)

#### Simple Text Evaluation

**Before (`cat-poem.ts`):**
```typescript
const runner = new EvaluationRunner("cat-poem");
await runner.evaluate({ name: "gemma3:27b", provider: "ollama" });
await runner.evaluate({ name: "gemini-2.0-flash", provider: "google" });
// ... custom reporting logic
```

**After (CLI):**
```bash
umwelten eval run \
  --prompt "Write a short poem about a cat" \
  --models "ollama:gemma3:27b,google:gemini-2.0-flash" \
  --id "cat-poem" \
  --system "You are a helpful assistant that writes short poems about cats."

umwelten eval report --id cat-poem --format markdown
```

#### Image Analysis

**Before (`image-parsing.ts`):**
```typescript
const imagePath = path.resolve("input/images/test.png");
const runner = new ImageParser("image-parsing", imagePath);
await runner.evaluate({ name: "gemini-2.0-flash", provider: "google" });
// ... custom scoring and reporting
```

**After (CLI):**
```bash
umwelten eval run \
  --prompt "Analyze this image and provide a summary of the content" \
  --models "google:gemini-2.0-flash" \
  --id "image-analysis" \
  --attach "./input/images/test.png"

umwelten eval report --id image-analysis --format html --output report.html
```

#### Structured Data Extraction

**Before (`image-feature-extract.ts`):**
```typescript
const response = await imageFeatureExtract(imagePath, model);
const validation = ImageFeatureSchema.parse(response.content);
// ... custom validation and reporting
```

**After (CLI):**
```bash
umwelten eval run \
  --prompt "Extract structured image features" \
  --models "google:gemini-2.0-flash" \
  --id "image-features" \
  --attach "./image.jpg" \
  --zod-schema "./schemas/image-feature-schema.ts" \
  --validate-output
```

## Migration Guide

### Step 1: Identify Script Type
- **Simple Evaluation**: Use `eval run`
- **Batch Processing**: Use `eval batch` 
- **Structured Output**: Add `--schema` or `--zod-schema`
- **Multi-modal**: Add `--attach` for files

### Step 2: Map Script Parameters
- **Models**: Convert to `--models "provider:model,provider2:model2"`
- **Prompts**: Use `--prompt` and `--system`
- **Temperature**: Use `--temperature`
- **Files**: Use `--attach` for images, PDFs, documents

### Step 3: Configure Output
- **Evaluation ID**: Use meaningful `--id` values
- **Concurrency**: Add `--concurrent` for faster execution
- **UI**: Add `--ui` for interactive progress
- **Validation**: Add schema flags for structured output

### Step 4: Generate Reports
- Replace custom reporting with `eval report`
- Use `--format` for different output types
- Use `--output` to save reports to files

## Testing Migration

### Verify Equivalent Output
```bash
# Run original script
pnpm run script-name

# Run CLI equivalent  
umwelten eval run [options]

# Compare outputs
umwelten eval report --id evaluation-id --format json
```

### Performance Comparison
```bash
# Measure CLI performance with timing
time umwelten eval run [options] --concurrent

# Compare with original script timing
time pnpm run script-name
```

## Common Migration Patterns

### Pattern 1: Simple Model Comparison
```bash
# Replace any script that tests multiple models
umwelten eval run \
  --prompt "Your evaluation prompt" \
  --models "model1,model2,model3" \
  --id "comparison-test" \
  --concurrent
```

### Pattern 2: File Processing
```bash
# Replace scripts that process files
umwelten eval run \
  --prompt "Analyze this file" \
  --models "vision-model" \
  --id "file-analysis" \
  --attach "./file.ext"
```

### Pattern 3: Batch Operations
```bash
# Replace scripts that process multiple files
umwelten eval batch \
  --prompt "Process this file" \
  --models "model1,model2" \
  --id "batch-process" \
  --directory "./input" \
  --file-pattern "*.ext"
```

### Pattern 4: Structured Output
```bash
# Replace scripts with custom schemas
umwelten eval run \
  --prompt "Extract data" \
  --models "smart-model" \
  --id "structured-extract" \
  --zod-schema "./schema.ts"
```

## Next Steps

- Review [completed migrations](/migration/completed) for detailed examples
- Check [migration status](/migration/status) for current progress
- See [examples](/examples/) for CLI equivalents of your use cases
- Contribute to remaining migrations in our [GitHub repository](https://github.com/The-Focus-AI/umwelten)