# Multi-Format Processing

Process different file formats with appropriate models and extraction techniques. This example demonstrates handling various file types including images, PDFs, and text files with optimal model selection.

## Overview

Multi-format processing allows you to handle diverse file types in a single workflow, automatically selecting the best model and approach for each format. This is essential for document libraries, media collections, and heterogeneous data processing.

## Basic Multi-Format Processing

### Mixed File Types

Process different file formats with a single command:

```bash
npx umwelten eval batch \
  --prompt "Analyze this file and describe its content, format, and key information" \
  --models "google:gemini-2.0-flash" \
  --id "multi-format-analysis" \
  --directory "./mixed-files" \
  --file-pattern "*.{pdf,jpg,png,txt,md,docx}" \
  --concurrent
```

### Format-Specific Prompts

Use different prompts based on detected file types:

```bash
# Images
npx umwelten eval batch \
  --prompt "Describe this image including objects, people, setting, and visual elements" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "image-analysis" \
  --directory "./content" \
  --file-pattern "*.{jpg,jpeg,png,webp,gif}" \
  --concurrent

# Documents  
npx umwelten eval batch \
  --prompt "Extract key information: title, summary, main points, and document type" \
  --models "google:gemini-2.0-flash" \
  --id "document-analysis" \
  --directory "./content" \
  --file-pattern "*.{pdf,docx,txt,md}" \
  --concurrent
```

## Advanced Multi-Format Processing

### Structured Multi-Format Schema

Extract consistent data across different file formats:

```bash
npx umwelten eval batch \
  --prompt "Analyze this file and extract structured metadata" \
  --models "google:gemini-2.0-flash" \
  --id "multi-format-structured" \
  --directory "./documents" \
  --file-pattern "*.{pdf,jpg,png,txt}" \
  --schema "title, type, summary, key_points array, confidence int: 1-10" \
  --concurrent
```

### Format-Adaptive Processing

Different approaches for different formats:

```bash
# Vision models for images
npx umwelten eval batch \
  --prompt "Extract visual information and any text content" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "visual-content" \
  --directory "./mixed-media" \
  --file-pattern "*.{jpg,png,webp}" \
  --schema "objects array, text_content, scene_description, has_people bool" \
  --concurrent

# Text models for documents  
npx umwelten eval batch \
  --prompt "Extract document structure and content analysis" \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o-mini" \
  --id "document-content" \
  --directory "./mixed-media" \
  --file-pattern "*.{pdf,txt,md}" \
  --schema "document_type, title, sections array, word_count int" \
  --concurrent
```

## Format-Specific Optimizations

### Image Processing Pipeline

```bash
# High-quality image analysis
npx umwelten eval batch \
  --prompt "Provide detailed visual analysis including composition, colors, and subjects" \
  --models "google:gemini-2.0-flash" \
  --id "detailed-images" \
  --directory "./photos" \
  --file-pattern "*.{jpg,jpeg,png}" \
  --timeout 45000 \
  --concurrent \
  --max-concurrency 4
```

### Document Processing Pipeline

```bash
# Comprehensive document analysis
npx umwelten eval batch \
  --prompt "Extract and analyze document content with context and implications" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "detailed-documents" \
  --directory "./reports" \
  --file-pattern "*.pdf" \
  --timeout 60000 \
  --concurrent \
  --max-concurrency 2
```

### Text File Processing

```bash
# Code and text file analysis
npx umwelten eval batch \
  --prompt "Analyze this text file for content type, quality, and key insights" \
  --models "ollama:codestral:latest,google:gemini-2.0-flash" \
  --id "text-analysis" \
  --directory "./texts" \
  --file-pattern "*.{txt,md,js,py,ts}" \
  --concurrent
```

## Real-World Use Cases

### Digital Asset Management

```bash
# Catalog mixed media library
npx umwelten eval batch \
  --prompt "Create catalog entry for this file" \
  --models "google:gemini-2.0-flash" \
  --id "asset-cataloging" \
  --directory "./digital-assets" \
  --file-pattern "*.{jpg,png,pdf,mp4,docx}" \
  --schema "filename, type, description, tags array, size_category, content_rating" \
  --concurrent
```

### Content Migration

```bash
# Analyze content for migration planning
npx umwelten eval batch \
  --prompt "Assess this file for content migration: complexity, dependencies, and recommendations" \
  --models "google:gemini-2.0-flash" \
  --id "migration-assessment" \
  --directory "./legacy-content" \
  --file-pattern "*.{pdf,doc,xls,ppt,jpg,png}" \
  --schema "complexity int: 1-5, dependencies array, migration_effort, recommendations" \
  --concurrent
```

### Research Data Processing

