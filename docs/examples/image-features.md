# Structured Image Features

This example demonstrates how to extract structured data from images using Zod schemas for validation. This corresponds to the migrated `image-feature-extract.ts` script functionality.

## Basic Structured Extraction

### Simple Image Features with DSL

Extract basic image features using Umwelten's DSL schema syntax:

```bash
umwelten eval run \
  --prompt "Analyze this image and extract structured features" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "image-features-simple" \
  --attach "./input/images/sample.jpg" \
  --schema "description, contains_text bool, color_palette, scene_type"
```

### Advanced Zod Schema Integration

Use the full Zod schema from the original script for comprehensive feature extraction:

```bash
umwelten eval run \
  --prompt "Analyze this image and extract detailed features with confidence scores" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "image-features-detailed" \
  --attach "./path/to/image.jpg" \
  --zod-schema "./schemas/image-feature-schema.ts"
```

## Creating the Schema File

First, create a schema file based on the original `ImageFeatureSchema`:

```typescript
// schemas/image-feature-schema.ts
import { z } from 'zod';

export const ImageFeatureSchema = z.object({
  able_to_parse: z.object({
    value: z.boolean().describe('Is the model able to parse and analyze the attached image?'),
    confidence: z.number().min(0).max(1).describe('Confidence score (0-1)'),
  }),
  image_description: z.object({
    value: z.string().describe('A detailed description of the image'),
    confidence: z.number().min(0).max(1).describe('Confidence score (0-1)'),
  }),
  contain_text: z.object({
    value: z.boolean().describe('Does the image contain text or subtitles'),
    confidence: z.number().min(0).max(1).describe('Confidence score (0-1)'),
  }),
  color_palette: z.object({
    value: z.enum(["warm", "cool", "monochrome", "earthy", "pastel", "vibrant", "neutral", "unknown"]),
    confidence: z.number().min(0).max(1).describe('Confidence score (0-1)'),
  }),
  aesthetic_style: z.object({
    value: z.enum(["realistic", "cartoon", "abstract", "clean", "vintage", "moody", "minimalist", "unknown"]),
    confidence: z.number().min(0).max(1).describe('Confidence score (0-1)'),
  }),
  time_of_day: z.object({
    value: z.enum(["day", "night", "unknown"]),
    confidence: z.number().min(0).max(1).describe('Confidence score (0-1)'),
  }),
  scene_type: z.object({
    value: z.enum(["indoor", "outdoor", "unknown"]),
    confidence: z.number().min(0).max(1).describe('Confidence score (0-1)'),
  }),
  people_count: z.object({
    value: z.number().int().describe('Number of people in the image'),
    confidence: z.number().min(0).max(1).describe('Confidence score (0-1)'),
  }),
  dress_style: z.object({
    value: z.enum(["fancy", "casual", "unknown"]),
    confidence: z.number().min(0).max(1).describe('Confidence score (0-1)'),
  }),
});
```

## Running the Structured Extraction

### Single Image Analysis

```bash
umwelten eval run \
  --prompt "Analyze this image and extract all the specified features with confidence scores" \
  --models "google:gemini-2.0-flash,google:gemini-1.5-flash-8b" \
  --id "structured-image-analysis" \
  --attach "./test-image.jpg" \
  --zod-schema "./schemas/image-feature-schema.ts" \
  --validate-output \
  --coerce-types
```

### Multiple Models Comparison

```bash
umwelten eval run \
  --prompt "Extract structured image features with confidence scores" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest,google:gemini-1.5-flash-8b" \
  --id "multi-model-features" \
  --attach "./sample-photo.jpg" \
  --zod-schema "./schemas/image-feature-schema.ts" \
  --concurrent \
  --strict-validation
```

## Expected Structured Output

### JSON Schema Validation Results

**Google Gemini 2.0 Flash Output:**
```json
{
  "able_to_parse": {
    "value": true,
    "confidence": 0.98
  },
  "image_description": {
    "value": "A vibrant outdoor scene showing a group of people having a picnic in a park during daytime. The setting includes green grass, trees in the background, and clear blue skies.",
    "confidence": 0.92
  },
  "contain_text": {
    "value": false,
    "confidence": 0.95
  },
  "color_palette": {
    "value": "vibrant",
    "confidence": 0.87
  },
  "aesthetic_style": {
    "value": "realistic",
    "confidence": 0.94
  },
  "time_of_day": {
    "value": "day",
    "confidence": 0.98
  },
  "scene_type": {
    "value": "outdoor",
    "confidence": 0.96
  },
  "people_count": {
    "value": 4,
    "confidence": 0.89
  },
  "dress_style": {
    "value": "casual",
    "confidence": 0.85
  }
}
```

