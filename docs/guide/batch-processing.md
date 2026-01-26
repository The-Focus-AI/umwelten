# Batch Processing

Learn how to process multiple files efficiently using Umwelten's batch processing capabilities with concurrent execution and intelligent error handling.

## Overview

Batch processing allows you to evaluate multiple files with the same prompt across multiple models concurrently. This is ideal for processing document libraries, image collections, or any set of files that need consistent analysis.

## Basic Batch Processing

### Simple File Processing

Process all files in a directory:

```bash
npx umwelten eval batch \
  --prompt "Analyze this document and provide a summary" \
  --models "google:gemini-2.0-flash,ollama:gemma3:12b" \
  --id "document-analysis" \
  --directory "./documents" \
  --file-pattern "*.pdf" \
  --concurrent
```

### File Pattern Matching

Use glob patterns to target specific files:

```bash
# Process only JPEG images
npx umwelten eval batch \
  --prompt "Describe this image in detail" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "image-descriptions" \
  --directory "./photos" \
  --file-pattern "*.{jpg,jpeg}" \
  --concurrent

# Process files with specific naming patterns
npx umwelten eval batch \
  --prompt "Analyze this report" \
  --models "google:gemini-2.0-flash" \
  --id "monthly-reports" \
  --directory "./reports" \
  --file-pattern "report_2024_*.pdf"
```

### Recursive Directory Processing

Process files in subdirectories:

```bash
npx umwelten eval batch \
  --prompt "Categorize this document by type and content" \
  --models "google:gemini-2.0-flash" \
  --id "document-categorization" \
  --directory "./document-library" \
  --file-pattern "**/*.{pdf,docx,txt}" \
  --concurrent
```

## Advanced Batch Options

### Concurrency Control

Optimize processing speed with concurrency settings:

```bash
# High concurrency for fast processing
npx umwelten eval batch \
  --prompt "Extract key information from this file" \
  --models "google:gemini-2.0-flash" \
  --id "high-speed-processing" \
  --directory "./files" \
  --file-pattern "*.pdf" \
  --concurrent \
  --max-concurrency 8

# Conservative concurrency to avoid rate limits
npx umwelten eval batch \
  --prompt "Detailed analysis of this document" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "detailed-analysis" \
  --directory "./important-docs" \
  --file-pattern "*.pdf" \
  --concurrent \
  --max-concurrency 2
```

### File Limits

Control the number of files processed:

```bash
# Process only the first 10 files (for testing)
npx umwelten eval batch \
  --prompt "Analyze this document" \
  --models "google:gemini-2.0-flash" \
  --id "test-batch" \
  --directory "./large-collection" \
  --file-pattern "*.pdf" \
  --file-limit 10 \
  --concurrent

# Process all files (default behavior)
npx umwelten eval batch \
  --prompt "Full analysis" \
  --models "google:gemini-2.0-flash" \
  --id "complete-batch" \
  --directory "./documents" \
  --file-pattern "*.pdf" \
  --concurrent
```

### Resume Interrupted Processing

Continue from where you left off:

```bash
npx umwelten eval batch \
  --prompt "Continue processing from where we left off" \
  --models "google:gemini-2.0-flash" \
  --id "large-document-batch" \
  --directory "./documents" \
  --file-pattern "*.pdf" \
  --resume \
  --concurrent
```

## Structured Output in Batches

### Schema Validation

Apply structured output schemas to batch processing:

```bash
npx umwelten eval batch \
  --prompt "Extract structured metadata from this document" \
  --models "google:gemini-2.0-flash" \
  --id "metadata-extraction" \
  --directory "./documents" \
  --file-pattern "*.pdf" \
  --schema "title, author, date, category, summary" \
  --concurrent
```

### Complex Zod Schemas

Use TypeScript schemas for complex validation:

```bash
npx umwelten eval batch \
  --prompt "Analyze this image and extract detailed features" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "image-feature-batch" \
  --directory "./images" \
  --file-pattern "*.{jpg,png}" \
  --zod-schema "./schemas/image-features.ts" \
  --validate-output \
  --concurrent
```

