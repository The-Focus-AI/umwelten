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
| Perl | `.pl` | `perl:5.38-alpine` | ✅ Supported |
| Bash | `.sh` | `alpine:latest` | ✅ Supported |
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

```typescript
import { extractAllCodeBlocks, getCodeForLanguage } from '../src/evaluation/code-extractor.js';

// Extract all code blocks from a response
const extracted = extractAllCodeBlocks(response.content);

// Get code for a specific language
const typescriptCode = getCodeForLanguage(extracted, 'typescript');
const pythonCode = getCodeForLanguage(extracted, 'python');
```

### Docker Runner (`src/evaluation/docker-runner.ts`)

The Docker runner has been extended to support multiple languages:

```typescript
import { DockerRunner } from '../src/evaluation/docker-runner.js';

// Run code in any supported language
const result = await DockerRunner.runCode({
  code: extractedCode,
  language: 'python',
  timeout: 30,
  modelName: 'test-model'
});
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

This will test 7 Ollama models across 6 programming languages with the show names generation task.

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

# Test the Docker runner
pnpm test:run src/evaluation/docker-runner.test.ts

# Test the full evaluation framework
pnpm test:run src/evaluation/code-scorer.test.ts
```

## Performance Considerations

- **Docker Overhead**: Each language test requires building and running a Docker container
- **Timeout Settings**: Adjust timeouts based on language complexity (e.g., longer for Java/Rust compilation)
- **Resource Usage**: Monitor memory and CPU usage during large evaluations
- **Caching**: Responses are cached to avoid regenerating the same content

## Troubleshooting

### Common Issues

1. **Docker Build Failures**: Ensure Docker is running and has sufficient resources
2. **Language Detection Errors**: Check that language patterns are correctly defined
3. **Timeout Issues**: Increase timeout values for complex languages
4. **Permission Errors**: Ensure Docker has proper permissions to create containers

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
