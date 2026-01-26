# Troubleshooting

Common issues and solutions when using Umwelten for AI model evaluation and interaction.

## Installation and Setup Issues

### Command Not Found

**Problem**: `umwelten: command not found`

**Solutions**:
```bash
# If installed globally, check PATH
echo $PATH | grep npm

# Reinstall globally
npm uninstall -g umwelten
npm install -g umwelten

# Use with npx if global install isn't working
npx umwelten --help

# If using from source
node dist/cli/cli.js --help
```

### API Key Issues

**Problem**: Authentication errors or "API key not found"

**Solutions**:
```bash
# Check environment variables
echo $GOOGLE_GENERATIVE_AI_API_KEY
echo $OPENROUTER_API_KEY

# Set API keys
export GOOGLE_GENERATIVE_AI_API_KEY="your-key-here"
export OPENROUTER_API_KEY="your-key-here"

# Or use .env file
cat > .env << EOF
GOOGLE_GENERATIVE_AI_API_KEY=your-key-here
OPENROUTER_API_KEY=your-key-here
EOF
```

### Ollama Connection Issues

**Problem**: Cannot connect to local Ollama server

**Solutions**:
```bash
# Check if Ollama is running
curl http://localhost:11434/api/version

# Start Ollama service
ollama serve

# Check available models
ollama list

# Pull a model if needed
ollama pull gemma3:12b

# Set custom Ollama host
export OLLAMA_HOST=http://localhost:11434
```

### LM Studio Connection Issues

**Problem**: Cannot connect to LM Studio server

**Solutions**:
1. **Start LM Studio**: Ensure LM Studio application is running
2. **Load a Model**: Load a model in LM Studio interface  
3. **Start Server**: Enable the local server in LM Studio settings
4. **Check Port**: Verify server is running on correct port (default: 1234)

```bash
# Test LM Studio connection
curl http://localhost:1234/v1/models

# Set custom LM Studio URL
export LMSTUDIO_BASE_URL=http://localhost:1234
```

## Runtime Errors

### Timeout Errors

**Problem**: Requests timing out

**Solutions**:
```bash
# Increase timeout (default: 30 seconds)
npx umwelten eval run \
  --timeout 60000 \
  --prompt "Complex analysis task" \
  --models "google:gemini-2.0-flash"

# For batch processing
npx umwelten eval batch \
  --timeout 45000 \
  --directory "./files" \
  --file-pattern "*.pdf"
```

### Rate Limiting

**Problem**: "Rate limit exceeded" or 429 errors

**Solutions**:
```bash
# Reduce concurrency
npx umwelten eval run \
  --models "google:gemini-2.0-flash" \
  --concurrent \
  --max-concurrency 1

# Add delays between requests (batch processing)
npx umwelten eval batch \
  --max-concurrency 2 \
  --directory "./files"

# Switch to different provider temporarily
npx umwelten eval run \
  --models "ollama:gemma3:12b" \
  --prompt "Your prompt"
```

### Memory Issues

**Problem**: Out of memory errors during large batch processing

**Solutions**:
```bash
# Process smaller batches
npx umwelten eval batch \
  --file-limit 50 \
  --directory "./large-collection"

# Reduce concurrency
npx umwelten eval batch \
  --max-concurrency 1 \
  --directory "./files"

# Use less memory-intensive models
npx umwelten eval run \
  --models "google:gemini-2.0-flash" \
  --prompt "Your prompt"
```

### Streaming Issues

**Problem**: `streamObject` hanging or timing out

**Solutions**:
```typescript
// ✅ CORRECT: Use partialObjectStream iteration
const result = streamObject(options);
let finalObject: Record<string, any> = {};

for await (const partialObject of result.partialObjectStream) {
  if (partialObject && typeof partialObject === 'object') {
    finalObject = { ...finalObject, ...partialObject };
  }
}

// ❌ INCORRECT: This hangs indefinitely
const result = streamObject(options);
const finalObject = await result.object; // HANGS HERE
```

**Best Practices**:
- **Use `streamObject` with `partialObjectStream`** for real-time updates
- **Use `generateObject`** for immediate structured results
- **Use `streamText`** for real-time text streaming
- **Avoid `await result.object`** from `streamObject` (causes hanging)

**Performance Notes**:
- **Google Gemini**: ~600ms for streamObject
- **Ollama (gemma3:12b)**: ~500ms for streamObject
- **Both providers**: Real-time streaming works without hanging

