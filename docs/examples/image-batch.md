# Batch Image Processing

This example demonstrates how to process multiple images concurrently using Umwelten's batch processing capabilities. This corresponds to the migrated `image-feature-batch.ts` script functionality.

## Basic Batch Processing

### Simple Batch Image Analysis

Process all images in a directory with the same prompt across multiple models:

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Analyze this image and describe key features including: objects, colors, composition, and any notable characteristics." \
  --models "google:gemini-3-flash-preview,ollama:qwen2.5vl:latest" \
  --id "image-batch-analysis" \
  --directory "input/images" \
  --file-pattern "*.{jpg,jpeg,png}" \
  --concurrent \
  --max-concurrency 3
```

### Structured Feature Extraction (Full Migration)

This is the complete CLI equivalent of the original `image-feature-batch.ts` script:

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Analyze this image and extract features including: able_to_parse (boolean), image_description (string), contain_text (boolean), color_palette (warm/cool/monochrome/earthy/pastel/vibrant/neutral/unknown), aesthetic_style (realistic/cartoon/abstract/clean/vintage/moody/minimalist/unknown), time_of_day (day/night/unknown), scene_type (indoor/outdoor/unknown), people_count (number), dress_style (fancy/casual/unknown). Return as JSON with confidence scores." \
  --models "google:gemini-3-flash-preview,ollama:qwen2.5vl:latest" \
  --id "image-feature-batch" \
  --directory "input/images" \
  --file-pattern "*.jpeg" \
  --concurrent \
  --max-concurrency 5
```

### With Schema Validation

Use structured output validation for consistent results:

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Extract structured image features with confidence scores" \
  --models "google:gemini-3-flash-preview,google:gemini-1.5-flash-8b" \
  --id "structured-image-batch" \
  --directory "input/images" \
  --file-pattern "*.{jpg,jpeg,png,webp}" \
  --zod-schema "./schemas/image-feature-schema.ts" \
  --concurrent \
  --validate-output \
  --coerce-types
```

## Advanced Batch Processing

### Different File Patterns

Target specific file types or naming patterns:

```bash
# Process only high-resolution images
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Analyze this high-resolution image for technical quality" \
  --models "google:gemini-3-flash-preview" \
  --id "high-res-batch" \
  --directory "photos/high-res" \
  --file-pattern "*_4k.jpg" \
  --concurrent

# Process screenshots separately
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Analyze this screenshot and extract any visible text or UI elements" \
  --models "google:gemini-3-flash-preview" \
  --id "screenshot-batch" \
  --directory "screenshots" \
  --file-pattern "screenshot_*.png" \
  --concurrent
```

### Recursive Directory Processing

Process images in subdirectories:

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Categorize this image by content type and quality" \
  --models "google:gemini-3-flash-preview,ollama:qwen2.5vl:latest" \
  --id "recursive-image-batch" \
  --directory "media" \
  --file-pattern "**/*.{jpg,png}" \
  --concurrent \
  --max-concurrency 4
```

### File Limit Controls

Process a limited number of files for testing:

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Analyze this image for content moderation" \
  --models "google:gemini-3-flash-preview" \
  --id "moderation-test" \
  --directory "user-uploads" \
  --file-pattern "*.jpg" \
  --file-limit 10 \
  --concurrent
```

## Interactive Batch Processing

### Real-time Progress Monitoring

Watch batch processing progress in real-time:

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Extract detailed metadata from this image" \
  --models "google:gemini-3-flash-preview,ollama:qwen2.5vl:latest" \
  --id "metadata-extraction" \
  --directory "photo-library" \
  --file-pattern "*.{jpg,jpeg}" \
  --ui \
  --concurrent \
  --max-concurrency 3
```

## Generate Comprehensive Reports

### Markdown Report with Image Analysis

```bash
# Generate detailed markdown report
dotenvx run -- pnpm run cli -- eval report --id image-feature-batch --format markdown
```

### HTML Report with Embedded Previews

