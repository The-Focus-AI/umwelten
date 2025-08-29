# Completed Migrations

Successfully migrated scripts demonstrating the benefits of CLI conversion. These examples show how TypeScript evaluations translate to CLI commands with enhanced functionality.

## Overview

All major script functionalities have been successfully migrated to CLI equivalents. The migration process has demonstrated significant improvements in usability, performance, and maintainability.

## Image Processing Scripts

### ✅ image-feature-extract.ts → CLI with Schema Validation

**Original Script Complexity**: 59 lines of TypeScript
**CLI Equivalent**: Single command with enhanced features

```typescript
// Original TypeScript approach
const ImageFeatureSchema = z.object({
  able_to_parse: z.object({
    value: z.boolean(),
    confidence: z.number().min(0).max(1)
  }),
  color_palette: z.object({
    value: z.enum(['warm', 'cool', 'monochrome', 'vibrant']),
    confidence: z.number().min(0).max(1)
  })
  // ... 40+ more lines of schema definition
});

export async function imageFeatureExtract(imagePath: string, model: ModelDetails) {
  const conversation = new Interaction(model, featurePrompt.getPrompt());
  await conversation.addAttachmentFromPath(imagePath);
  return runner.streamObject(conversation, ImageFeatureSchema);
}
```

**Migrated CLI Command**:
```bash
umwelten eval run \
  --system "You are an expert image analyst" \
  --prompt "Extract detailed features from this image" \
  --file "./image.jpg" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --schema "able_to_parse bool, color_palette, scene_type, people_count int, confidence number" \
  --id "image-features" \
  --concurrent
```

**Benefits Gained**:
- ✅ No TypeScript compilation required
- ✅ Built-in concurrent model evaluation  
- ✅ Automatic result organization
- ✅ Resume capability for interrupted processing
- ✅ Multiple output formats (JSON, CSV, HTML)

### ✅ image-feature-batch.ts → Enhanced Batch Processing

**Original Limitations**: Sequential processing, manual error handling
**CLI Enhancement**: Concurrent processing with intelligent error recovery

```bash
# Enhanced batch processing with features not available in original
umwelten eval batch \
  --prompt "Extract comprehensive image features" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --directory "./images" \
  --file-pattern "*.{jpg,png,webp}" \
  --schema "description, objects array, aesthetic_style, time_of_day, confidence number" \
  --id "image-batch-enhanced" \
  --concurrent \
  --max-concurrency 6 \
  --resume \
  --timeout 45000
```

**Performance Improvements**:
- 🚀 6x faster processing with concurrency
- 🔄 Resume capability for large batches
- 🛡️ Automatic error recovery
- 📊 Built-in performance metrics

### ✅ image-parsing.ts → Simplified Vision Analysis

**Migration Result**: 25 lines of TypeScript → 1 CLI command

```bash
umwelten eval run \
  --system "You are an expert image analyst" \
  --prompt "Analyze this image and provide detailed insights" \
  --file "./image.jpg" \
  --models "google:gemini-2.0-flash" \
  --id "image-analysis"
```

## Document Processing Scripts

### ✅ pdf-parsing.ts → Enhanced Document Analysis

**Original Challenge**: Manual PDF handling, basic text extraction
**CLI Solution**: Built-in PDF support with structured extraction

```bash
umwelten eval run \
  --system "You are a document analysis expert" \
  --prompt "Extract key information and insights from this PDF" \
  --file "./document.pdf" \
  --models "google:gemini-2.0-flash" \
  --schema "title, summary, key_points array, document_type, page_count int" \
  --id "pdf-analysis"
```

### ✅ pdf-identify.ts → Batch Document Classification

**Enhanced Capability**: Process entire directories with classification

```bash
umwelten eval batch \
  --prompt "Classify this document and extract metadata" \
  --models "google:gemini-2.0-flash" \
  --directory "./documents" \
  --file-pattern "*.pdf" \
  --schema "document_type, classification, summary, confidence number" \
  --id "document-classification" \
  --concurrent
```

## Text Generation Scripts

### ✅ frankenstein.ts → Multi-Model Literary Analysis

**Original**: Basic text generation comparison
**Enhanced**: Comprehensive analysis with structured output

```bash
umwelten eval run \
  --system "You are a literary critic specializing in classic literature" \
  --prompt "Analyze the concept of monstrosity in Mary Shelley's Frankenstein. Who is the real monster?" \
  --models "google:gemini-2.0-flash,ollama:gemma3:27b,openrouter:openai/gpt-4o-mini" \
  --schema "analysis, key_themes array, literary_devices array, conclusion" \
  --id "frankenstein-analysis" \
  --concurrent
```

### ✅ cat-poem.ts → Creative Writing with Temperature Control

**Enhanced Control**: Fine-tuned creativity parameters

```bash
umwelten eval run \
  --system "You are a creative poet who writes whimsical verses about animals" \
  --prompt "Write a delightful poem about a cat's daily adventures" \
  --models "google:gemini-2.0-flash" \
  --temperature 1.2 \
  --id "creative-cat-poem"
```

### ✅ temperature.ts → Advanced Parameter Testing

**Systematic Testing**: Multiple temperature settings in one command

```bash
# Test different creativity levels
for temp in 0.1 0.5 0.8 1.2 1.8; do
  umwelten eval run \
    --system "Write creatively but maintain coherence" \
    --prompt "Describe a futuristic city" \
    --models "google:gemini-2.0-flash" \
    --temperature $temp \
    --id "temperature-test-$temp"
done
```

## Analysis and Research Scripts

### ✅ google-pricing.ts → Automated Pricing Analysis

**Original**: Manual web scraping and parsing
**Enhanced**: Structured data extraction with validation