## Model-Specific Issues

### Google Gemini Errors

**Problem**: Gemini API errors

**Common Errors and Solutions**:
```bash
# "Model not found" - Check model name
npx umwelten models list --provider google

# "Quota exceeded" - Check API limits in Google AI Studio
# "Safety filter triggered" - Adjust prompt content

# Test with simple prompt first
npx umwelten run \
  --provider google \
  --model gemini-2.0-flash \
  "Hello, how are you?"
```

### OpenRouter Errors

**Problem**: OpenRouter authentication or model access issues

**Solutions**:
```bash
# Verify API key
curl -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  https://openrouter.ai/api/v1/models

# Check available models
npx umwelten models list --provider openrouter

# Some models require credits - check balance
# Use alternative models if specific model unavailable
```

### Ollama Model Issues

**Problem**: Local Ollama models not working

**Solutions**:
```bash
# Check Ollama status
ollama ps

# List available models
ollama list

# Pull missing model
ollama pull gemma3:12b

# Test model directly
ollama run gemma3:12b "Hello"

# Check model name format in Umwelten
npx umwelten models list --provider ollama
```

## File Attachment Issues

### Unsupported File Types

**Problem**: File attachment not working

**Supported formats**:
- Images: JPG, JPEG, PNG, WebP, GIF
- Documents: PDF
- Text: Some models support TXT, MD

**Solutions**:
```bash
# Check file format
file ./your-file.ext

# Convert to supported format if needed
# For images: convert to JPG/PNG
# For documents: convert to PDF

# Test with known good file
npx umwelten run \
  --provider google \
  --model gemini-2.0-flash \
  --file ./test.jpg \
  "Describe this image"
```

### File Size Issues

**Problem**: Large files causing errors

**Solutions**:
```bash
# Check file size
ls -lh ./large-file.pdf

# Reduce file size or split large files
# For images: reduce resolution
# For PDFs: split into smaller sections

# Use timeout for large files
npx umwelten run \
  --timeout 60000 \
  --file ./large-document.pdf \
  --prompt "Summarize this document"
```

### File Path Issues

**Problem**: "File not found" errors

**Solutions**:
```bash
# Use absolute paths
npx umwelten run \
  --file "/full/path/to/file.jpg" \
  --prompt "Analyze this image"

# Check current directory
pwd
ls -la ./file.jpg

# Verify file permissions
chmod 644 ./file.jpg
```

## Evaluation and Batch Processing Issues

### Evaluation Not Found

**Problem**: Cannot find previous evaluation

**Solutions**:
```bash
# List all evaluations
npx umwelten eval list

# Check evaluation directory
ls -la output/evaluations/

# Use correct evaluation ID
npx umwelten eval report --id "exact-evaluation-id"
```

### Batch Processing Failures

**Problem**: Batch processing stops or fails

**Solutions**:
```bash
# Use resume to continue from where it stopped
npx umwelten eval batch \
  --resume \
  --id "previous-batch-id"

# Check for problematic files
# Remove or fix files causing issues

# Start with smaller batch to test
npx umwelten eval batch \
  --file-limit 5 \
  --directory "./test-files"
```

### Schema Validation Errors

**Problem**: Structured output validation failing

**Solutions**:
```bash
# Test schema with simple example first
npx umwelten eval run \
  --prompt "Extract name: John Smith is 30 years old" \
  --schema "name, age int" \
  --models "google:gemini-2.0-flash"

# Use type coercion for lenient validation
npx umwelten eval run \
  --schema "name, age int" \
  --coerce-types \
  --models "google:gemini-2.0-flash"

# Check Zod schema syntax
node -e "require('./schemas/my-schema.ts')"
```

## Performance Issues

### Slow Response Times

**Problem**: Evaluations taking too long

**Solutions**:
```bash
# Use faster models
npx umwelten eval run \
  --models "google:gemini-2.0-flash,google:gemini-1.5-flash-8b" \
  --prompt "Your prompt"

# Enable concurrent processing
npx umwelten eval run \
  --models "model1,model2,model3" \
  --concurrent \
  --max-concurrency 5

# Reduce prompt complexity
# Make prompts more specific and concise
```

### High Memory Usage

**Problem**: System running out of memory

**Solutions**:
```bash
# Reduce batch sizes
npx umwelten eval batch --file-limit 20

# Lower concurrency
npx umwelten eval batch --max-concurrency 2

# Process files sequentially
npx umwelten eval batch # (without --concurrent)

# Close other applications
# Increase system memory if possible
```