## Interactive Batch Processing

### Real-time Progress Monitoring

Watch batch processing progress in real-time:

```bash
npx umwelten eval batch \
  --prompt "Process this file and extract insights" \
  --models "google:gemini-2.0-flash,ollama:gemma3:12b" \
  --id "interactive-batch" \
  --directory "./documents" \
  --file-pattern "*.pdf" \
  --ui \
  --concurrent \
  --max-concurrency 4
```

## File Type Specific Examples

### Document Processing

```bash
# PDF documents
npx umwelten eval batch \
  --prompt "Summarize this PDF document in 200 words" \
  --models "google:gemini-2.0-flash" \
  --id "pdf-summaries" \
  --directory "./pdfs" \
  --file-pattern "*.pdf" \
  --concurrent

# Text files
npx umwelten eval batch \
  --prompt "Analyze the sentiment and key themes in this text" \
  --models "ollama:gemma3:12b" \
  --id "text-analysis" \
  --directory "./texts" \
  --file-pattern "*.{txt,md}" \
  --concurrent
```

### Image Processing

```bash
# Photo analysis
npx umwelten eval batch \
  --prompt "Describe this photo including objects, setting, and mood" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "photo-descriptions" \
  --directory "./photos" \
  --file-pattern "*.{jpg,jpeg,png}" \
  --concurrent

# Screenshot analysis
npx umwelten eval batch \
  --prompt "Identify the type of application or website in this screenshot" \
  --models "google:gemini-2.0-flash" \
  --id "screenshot-classification" \
  --directory "./screenshots" \
  --file-pattern "screenshot_*.png" \
  --concurrent
```

### Mixed Media Processing

```bash
# All supported file types
npx umwelten eval batch \
  --prompt "Analyze this file and determine its content type and key information" \
  --models "google:gemini-2.0-flash" \
  --id "mixed-media-analysis" \
  --directory "./mixed-files" \
  --file-pattern "*.{pdf,jpg,png,txt,md}" \
  --concurrent
```

## Output Structure

### Directory Organization

Batch processing creates organized output directories:

```
output/evaluations/batch-id/
├── responses/
│   ├── file1.pdf/
│   │   ├── google_gemini-2.0-flash.json
│   │   └── ollama_gemma3_12b.json
│   ├── file2.pdf/
│   │   ├── google_gemini-2.0-flash.json
│   │   └── ollama_gemma3_12b.json
│   └── file3.pdf/
│       ├── google_gemini-2.0-flash.json
│       └── ollama_gemma3_12b.json
└── reports/
    ├── results.md
    ├── results.html
    └── results.csv
```

### Generate Batch Reports

```bash
# Comprehensive markdown report
npx umwelten eval report --id document-analysis --format markdown

# HTML report with rich formatting
npx umwelten eval report --id image-descriptions --format html --output batch-report.html

# CSV export for data analysis
npx umwelten eval report --id metadata-extraction --format csv --output batch-results.csv

# JSON for programmatic processing
npx umwelten eval report --id interactive-batch --format json
```

## Performance Optimization

### Concurrency Guidelines

- **Start Conservative**: Begin with 2-3 concurrent processes
- **Monitor Resources**: Watch CPU, memory, and network usage
- **Adjust Based on Model**: Expensive models may need lower concurrency
- **Rate Limit Awareness**: Some providers have rate limits

### File Organization Tips

- **Group Similar Files**: Process similar file types together
- **Use Descriptive Names**: Help with organization and debugging
- **Consider File Sizes**: Large files may need longer timeouts
- **Test with Samples**: Use `--file-limit` to test on small batches first

### Model Selection for Batches

- **Google Gemini 2.0 Flash**: Best balance of speed, quality, and cost
- **Ollama Models**: Free processing, good for large batches
- **Premium Models**: Reserve for high-value or critical files
- **Multiple Models**: Use for comparison and validation

## Error Handling

### Robust Processing