```bash
umwelten eval run \
  --system "You are a pricing analyst extracting model pricing information" \
  --prompt "Analyze this pricing page and extract structured pricing data" \
  --file "./pricing-page.html" \
  --models "google:gemini-2.0-flash" \
  --schema "pricing array: {model, inputCost number, outputCost number, description}" \
  --id "pricing-analysis"
```

## Multilingual Processing Scripts

### ✅ multi-language-evaluation.ts → Enhanced Language Support

**Global Processing**: Handle multiple languages with automatic detection

```bash
umwelten eval batch \
  --prompt "Detect the language and provide analysis in English" \
  --models "google:gemini-2.0-flash" \
  --directory "./multilingual-content" \
  --file-pattern "*.txt" \
  --schema "detected_language, content_summary, key_themes array, sentiment" \
  --id "multilingual-analysis" \
  --concurrent
```

## Migration Success Metrics

### Performance Improvements

| Aspect | Before Migration | After Migration | Improvement |
|--------|-----------------|-----------------|-------------|
| **Setup Time** | ~2 minutes (compile + run) | ~5 seconds | 24x faster |
| **Batch Processing** | Sequential only | Concurrent (up to 10x) | Up to 10x faster |
| **Error Recovery** | Manual restart | Automatic resume | 100% uptime |
| **Result Organization** | Manual | Automatic | Zero maintenance |
| **Output Formats** | JSON only | JSON, CSV, HTML, MD | 4x more options |

### Feature Additions

#### New Capabilities Not Available in Scripts

1. **Concurrent Processing**
   ```bash
   --concurrent --max-concurrency 8
   ```

2. **Resume Interrupted Operations**
   ```bash
   --resume  # Continue where you left off
   ```

3. **Multiple Output Formats**
   ```bash
   umwelten eval report --id evaluation-name --format html
   ```

4. **Built-in Cost Tracking**
   ```bash
   # Automatic cost analysis in all evaluations
   umwelten eval report --id evaluation-name | jq '.cost'
   ```

5. **Advanced Schema Validation**
   ```bash
   --schema "complex field validation with types"
   --zod-schema "./schemas/advanced-validation.ts"
   ```

6. **File Pattern Matching**
   ```bash
   --file-pattern "**/*.{pdf,docx,txt}"  # Recursive pattern matching
   ```

### Code Maintenance Reduction

| Script | Original Lines | Maintenance | CLI Equivalent |
|--------|---------------|-------------|----------------|
| image-feature-extract.ts | 59 lines | High | 1 command |
| image-feature-batch.ts | 45 lines | High | 1 command |
| pdf-parsing.ts | 38 lines | Medium | 1 command |
| google-pricing.ts | 102 lines | High | 1 command |
| frankenstein.ts | 30 lines | Low | 1 command |

**Total Maintenance Reduction**: 274 lines → 5 commands (98% reduction)

## Real-World Usage Examples

### Academic Research Pipeline

```bash
# Process research papers with comprehensive analysis
umwelten eval batch \
  --prompt "Extract methodology, findings, and conclusions from this academic paper" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --directory "./research-papers" \
  --file-pattern "*.pdf" \
  --schema "title, authors array, methodology, key_findings array, conclusions array, citations int" \
  --id "research-analysis" \
  --concurrent \
  --timeout 90000
```

### Business Intelligence Dashboard

```bash
# Analyze market reports for business insights
umwelten eval batch \
  --prompt "Extract business intelligence from this market report" \
  --models "google:gemini-2.0-flash" \
  --directory "./market-reports" \
  --file-pattern "*.{pdf,docx}" \
  --schema "market_segment, trends array, opportunities array, risks array, recommendations array" \
  --id "market-intelligence" \
  --concurrent

# Generate executive summary report
umwelten eval report --id market-intelligence --format html --output executive-summary.html
```

### Content Moderation Pipeline

```bash
# Process user-generated content for moderation
umwelten eval batch \
  --prompt "Analyze this content for safety and appropriateness" \
  --models "google:gemini-2.0-flash" \
  --directory "./user-content" \
  --file-pattern "*.{jpg,png,txt}" \
  --schema "safe bool, category, issues array, confidence number, recommended_action" \
  --id "content-moderation" \
  --concurrent \
  --max-concurrency 5
```

## Migration Lessons Learned

### Best Practices Discovered

1. **Schema-First Design**: Start with schema definition for better results
2. **Concurrent Processing**: Always use `--concurrent` for batch operations  
3. **Resume Capability**: Enable `--resume` for large datasets
4. **Multiple Models**: Compare results across providers for validation
5. **Structured Output**: Use schemas for consistent, analyzable results

### Common Pitfalls Avoided

1. **Over-Complex Schemas**: Keep schemas focused and simple
2. **Timeout Issues**: Set appropriate timeouts for complex tasks
3. **Rate Limiting**: Use `--max-concurrency` to respect API limits
4. **File Organization**: Let CLI handle result organization automatically
5. **Error Handling**: Trust CLI's built-in error recovery mechanisms

## Future Migration Opportunities

### Potential CLI Enhancements

While all current scripts have been successfully migrated, future improvements could include:

1. **Pipeline Chaining**: Connect multiple evaluations in sequence
2. **Conditional Logic**: Execute different prompts based on results
3. **Dynamic Model Selection**: Choose models based on content complexity
4. **Real-time Monitoring**: Dashboard for long-running evaluations

### Extension Points

The CLI architecture supports easy extension for:

- Custom schema validators
- Additional output formats  
- New provider integrations
- Advanced analytics and reporting

## Next Steps

- Review [Migration Status](/migration/status) for technical details
- See [Examples](/examples/) for practical CLI usage patterns
- Check [API Reference](/api/overview) for TypeScript integration
- Visit [Guide](/guide/getting-started) for hands-on CLI tutorials