### Validation Report

When using `--validate-output`, you'll get validation feedback:

```
✅ Schema Validation Results:
- All required fields present
- Type validation passed
- Confidence scores within range [0-1]
- Enum values valid for categorical fields
- Successfully parsed and validated JSON output

⚠️ Validation Notes:
- Model confidence for people_count (0.89) suggests some uncertainty
- Consider manual verification for crowd counting tasks
```

## Batch Processing with Structured Output

Process multiple images with structured feature extraction:

```bash
umwelten eval batch \
  --prompt "Extract structured image features with confidence scores" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "image-features-batch" \
  --directory "input/images" \
  --file-pattern "*.{jpg,jpeg,png}" \
  --zod-schema "./schemas/image-feature-schema.ts" \
  --concurrent \
  --max-concurrency 3
```

## Performance Analysis Report

### Generate Comprehensive Report

```bash
umwelten eval report --id multi-model-features --format html --output features-report.html
```

### Sample Report with Structured Data

```markdown
# Structured Image Features Report: multi-model-features

**Generated:** 2025-01-27T16:45:00.000Z  
**Schema:** ImageFeatureSchema (9 features)
**Total Models:** 3

| Model | Provider | Validation | Confidence Avg | Time (ms) | Cost |
|-------|----------|------------|----------------|-----------|------|
| gemini-2.0-flash | google | ✅ Passed | 0.91 | 3400 | $0.000052 |
| gemini-1.5-flash-8b | google | ✅ Passed | 0.88 | 2900 | $0.000041 |
| qwen2.5vl:latest | ollama | ✅ Passed | 0.84 | 4200 | Free |

## Feature Extraction Quality

| Feature | Gemini 2.0 | Gemini 1.5 8B | Qwen2.5VL | Notes |
|---------|------------|---------------|-----------|-------|
| able_to_parse | 0.98 | 0.96 | 0.92 | All models confident |
| image_description | 0.92 | 0.89 | 0.85 | Gemini more detailed |
| contain_text | 0.95 | 0.93 | 0.88 | Strong OCR detection |
| color_palette | 0.87 | 0.84 | 0.82 | Good color analysis |
| people_count | 0.89 | 0.82 | 0.78 | Most challenging feature |

## Validation Summary
- **Schema Compliance:** 100% (3/3 models)
- **Type Errors:** 0
- **Missing Fields:** 0
- **Invalid Enums:** 0
- **Confidence Range:** 0.78 - 0.98
```

## Advanced Schema Patterns

### Custom Confidence Thresholds

```bash
# Only accept results with high confidence
umwelten eval run \
  --prompt "Extract image features (only provide features you're very confident about)" \
  --models "google:gemini-2.0-flash" \
  --id "high-confidence-features" \
  --attach "./image.jpg" \
  --zod-schema "./schemas/image-feature-schema.ts" \
  --strict-validation
```

### Template-based Approach

Use built-in templates for common patterns:

```bash
umwelten eval run \
  --prompt "Extract basic image information" \
  --models "google:gemini-2.0-flash" \
  --id "template-features" \
  --attach "./photo.jpg" \
  --schema-template "image_analysis" # If this template exists
```

## Error Handling and Troubleshooting

### Common Validation Issues

1. **Confidence Scores Out of Range**
   ```bash
   # Add explicit instructions
   --prompt "Extract features with confidence scores between 0.0 and 1.0"
   ```

2. **Invalid Enum Values**
   ```bash
   # Be more specific about valid options
   --prompt "For color_palette, choose from: warm, cool, monochrome, earthy, pastel, vibrant, neutral, or unknown"
   ```

3. **Missing Fields**
   ```bash
   # Use coercion to handle missing data
   --coerce-types
   ```

### Fallback Strategies

```bash
# Disable strict validation for experimental models
umwelten eval run \
  --zod-schema "./schemas/image-feature-schema.ts" \
  --validate-output false \
  # ... other options
```

## Tips for Structured Image Analysis

### Schema Design
- Include confidence scores for quality assessment
- Use enums for categorical data to ensure consistency
- Provide clear descriptions for each field
- Consider optional fields for features that may not apply

### Model Selection
- **Google Gemini**: Best for detailed structured output
- **Ollama qwen2.5vl**: Good for privacy-sensitive analysis
- **Multiple models**: Use for confidence validation

### Prompt Engineering
- Be explicit about the expected output format
- Include examples of valid enum values
- Request confidence scores explicitly
- Mention the importance of accurate field mapping

## Next Steps

- Try [batch image processing](/examples/image-batch) for multiple files
- Explore [complex structured output](/examples/complex-structured) for nested schemas  
- See [cost optimization](/examples/cost-optimization) for efficient structured analysis