```bash
# Generate HTML report with rich formatting
dotenvx run -- pnpm run cli -- eval report --id structured-image-batch --format html --output batch-report.html
```

### CSV Export for Analysis

```bash
# Export structured data for further analysis
dotenvx run -- pnpm run cli -- eval report --id structured-image-batch --format csv --output image-data.csv
```

## Expected Output Structure

### Directory Structure After Processing

```
output/evaluations/image-feature-batch/
├── responses/
│   ├── image1.jpg/
│   │   ├── google_gemini-3-flash-preview.json
│   │   └── ollama_qwen2.5vl_latest.json
│   ├── image2.jpg/
│   │   ├── google_gemini-3-flash-preview.json
│   │   └── ollama_qwen2.5vl_latest.json
│   └── image3.jpg/
│       ├── google_gemini-3-flash-preview.json
│       └── ollama_qwen2.5vl_latest.json
└── reports/
    ├── results.md
    └── results.html
```

### Sample Response JSON

```json
{
  "content": {
    "able_to_parse": {
      "value": true,
      "confidence": 0.98
    },
    "image_description": {
      "value": "A vibrant outdoor scene showing children playing in a park with swings and slides. The setting is during daytime with clear blue skies and green grass.",
      "confidence": 0.92
    },
    "contain_text": {
      "value": false,
      "confidence": 0.95
    },
    "color_palette": {
      "value": "vibrant",
      "confidence": 0.88
    },
    "aesthetic_style": {
      "value": "realistic",
      "confidence": 0.94
    },
    "time_of_day": {
      "value": "day",
      "confidence": 0.97
    },
    "scene_type": {
      "value": "outdoor",
      "confidence": 0.96
    },
    "people_count": {
      "value": 3,
      "confidence": 0.85
    },
    "dress_style": {
      "value": "casual",
      "confidence": 0.89
    }
  },
  "metadata": {
    "model": "gemini-3-flash-preview",
    "provider": "google",
    "filename": "playground_scene.jpg",
    "startTime": "2025-01-27T18:30:15.123Z",
    "endTime": "2025-01-27T18:30:18.456Z",
    "tokenUsage": {
      "promptTokens": 45,
      "completionTokens": 156,
      "total": 201
    },
    "cost": {
      "promptCost": 0.00000338,
      "completionCost": 0.0000468,
      "totalCost": 0.00005018
    }
  }
}
```

## Performance Comparison Report

### Sample Batch Processing Report

```markdown
# Batch Image Processing Report: image-feature-batch

**Generated:** 2025-01-27T19:15:00.000Z  
**Total Images:** 25
**Total Models:** 2
**Processing Mode:** Concurrent (max 5)

## Summary Statistics

| Model | Provider | Images Processed | Avg Time/Image | Total Cost | Success Rate |
|-------|----------|------------------|----------------|------------|--------------|
| gemini-3-flash-preview | google | 25 | 3.2s | $0.001254 | 100% |
| qwen2.5vl:latest | ollama | 25 | 4.8s | Free | 96% |

## Processing Performance

- **Total Processing Time:** 4m 32s
- **Sequential Time Estimate:** 15m 45s  
- **Speedup with Concurrency:** 3.5x faster
- **Average Images/Second:** 0.92
- **Peak Memory Usage:** 245 MB

## Image Analysis Results

### Feature Extraction Quality

| Feature | Gemini 2.0 Avg Confidence | Qwen2.5VL Avg Confidence | Notes |
|---------|---------------------------|--------------------------|-------|
| able_to_parse | 0.97 | 0.94 | Excellent across both models |
| image_description | 0.91 | 0.87 | Gemini more detailed |
| contain_text | 0.94 | 0.89 | Strong OCR detection |
| color_palette | 0.86 | 0.83 | Good color analysis |
| people_count | 0.82 | 0.78 | Most challenging feature |

### Error Analysis

- **Processing Errors:** 1/50 total evaluations (2%)
- **Validation Errors:** 0/50 (100% schema compliance)
- **Common Issues:** People counting in crowded scenes
- **Recovery Rate:** 100% (all errors automatically retried)

### File Type Performance

| Format | Count | Success Rate | Avg Processing Time |
|--------|-------|--------------|-------------------|
| JPEG | 18 | 100% | 3.4s |
| PNG | 6 | 100% | 4.1s |
| WebP | 1 | 100% | 3.8s |

## Cost Analysis

- **Google Gemini 2.0 Flash:** $0.001254 total
- **Ollama qwen2.5vl:** Free (local processing)
- **Cost per Image:** $0.000050 (Google only)
- **Cost vs. Quality:** Google provides 15% better accuracy for minimal cost
```

