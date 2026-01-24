# Code Execution with Dagger

## Overview

Umwelten provides secure, isolated code execution through the `DaggerRunner` class. This system uses [Dagger](https://dagger.io/) to run generated code in containers, supporting multiple programming languages with automatic package detection and installation.

## Features

- **Multi-Language Support**: TypeScript, Python, Ruby, Go, Rust, Java, and more
- **Automatic Package Detection**: Analyzes code to detect required dependencies
- **LLM-Assisted Configuration**: Uses AI to configure containers for unknown languages/packages
- **Configuration Caching**: Caches container configs to avoid repeated setup
- **BuildKit Caching**: Leverages Dagger's caching for faster repeated runs
- **Timeout Handling**: Configurable execution timeouts
- **Backward Compatible**: Drop-in replacement for the legacy `DockerRunner`

## Quick Start

### Basic Usage

```typescript
import { DaggerRunner } from './src/evaluation/dagger-runner.js';

// Run TypeScript code
const result = await DaggerRunner.runCode({
  code: 'console.log("Hello from Dagger!");',
  language: 'typescript',
  timeout: 30
});

console.log('Success:', result.success);
console.log('Output:', result.output);
```

### Running Python

```typescript
const result = await DaggerRunner.runCode({
  code: 'print("Hello from Python!")',
  language: 'python',
  timeout: 30
});
```

### Running Ruby with Gems

```typescript
const rubyCode = `
require "feedjira"
require "faraday"

response = Faraday.get("https://example.com/rss.xml")
feed = Feedjira.parse(response.body)
puts "Feed: #{feed.title}"
`;

const result = await DaggerRunner.runCode({
  code: rubyCode,
  language: 'ruby',
  timeout: 120, // Longer timeout for gem installation
  useAIConfig: true // Enable AI-assisted package detection
});
```

## Supported Languages

The following languages have built-in support with optimized configurations:

| Language | Extension | Base Image | Run Command |
|----------|-----------|------------|-------------|
| TypeScript | `.ts` | `node:20-alpine` | `npx tsx /app/code.ts` |
| JavaScript | `.js` | `node:20-alpine` | `node /app/code.js` |
| Python | `.py` | `python:3.11-alpine` | `python /app/code.py` |
| Ruby | `.rb` | `ruby:3.2-alpine` | `ruby /app/code.rb` |
| Go | `.go` | `golang:1.21-alpine` | `go run /app/code.go` |
| Rust | `.rs` | `rust:1.75-alpine` | `rustc + execute` |
| Java | `.java` | `openjdk:17-alpine` | `javac + java` |
| PHP | `.php` | `php:8.2-alpine` | `php /app/code.php` |
| Perl | `.pl` | `perl:5.42` | `perl /app/code.pl` |
| Bash | `.sh` | `bash:latest` | `bash /app/code.sh` |
| Swift | `.swift` | `swift:5.9-focal` | `swift /app/code.swift` |

## Automatic Package Detection

DaggerRunner automatically detects package imports in your code and configures the container accordingly.

### Detection Patterns

**Ruby Gems:**
```ruby
require "feedjira"    # Detected: feedjira
gem "faraday"         # Detected: faraday
```

**Python Packages:**
```python
import pandas         # Detected: pandas
from sklearn import   # Detected: sklearn
```

**Node.js Packages:**
```javascript
import axios from 'axios'     // Detected: axios
const fs = require('lodash')  // Detected: lodash
```

When packages are detected, DaggerRunner:
1. Checks the configuration cache for a matching setup
2. If not cached, uses the fallback config or LLM to generate installation commands
3. Caches the configuration for future runs

## Configuration Caching

DaggerRunner maintains two levels of caching:

### 1. Memory Cache
- Fast in-memory lookup for current session
- LRU eviction when limit reached (default: 100 entries)

### 2. Disk Cache
- Persistent cache in `.dagger-cache/configs/`
- Survives process restarts
- Tracks hit counts and access times

### Checking Cache Statistics

```typescript
const stats = DaggerRunner.getCacheStats();
console.log('Memory cache size:', stats.memorySize);
console.log('Disk cache size:', stats.diskSize);
console.log('Cache directory:', stats.cacheDir);
```

### Clearing Cache

```typescript
// Clear all cached configurations
DaggerRunner.clearCache();
```

## LLM-Assisted Configuration

When `useAIConfig: true` is set, DaggerRunner can use Dagger's LLM integration to determine the optimal container configuration for any language or package combination.

```typescript
const result = await DaggerRunner.runCode({
  code: complexCode,
  language: 'ruby',
  timeout: 120,
  useAIConfig: true  // Enable LLM assistance
});
```

### Environment Setup for LLM

To use LLM-assisted configuration, set the following environment variables:

```bash
# For OpenRouter (recommended)
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=your-openrouter-api-key

# Or use Dagger's default (Google Gemini)
# No additional setup required, but may have API limits
```

### Fallback Behavior

If the LLM is unavailable (expired key, network issues), DaggerRunner falls back to:
1. Cached configurations (if available)
2. Static language configurations
3. Best-effort fallback config with common package installation

## API Reference

### DaggerRunConfig

```typescript
interface DaggerRunConfig {
  code: string;           // The code to execute
  language: string;       // Programming language
  timeout?: number;       // Execution timeout in seconds (default: 30)
  modelName?: string;     // Optional model name for tracking
  useAIConfig?: boolean;  // Enable LLM-assisted configuration
}
```

### DaggerRunResult

```typescript
interface DaggerRunResult {
  success: boolean;           // Whether execution succeeded
  output?: string;            // stdout from execution
  error?: string;             // stderr or error message
  exitCode?: number;          // Process exit code
  modelName?: string;         // Model name (if provided)
  containerConfig?: ContainerConfig;  // Config used
  cached?: boolean;           // Whether config was from cache
  executionTime?: number;     // Total execution time in ms
}
```

### ContainerConfig

```typescript
interface ContainerConfig {
  baseImage: string;          // Docker base image
  runCommand: string[];       // Command to run the code
  setupCommands?: string[];   // Package installation commands
  workdir?: string;           // Working directory
  cacheVolumes?: CacheVolume[];  // Package manager caches
  environment?: Record<string, string>;  // Environment variables
}
```

## Examples

### Example 1: TypeScript with Prime Number Check

```typescript
const primeCode = `
function isPrime(n: number): boolean {
  if (n <= 1) return false;
  if (n <= 3) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

const testNumbers = [2, 17, 100, 997];
testNumbers.forEach(n => {
  console.log(\`\${n} is prime: \${isPrime(n)}\`);
});
`;

const result = await DaggerRunner.runCode({
  code: primeCode,
  language: 'typescript',
  timeout: 30
});

// Output:
// 2 is prime: true
// 17 is prime: true
// 100 is prime: false
// 997 is prime: true
```

### Example 2: Ruby RSS Feed Reader

```typescript
const feedReaderCode = `
require "feedjira"
require "faraday"

FEED_URL = "https://thefocus.ai/rss.xml"

response = Faraday.get(FEED_URL)
feed = Feedjira.parse(response.body)

puts "Feed: #{feed.title}"
puts "=" * 60

feed.entries.first(5).each_with_index do |entry, index|
  puts "#{index + 1}. #{entry.title}"
  puts "   Published: #{entry.published}"
  puts
end
`;

const result = await DaggerRunner.runCode({
  code: feedReaderCode,
  language: 'ruby',
  timeout: 120,
  useAIConfig: true
});
```

### Example 3: Python Data Analysis

```typescript
const pythonCode = `
import json

# Simple data analysis without external packages
data = [
    {"name": "Alice", "score": 85},
    {"name": "Bob", "score": 92},
    {"name": "Charlie", "score": 78},
    {"name": "Diana", "score": 95}
]

average = sum(item["score"] for item in data) / len(data)
highest = max(data, key=lambda x: x["score"])
lowest = min(data, key=lambda x: x["score"])

print(f"Average score: {average:.2f}")
print(f"Highest: {highest['name']} ({highest['score']})")
print(f"Lowest: {lowest['name']} ({lowest['score']})")
`;

const result = await DaggerRunner.runCode({
  code: pythonCode,
  language: 'python',
  timeout: 30
});
```

### Example 4: Error Handling

```typescript
const result = await DaggerRunner.runCode({
  code: 'syntax error here!!!',
  language: 'python',
  timeout: 30
});

if (!result.success) {
  console.error('Execution failed:', result.error);
  console.error('Exit code:', result.exitCode);
} else {
  console.log('Output:', result.output);
}
```

### Example 5: Timeout Handling

```typescript
const infiniteLoop = `
while True:
    pass  # This will timeout
`;

const result = await DaggerRunner.runCode({
  code: infiniteLoop,
  language: 'python',
  timeout: 5  // 5 second timeout
});

if (result.exitCode === 124) {
  console.log('Code execution timed out');
}
```

## Migration from DockerRunner

DaggerRunner is a drop-in replacement for the legacy `DockerRunner`:

```typescript
// Old (deprecated)
import { DockerRunner } from './src/evaluation/docker-runner.js';

// New (recommended)
import { DaggerRunner } from './src/evaluation/dagger-runner.js';

// Or use the backward-compatible alias
import { DockerRunner } from './src/evaluation/dagger-runner.js';
```

The interface is identical, so no other code changes are required.

## Architecture

```
DaggerRunner.runCode(config)
    │
    ▼
LLMContainerBuilder.getContainerConfig()
    │
    ├── Check cache → Hit? Return cached config
    │
    ├── Known language + no packages? → Use static config
    │
    └── Unknown/packages? → LLM generates config (or fallback)
            │
            ▼
        Cache the config
    │
    ▼
executeInContainer()
    │
    ├── dag.container().from(baseImage)
    ├── .withMountedCache() for package managers
    ├── .withNewFile() for code
    ├── .withExec() for setup commands
    └── .withExec() for run command (with timeout)
    │
    ▼
Return { success, output, error, exitCode }
```

## Requirements

- **Dagger CLI**: Required for container execution
- **Docker**: Dagger uses Docker (or other OCI runtimes) under the hood

### Installing Dagger

```bash
# macOS
brew install dagger/tap/dagger

# Linux
curl -fsSL https://dl.dagger.io/dagger/install.sh | sh

# Windows (PowerShell)
irm https://dl.dagger.io/dagger/install.ps1 | iex
```

## Troubleshooting

### Common Issues

#### "Dagger engine not running"
Ensure Docker is running and the Dagger CLI is installed:
```bash
docker info  # Check Docker
dagger version  # Check Dagger
```

#### "Package installation failed"
- Increase timeout for packages that take long to install
- Check if the package name is correct
- Enable `useAIConfig: true` for complex dependencies

#### "LLM configuration failed"
- Check your API key is valid and not expired
- The system will fall back to static configuration automatically

#### "Execution timed out"
- Increase the `timeout` parameter
- Check for infinite loops in your code
- Ensure network access if code needs external resources

### Debug Mode

For verbose output, Dagger logs to stderr by default. Check the terminal output for detailed execution information.

## Related Documentation

- [Model Evaluation](/guide/model-evaluation) - Using code execution in evaluations
- [Creating Evaluations](/guide/creating-evaluations) - Building evaluation pipelines
- [API Reference](/api/evaluation-framework) - Full API documentation