## Network and Connectivity Issues

### Connection Timeouts

**Problem**: Network timeouts or connection refused

**Solutions**:
```bash
# Check internet connection
ping google.com

# Test API endpoints directly
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GOOGLE_GENERATIVE_AI_API_KEY"

# Use different network if available
# Check firewall settings
# Try different provider
```

### SSL Certificate Issues

**Problem**: SSL/TLS certificate errors

**Solutions**:
```bash
# Update Node.js and npm
npm update -g

# Clear npm cache
npm cache clean --force

# Check system time (affects certificate validation)
date

# Try with different network
```

## Output and Reporting Issues

### Report Generation Failures

**Problem**: Cannot generate reports

**Solutions**:
```bash
# Check if evaluation exists
npx umwelten eval list | grep "your-eval-id"

# Try different report format
npx umwelten eval report --id "eval-id" --format json
npx umwelten eval report --id "eval-id" --format markdown

# Check output directory permissions
ls -la output/evaluations/

# Generate report to specific location
npx umwelten eval report --id "eval-id" --output ./my-report.html
```

### Missing Output Files

**Problem**: Expected output files not created

**Solutions**:
```bash
# Check evaluation completion
npx umwelten eval list --details

# Look for partial results
find output/evaluations/ -name "*.json" | head -5

# Check disk space
df -h

# Verify write permissions
touch output/test-write && rm output/test-write
```

## Debugging Commands

### General Debugging

```bash
# Check version
npx umwelten --version

# Test basic functionality
npx umwelten run --provider google --model gemini-2.0-flash "Hello world"

# List available models
npx umwelten models list

# Check evaluation history
npx umwelten eval list --details

# Test with minimal example
npx umwelten eval run \
  --prompt "Test" \
  --models "google:gemini-2.0-flash" \
  --id "debug-test"
```

### Verbose Logging

```bash
# Enable debug output (if available)
NODE_ENV=debug npx umwelten eval run ...

# Check network requests
# Use browser dev tools or network monitoring

# Monitor system resources
top
htop
iostat
```

### Environment Diagnosis

```bash
# Check Node.js version
node --version

# Check npm version  
npm --version

# Check installed packages
npm list -g umwelten

# Check environment variables
printenv | grep -E "(GOOGLE|OPENROUTER|OLLAMA|LMSTUDIO)"

# Check system resources
free -h  # Memory
df -h    # Disk space
```

## Getting Help

### Documentation Resources

- **[Examples](/examples/)**: Comprehensive usage examples
- **[API Reference](/api/overview)**: Complete command reference
- **[Migration Guide](/migration/)**: Script to CLI migration help

### Community Support

1. **GitHub Issues**: Report bugs and feature requests
2. **Documentation**: Check examples and guides first
3. **Model Provider Documentation**: Check provider-specific issues

### Reporting Issues

When reporting issues, include:

```bash
# System information
npx umwelten --version
node --version
npm --version
uname -a

# Error reproduction
npx umwelten eval run \
  --prompt "failing prompt" \
  --models "problematic-model" \
  --id "error-reproduction"

# Error messages (copy full error output)
# Steps to reproduce
# Expected vs actual behavior
```

### Best Practices for Avoiding Issues

1. **Start Simple**: Test with basic examples before complex use cases
2. **Check Status**: Verify API keys and service status regularly
3. **Monitor Resources**: Watch memory and disk usage during large operations
4. **Use Resume**: Always use resume capability for large batch operations
5. **Test Incrementally**: Increase complexity gradually
6. **Keep Backups**: Save working configurations and successful evaluation IDs

## Quick Fixes Checklist

When something isn't working:

- [ ] Check API keys are set correctly
- [ ] Verify internet connection
- [ ] Test with simple prompt first
- [ ] Check model availability with `npx umwelten models list`
- [ ] Try different model or provider
- [ ] Increase timeout if needed
- [ ] Reduce concurrency if rate limited
- [ ] Check file paths and permissions
- [ ] Look at recent evaluation list
- [ ] Check disk space and memory
- [ ] Update to latest version
- [ ] Try with minimal example

## Next Steps

- Review [examples](/examples/) for working configurations
- Check [model evaluation guide](/guide/model-evaluation) for systematic testing
- See [batch processing guide](/guide/batch-processing) for large-scale operations
- Consult [cost analysis guide](/guide/cost-analysis) for budget optimization