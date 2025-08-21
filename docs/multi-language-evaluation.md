# Multi-Language Evaluation

The umwelten project now supports evaluating AI models across multiple programming languages. This feature allows you to test how well different models perform when generating code in various languages.

## Overview

The multi-language evaluation system consists of:

1. **Generic Code Extractor** - Extracts code blocks from model responses and identifies their language
2. **Extended Docker Runner** - Supports running code in containers for multiple languages
3. **Multi-Language Evaluation Scripts** - Test models across different programming languages
4. **Cross-Language Reporting** - Comprehensive reports comparing performance across languages

## Supported Languages

The system currently supports the following programming languages:

| Language | File Extension | Docker Image | Status |
|----------|----------------|--------------|---------|
| TypeScript | `.ts` | `node:20-alpine` | ✅ Supported |
| JavaScript | `.js` | `node:20-alpine` | ✅ Supported |
| Python | `.py` | `python:3.11-alpine` | ✅ Supported |
| Ruby | `.rb` | `ruby:3.2-alpine` | ✅ Supported |
| Perl | `.pl` | `perl:5.42` | ✅ Supported |
| Bash | `.sh` | `bash:latest` | ✅ Supported |
| PHP | `.php` | `php:8.2-alpine` | ✅ Supported |
| Java | `.java` | `openjdk:17-alpine` | ✅ Supported |
| Rust | `.rs` | `rust:1.75-alpine` | ✅ Supported |
| Go | `.go` | `golang:1.21-alpine` | ✅ Supported |

## Architecture

### Code Extractor (`src/evaluation/code-extractor.ts`)

The generic code extractor can:

- Extract all code blocks from model responses
- Identify language types automatically
- Handle code blocks with and without language specifications
- Infer language from code content when not specified
- Fix common syntax errors across languages
- Ensure code outputs to console instead of files

### Docker Runner (`src/evaluation/docker-runner.ts`)

The Docker runner has been extended to support multiple languages with robust timeout handling:

- **Timeout Script**: Uses a dedicated `timeout.sh` script inside Docker containers
- **Language-Specific Timeouts**: Bash scripts use 5-second timeout, others use 30 seconds
- **Proper Error Handling**: Detects timeout conditions and provides clear error messages
- **Container Cleanup**: Automatically cleans up Docker containers and images
- **Multi-Language Support**: Supports all major programming languages with appropriate Docker images

#### Timeout Implementation

The timeout system works as follows:

1. **Timeout Script Creation**: A `timeout.sh` script is created for each Docker container
2. **Script Parameters**: The script takes timeout duration and command as parameters
3. **Execution**: The script runs the command with the specified timeout using the system `timeout` command
4. **Error Detection**: Exit code 124 indicates timeout, which is caught and reported
5. **Clean Error Messages**: Timeout errors show "Execution timed out after X seconds"

This approach ensures reliable timeout handling across all supported languages and prevents hanging containers.

```typescript
import { extractAllCodeBlocks, getCodeForLanguage } from '../src/evaluation/code-extractor.js';

// Extract all code blocks from a response
const extracted = extractAllCodeBlocks(response.content);

// Get code for a specific language
const typescriptCode = getCodeForLanguage(extracted, 'typescript');
const pythonCode = getCodeForLanguage(extracted, 'python');
```

```typescript
import { DockerRunner } from '../src/evaluation/docker-runner.js';

// Run code in any supported language
const result = await DockerRunner.runCode({
  code: extractedCode,
  language: 'python',
  timeout: 30,
  modelName: 'test-model'
});

// The timeout is automatically adjusted based on language:
// - Bash: 5 seconds (due to common AI-generated script issues)
// - Other languages: 30 seconds (or custom value)
```

### Code Scorer (`src/evaluation/code-scorer.ts`)

The code scorer now supports language-specific evaluation:

```typescript
import { CodeScorer } from '../src/evaluation/code-scorer.js';

const scorer = new CodeScorer('evaluation-id', 'gpt-oss:20b');

// Score response for a specific language
const score = await scorer.scoreResponse(response, 'typescript');
```

## Usage

### Supported Models

The evaluation currently supports 9 Ollama models:

- `gpt-oss:20b` - GPT-4 Open Source alternative
- `gemma3:12b` - Google's Gemma 3 12B parameter model
- `gemma3:27b` - Google's Gemma 3 27B parameter model
- `deepseek-r1:32b` - DeepSeek's reasoning model
- `devstral:24b` - DevStral coding model
- `mistral-small3.2:24b` - Mistral's small model
- `llama3.2:latest` - Meta's latest Llama model
- `qwen3-coder:latest` - Alibaba's coding model
- `phi4-reasoning:latest` - Microsoft's reasoning model