```bash
# With timeout and validation
npx umwelten eval batch \
  --prompt "Analyze this file with error handling" \
  --models "google:gemini-2.0-flash" \
  --id "robust-batch" \
  --directory "./files" \
  --file-pattern "*.pdf" \
  --timeout 45000 \
  --concurrent \
  --validate-output
```

### Resume on Failures

```bash
# Resume after fixing issues
npx umwelten eval batch \
  --prompt "Continue processing after resolving errors" \
  --models "google:gemini-2.0-flash" \
  --id "robust-batch" \
  --directory "./files" \
  --file-pattern "*.pdf" \
  --resume \
  --concurrent
```

## Common Batch Patterns

### Document Library Processing

```bash
# Categorize and tag documents
npx umwelten eval batch \
  --prompt "Categorize this document and extract tags" \
  --models "google:gemini-2.0-flash" \
  --id "document-library" \
  --directory "./library" \
  --file-pattern "**/*.{pdf,docx}" \
  --schema "category, tags array, summary, confidence int: 1-10" \
  --concurrent
```

### Content Moderation

```bash
# Screen content for appropriateness
npx umwelten eval batch \
  --prompt "Analyze this content for safety and appropriateness" \
  --models "google:gemini-2.0-flash" \
  --id "content-moderation" \
  --directory "./user-uploads" \
  --file-pattern "*.{jpg,png,pdf}" \
  --schema "safe bool, category, issues array, confidence int: 1-10" \
  --concurrent
```

### Data Extraction Pipeline

```bash
# Extract structured data from forms
npx umwelten eval batch \
  --prompt "Extract form data from this document" \
  --models "google:gemini-2.0-flash" \
  --id "form-extraction" \
  --directory "./forms" \
  --file-pattern "*.pdf" \
  --zod-schema "./schemas/form-data.ts" \
  --concurrent
```

## Monitoring and Analytics

### List Batch Evaluations

```bash
# Show all batch evaluations
npx umwelten eval list --details

# Filter for batch evaluations only
npx umwelten eval list --json | jq '.[] | select(.type == "batch")'
```

### Performance Analysis

```bash
# Generate performance report
npx umwelten eval report --id large-batch --format json > performance.json

# Analyze timing and costs
npx umwelten eval report --id document-batch --format csv --output analysis.csv
```

## Best Practices

### Planning
- **Test First**: Use `--file-limit 5` to test on small samples
- **Estimate Costs**: Calculate costs before processing large batches
- **Organize Files**: Use clear directory structure and naming
- **Check Capacity**: Ensure sufficient disk space for outputs

### Execution
- **Monitor Progress**: Use `--ui` for long-running batches
- **Set Timeouts**: Prevent hanging on problematic files
- **Enable Resume**: Always use `--resume` capability for large batches
- **Concurrent Processing**: Enable for significant speed improvements

### Quality Control
- **Validate Schema**: Test schemas on individual files first
- **Random Sampling**: Review random samples from large batches
- **Error Analysis**: Check failed files and adjust parameters
- **Version Control**: Keep track of batch parameters and results

## Troubleshooting

### Common Issues

1. **Rate Limiting**: Reduce `--max-concurrency`
2. **Memory Issues**: Process smaller batches or increase system memory  
3. **Timeout Errors**: Increase `--timeout` value
4. **Schema Validation Failures**: Test schema on individual files first
5. **File Not Found**: Check file patterns and directory paths

### Debugging Commands

```bash
# Test single file from batch
npx umwelten eval run \
  --prompt "Test prompt" \
  --models "google:gemini-2.0-flash" \
  --id "debug-single" \
  --attach "./problematic-file.pdf"

# List files that would be processed
ls ./directory/*.pdf | head -10

# Check batch status
npx umwelten eval list --details | grep batch-id
```

## Next Steps

- Try [structured output](/guide/structured-output) for consistent data extraction
- Explore [cost optimization](/guide/cost-analysis) for budget-conscious batches
- See [model evaluation](/guide/model-evaluation) for systematic testing
- Review [examples](/examples/) for specific use cases