```bash
# Process mixed research materials
npx umwelten eval batch \
  --prompt "Extract research-relevant information and classify by academic discipline" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "research-processing" \
  --directory "./research-materials" \
  --file-pattern "*.{pdf,png,jpg,txt}" \
  --schema "discipline, research_type, methodology, key_findings array, citations int" \
  --concurrent
```

## Performance Considerations

### Model Selection by Format

| Format | Recommended Model | Rationale |
|--------|------------------|-----------|
| Images | google:gemini-2.0-flash | Best vision capabilities |
| PDFs | google:gemini-2.0-flash | Strong document understanding |
| Text | ollama:gemma3:12b | Cost-effective for simple text |
| Code | ollama:codestral:latest | Specialized code understanding |
| Complex Docs | google:gemini-2.5-pro | Advanced reasoning needed |

### Concurrency Guidelines

```bash
# Conservative approach for mixed formats
npx umwelten eval batch \
  --models "google:gemini-2.0-flash" \
  --max-concurrency 3 \
  --timeout 45000

# Aggressive processing for simple tasks  
npx umwelten eval batch \
  --models "ollama:gemma3:12b" \
  --max-concurrency 8 \
  --timeout 30000
```

## Output Analysis

### Generate Multi-Format Report

```bash
# Comprehensive analysis report
npx umwelten eval report --id multi-format-analysis --format html --output multi-format-report.html

# Export structured data for analysis
npx umwelten eval report --id multi-format-structured --format csv --output metadata.csv

# Compare processing across formats
npx umwelten eval report --id multi-format-analysis --format json | jq '.results[] | {file: .file, format: .format, processing_time: .timing.total}'
```

### Analysis Patterns

```bash
# Analyze processing time by file type
npx umwelten eval report --id multi-format-analysis --format json | jq '
  .results | 
  group_by(.file | split(".") | last) | 
  map({format: .[0].file | split(".") | last, avg_time: (map(.timing.total) | add / length)})
'

# Success rates by format
npx umwelten eval report --id multi-format-analysis --format json | jq '
  .results | 
  group_by(.file | split(".") | last) | 
  map({format: .[0].file | split(".") | last, success_rate: (map(select(.success == true)) | length) / length})
'
```

## Error Handling

### Format-Specific Error Patterns

```bash
# Robust processing with fallbacks
npx umwelten eval batch \
  --prompt "Process this file, handling any format-specific challenges" \
  --models "google:gemini-2.0-flash,ollama:gemma3:12b" \
  --id "robust-multi-format" \
  --directory "./problematic-files" \
  --file-pattern "*.{pdf,jpg,txt}" \
  --timeout 60000 \
  --concurrent \
  --resume
```

### File Size Considerations

```bash
# Handle large files with extended timeouts
npx umwelten eval batch \
  --prompt "Process large file with patience" \
  --models "google:gemini-2.0-flash" \
  --id "large-files" \
  --directory "./large-files" \
  --file-pattern "*.{pdf,jpg}" \
  --timeout 120000 \
  --concurrent \
  --max-concurrency 1
```

## Best Practices

### Planning
- **File Survey**: Catalog file types and sizes before processing
- **Model Mapping**: Match optimal models to file formats
- **Resource Planning**: Estimate processing time and costs by format
- **Error Anticipation**: Plan for format-specific failure modes

### Execution
- **Batch by Type**: Group similar formats when possible
- **Progressive Processing**: Start with smaller samples
- **Monitor Resources**: Watch memory usage with mixed formats
- **Validate Results**: Check outputs across different formats

### Quality Control
- **Format Validation**: Ensure files are properly formatted
- **Output Consistency**: Use schemas to maintain structure across formats
- **Spot Checking**: Manually verify results from different formats
- **Performance Tracking**: Monitor processing efficiency by format

## Troubleshooting

### Common Issues

1. **Memory Usage**: Mixed formats can cause memory spikes
2. **Processing Time**: Different formats have varying complexity
3. **Model Compatibility**: Not all models handle all formats well
4. **Output Inconsistency**: Different formats may produce different output structures

### Debug Commands

```bash
# Test single file from each format
npx umwelten run --models "google:gemini-2.0-flash" --file "./test.pdf" "Analyze this document"
npx umwelten run --models "google:gemini-2.0-flash" --file "./test.jpg" "Analyze this image"  
npx umwelten run --models "google:gemini-2.0-flash" --file "./test.txt" "Analyze this text"

# Check file format distribution
find ./directory -name "*.*" | sed 's/.*\.//' | sort | uniq -c

# Monitor processing progress
npx umwelten eval list --details | grep multi-format
```

## Next Steps

- Try [batch processing](/guide/batch-processing) for scaling multi-format workflows
- Explore [structured output](/guide/structured-output) for consistent data extraction
- See [cost analysis](/guide/cost-analysis) for optimizing multi-format processing costs
- Learn about [model evaluation](/guide/model-evaluation) for format-specific model selection