### Quick Test

Run a quick test with a subset of models and languages:

```bash
pnpm tsx scripts/test-multi-language.ts
```

This will test 2 models across 3 languages (TypeScript, Python, Bash) with simple "Hello World" prompts.

### Full Evaluation

Run a comprehensive evaluation across all supported languages:

```bash
pnpm tsx scripts/multi-language-evaluation.ts
```

This will test 9 Ollama models across 6 programming languages with the show names generation task.

### Language-Specific Evaluation

Run evaluation for a specific language only:

```bash
# Evaluate only bash
pnpm tsx scripts/multi-language-evaluation.ts bash

# Evaluate only perl
pnpm tsx scripts/multi-language-evaluation.ts perl

# Evaluate only typescript
pnpm tsx scripts/multi-language-evaluation.ts typescript
```

This is useful for:
- Testing specific languages without running the full evaluation
- Debugging language-specific issues
- Quick iteration on language-specific improvements

### Custom Evaluation

You can create your own multi-language evaluation by:

1. Defining your models and languages
2. Creating language-specific prompts
3. Using the evaluation framework

```typescript
const LANGUAGES = [
  { 
    name: 'typescript', 
    prompt: 'Your TypeScript prompt here' 
  },
  { 
    name: 'python', 
    prompt: 'Your Python prompt here' 
  }
];

const MODELS = [
  { name: 'gpt-oss:20b', provider: 'ollama' },
  { name: 'gemma3:12b', provider: 'ollama' }
];
```

## Language Detection

The system can automatically detect programming languages from code content using pattern matching:

- **TypeScript/JavaScript**: `function`, `const`, `let`, `console.log`, `=>`
- **Python**: `def`, `import`, `print(`, `class`, `self.`
- **Ruby**: `def`, `puts`, `class`, `attr_accessor`, `require`
- **Perl**: `sub`, `my`, `print`, `use`, `package`, `$`, `@`, `%`
- **Bash**: `#!/bin/bash`, `echo`, `for`, `while`, `if [`
- **PHP**: `<?php`, `function`, `echo`, `class`, `public`
- **Java**: `public class`, `public static void main`, `System.out.println`
- **Go**: `package main`, `func`, `import`, `fmt.Println`
- **Rust**: `fn`, `let`, `println!`, `use`, `struct`

## Code Processing

### Error Fixing

The system automatically fixes common syntax errors:

- **TypeScript/JavaScript**: Fixes loop conditions, missing comparison operators
- **Python**: Fixes print statements without parentheses
- **Bash**: Adds shebang line if missing

### Console Output

The system ensures code outputs to console instead of writing to files:

- Removes file writing operations (`fs.writeFileSync`, `with open`, etc.)
- Removes unnecessary file system imports
- Preserves console output functionality

## Reports

The multi-language evaluation generates comprehensive reports including:

### Language Performance Summary

| Language | Success Rate | Avg Score | Best Model | Avg Response Time |
|----------|-------------|-----------|------------|-------------------|
| typescript | 85.7% | 0.723 | gpt-oss:20b | 2340ms |
| python | 71.4% | 0.689 | gemma3:27b | 1980ms |
| ruby | 57.1% | 0.612 | deepseek-r1:32b | 2150ms |

### Model Performance Summary

| Model | Avg Success Rate | Avg Score | Best Language | Avg Response Time |
|-------|-----------------|-----------|---------------|-------------------|
| gpt-oss:20b | 83.3% | 0.745 | typescript | 2100ms |
| gemma3:12b | 66.7% | 0.623 | python | 1850ms |

### Detailed Results

Each language section includes:
- Success rate and statistics
- Successful models with detailed metrics
- Failed models with error analysis
- Code quality scores from AI evaluation

## Output Structure

The evaluation generates a hierarchical structure organized by language first, then by type:

```
output/evaluations/multi-language-eval/
├── typescript/
│   ├── responses/
│   │   ├── gpt-oss:20b.json
│   │   └── gemma3:12b.json
│   ├── extracted-code/
│   │   ├── gpt-oss:20b.ts
│   │   └── gemma3:12b.ts
│   ├── scores/
│   │   ├── gpt-oss:20b-typescript.json
│   │   └── gemma3:12b-typescript.json
│   └── analysis/
│       └── typescript-evaluation-report.md
├── python/
│   ├── responses/
│   │   ├── gpt-oss:20b.json
│   │   └── gemma3:12b.json
│   ├── extracted-code/
│   │   ├── gpt-oss:20b.py
│   │   └── gemma3:12b.py
│   ├── scores/
│   │   ├── gpt-oss:20b-python.json
│   │   └── gemma3:12b-python.json
│   └── analysis/
│       └── python-evaluation-report.md
├── bash/
│   ├── responses/
│   │   ├── gpt-oss:20b.json
│   │   └── gemma3:12b.json
│   ├── extracted-code/
│   │   ├── gpt-oss:20b.sh
│   │   └── gemma3:12b.sh
│   ├── scores/
│   │   ├── gpt-oss:20b-bash.json
│   │   └── gemma3:12b-bash.json
│   └── analysis/
│       └── bash-evaluation-report.md
└── cross-language-analysis/
    └── cross-language-evaluation-report.md
```