## Advanced Patterns

### Resume Interrupted Processing

Resume batch processing from where it left off:

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Continue batch processing" \
  --models "google:gemini-3-flash-preview" \
  --id "image-feature-batch" \
  --directory "input/images" \
  --file-pattern "*.jpg" \
  --resume \
  --concurrent
```

### Different Prompts for Different Models

Use model-specific strengths:

```bash
# Detailed analysis with expensive model
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Provide comprehensive artistic and technical analysis" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "detailed-analysis" \
  --directory "art-collection" \
  --file-pattern "*.jpg" \
  --file-limit 5

# Quick categorization with fast model  
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Categorize: portrait/landscape/object/abstract" \
  --models "google:gemini-3-flash-preview" \
  --id "quick-categorization" \
  --directory "mixed-images" \
  --file-pattern "*.jpg" \
  --concurrent \
  --max-concurrency 8
```

### Error Handling and Validation

Robust processing with validation:

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Extract image features with validation" \
  --models "google:gemini-3-flash-preview,ollama:qwen2.5vl:latest" \
  --id "robust-batch" \
  --directory "user-uploads" \
  --file-pattern "*.{jpg,png}" \
  --zod-schema "./schemas/image-feature-schema.ts" \
  --validate-output \
  --strict-validation \
  --concurrent \
  --timeout 30000
```

## Tips for Effective Batch Processing

### Optimization Strategies

1. **Concurrency Tuning**
   - Start with 3-5 concurrent processes
   - Monitor system resources (CPU, memory, network)
   - Increase gradually based on performance

2. **File Organization**
   - Use descriptive directory structures
   - Group similar images together
   - Use consistent naming conventions

3. **Model Selection**
   - Google Gemini: Best for detailed analysis and OCR
   - Ollama qwen2.5vl: Best for privacy and cost-free processing
   - Mix models for cost vs. quality optimization

### Common Pitfalls

1. **Too High Concurrency**: Can overwhelm API rate limits
2. **Large Images**: May cause timeouts, consider preprocessing
3. **Mixed File Types**: Different formats may have different processing times
4. **Schema Validation**: Test schemas on single images first

### Best Practices

- Test with small batches first (`--file-limit 5`)
- Use `--ui` flag for monitoring large batches
- Enable resume capability for long-running jobs
- Validate schemas before large batch runs
- Monitor costs with paid providers
- Use meaningful evaluation IDs for organization

## Migration Benefits vs Original Script

### Enhanced Performance
- ✅ **3-5x faster** with concurrent processing
- ✅ **Resume capability** for interrupted jobs
- ✅ **Better error handling** with automatic retries
- ✅ **Progress monitoring** with interactive UI

### Improved User Experience
- ✅ **Consistent interface** across all batch operations
- ✅ **Multiple report formats** (MD, HTML, JSON, CSV)
- ✅ **Cost transparency** with integrated pricing
- ✅ **Flexible file patterns** and directory scanning

### Better Maintainability
- ✅ **No custom code** required for new use cases
- ✅ **Standardized output** format and structure
- ✅ **Built-in validation** and error reporting
- ✅ **Easy extension** through configuration

## Next Steps

- Try [structured image features](/examples/image-features) for single image analysis
- Explore [cost optimization](/examples/cost-optimization) for budget-conscious batches  
- See [migration guide](/migration/) for converting other batch scripts