### Directory Organization

- **Language-First Structure**: Everything is organized by language first, then by type
- **Language-Specific Analysis**: Each language has its own analysis report
- **Cross-Language Comparison**: Overall comparison report in `cross-language-analysis/`
- **Model Comparison**: Cross-language analysis shows how each model performs across all languages

## Adding New Languages

To add support for a new programming language:

1. **Add Docker Configuration** in `src/evaluation/docker-runner.ts`:

```typescript
export const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  // ... existing configs ...
  kotlin: {
    extension: '.kt',
    baseImage: 'openjdk:17-alpine',
    runCommand: 'kotlinc /app/code.kt -include-runtime -d /app/code.jar && java -jar /app/code.jar',
    setupCommands: ['apk add --no-cache kotlin']
  }
};
```

2. **Add Language Detection Patterns** in `src/evaluation/code-extractor.ts`:

```typescript
const languageHints = [
  // ... existing hints ...
  { language: 'kotlin', patterns: ['fun ', 'val ', 'var ', 'println', 'class ', 'object '] }
];
```

3. **Add Error Fixing Logic** if needed:

```typescript
case 'kotlin':
  // Fix common Kotlin issues
  fixedCode = fixedCode.replace(/println\s+([^()]+)/g, 'println($1)');
  break;
```

4. **Add File Extension Mapping**:

```typescript
function getFileExtension(language: string): string {
  const extensions: Record<string, string> = {
    // ... existing extensions ...
    kotlin: 'kt'
  };
  return extensions[language] || 'txt';
}
```

## Testing

Run the test suite to verify everything works:

```bash
# Test the code extractor
pnpm test:run src/evaluation/code-extractor.test.ts

# Test the Docker runner (includes timeout tests)
pnpm test:run src/evaluation/docker-runner.test.ts

# Test the full evaluation framework
pnpm test:run src/evaluation/code-scorer.test.ts
```

### Timeout Testing

The Docker runner tests include comprehensive timeout testing:

- **Fast Execution**: Tests that quick scripts complete without timeout
- **Timeout Detection**: Tests that infinite loops are properly timed out
- **Error Messages**: Verifies correct timeout error messages
- **Language-Specific**: Tests timeout behavior for different languages

Timeout tests use 10-second vitest timeouts for 5-second internal timeouts to ensure proper testing.

## Performance Considerations

- **Docker Overhead**: Each language test requires building and running a Docker container
- **Timeout Settings**: 
  - Bash scripts: 5 seconds (fast timeout due to common issues with AI-generated bash)
  - Other languages: 30 seconds (standard timeout)
  - Timeouts are handled by a dedicated timeout script inside Docker containers
- **Resource Usage**: Monitor memory and CPU usage during large evaluations
- **Caching**: Responses are cached to avoid regenerating the same content
- **Language-Specific Processing**: Use language-specific evaluation to reduce processing time

## Troubleshooting

### Common Issues

1. **Docker Build Failures**: Ensure Docker is running and has sufficient resources
2. **Language Detection Errors**: Check that language patterns are correctly defined
3. **Timeout Issues**: 
   - Bash scripts timeout after 5 seconds due to common AI-generated script issues
   - Other languages use 30-second timeout
   - Timeout errors show "Execution timed out after X seconds"
4. **Permission Errors**: Ensure Docker has proper permissions to create containers
5. **Language-Specific Failures**: Use language-specific evaluation to isolate issues

### Debug Mode

Enable debug logging to see detailed execution information:

```bash
DEBUG=umwelten:* pnpm tsx scripts/multi-language-evaluation.ts
```

## Future Enhancements

- **Language-Specific Prompts**: Optimize prompts for each programming language
- **Advanced Error Detection**: More sophisticated syntax and semantic error detection
- **Performance Benchmarking**: Language-specific performance metrics
- **Code Quality Metrics**: Language-specific code quality assessment
- **Integration Testing**: Test code that interacts with external systems
- **Additional Models**: Support for more Ollama models and other providers
- **Enhanced Timeout Handling**: More granular timeout controls per language and model
- **Real-time Progress**: Live progress indicators during long evaluations
