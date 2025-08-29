# CLI API

The CLI package provides the command-line interface for Umwelten, offering a comprehensive set of commands for interacting with AI models, managing evaluations, and controlling the tool's behavior.

## Overview

The CLI package provides:

- **Command Management**: Structured command handling with Commander.js
- **Model Operations**: List, query, and interact with AI models
- **Evaluation Commands**: Run and manage model evaluations
- **Interactive Chat**: Real-time conversation with AI models
- **MCP Integration**: Model Context Protocol commands for tool integration
- **Utility Functions**: Common CLI operations and formatting

## Core Commands

### Main CLI Entry

The main CLI entry point that sets up all available commands.

```typescript
import { cli } from '../src/cli/cli.js';

// Parse command line arguments
cli.parse();
```

### Model Commands

Commands for managing and interacting with AI models.

#### `models` Command

List available models across all providers.

```bash
# List all models
umwelten models

# List models by provider
umwelten models --provider google
umwelten models --provider openrouter

# JSON output
umwelten models --json

# Filter by capability
umwelten models --capability vision
umwelten models --capability coding
```

**Options**:
- `--provider <provider>`: Filter by provider (google, openrouter, ollama, lmstudio)
- `--json`: Output in JSON format
- `--capability <capability>`: Filter by model capability
- `--verbose`: Show detailed model information

#### `run` Command

Execute a single prompt with a model.

```bash
# Basic usage
umwelten run "Explain quantum computing"

# Specify model
umwelten run "Write a Python function" --model gpt-4

# With system prompt
umwelten run "Analyze this code" --system "You are a code reviewer"

# Structured output
umwelten run "Extract person info" --schema person-schema.json

# File attachment
umwelten run "Analyze this image" --file image.jpg
```

**Options**:
- `--model <model>`: Model to use
- `--system <prompt>`: System prompt
- `--schema <file>`: JSON schema for structured output
- `--file <file>`: File to attach
- `--temperature <number>`: Model temperature (0.0-2.0)
- `--max-tokens <number>`: Maximum tokens to generate
- `--json`: Output in JSON format

#### `chat` Command

Interactive chat mode with AI models.

```bash
# Start interactive chat
umwelten chat

# Chat with specific model
umwelten chat --model gemini-2.0-flash

# Chat with memory enabled
umwelten chat --memory

# Chat with system prompt
umwelten chat --system "You are a helpful coding assistant"
```

**Options**:
- `--model <model>`: Model to use for chat
- `--memory`: Enable conversation memory
- `--system <prompt>`: System prompt
- `--temperature <number>`: Model temperature
- `--max-tokens <number>`: Maximum tokens per response

### Evaluation Commands

Commands for running and managing model evaluations.

#### `eval` Command

Run model evaluations and assessments.

```bash
# Run basic evaluation
umwelten eval --model gpt-4 --task coding

# Run multiple models
umwelten eval --models gpt-4,gemini-2.0-flash --task reasoning

# Custom evaluation script
umwelten eval --script custom-eval.js

# Batch evaluation
umwelten eval --batch input-files/ --output results/

# Evaluation with specific metrics
umwelten eval --metrics accuracy,latency,cost
```

**Options**:
- `--model <model>`: Model to evaluate
- `--models <models>`: Comma-separated list of models
- `--task <task>`: Evaluation task type
- `--script <file>`: Custom evaluation script
- `--batch <dir>`: Directory of input files
- `--output <dir>`: Output directory for results
- `--metrics <metrics>`: Comma-separated list of metrics
- `--json`: Output results in JSON format

### MCP Commands

Model Context Protocol commands for tool integration.

#### `mcp connect` Command

Connect to an MCP server.

```bash
# Connect to local server
umwelten mcp connect --server "node server.js"

# Connect with specific protocol
umwelten mcp connect --server "ws://localhost:3000" --protocol websocket

# Connect with authentication
umwelten mcp connect --server "https://api.example.com" --token "your-token"
```

**Options**:
- `--server <command>`: Server command or URL
- `--protocol <protocol>`: Connection protocol (stdio, websocket, http)
- `--token <token>`: Authentication token
- `--timeout <ms>`: Connection timeout in milliseconds

#### `mcp test-tool` Command

Test MCP tools.

```bash
# Test calculator tool
umwelten mcp test-tool calculator --params '{"operation":"add","a":5,"b":3}'

# Test web search tool
umwelten mcp test-tool web-search --params '{"query":"latest AI developments"}'

# Test file reading tool
umwelten mcp test-tool read-file --params '{"path":"/path/to/file.txt"}'
```

**Options**:
- `--params <json>`: Tool parameters in JSON format
- `--timeout <ms>`: Tool execution timeout
- `--verbose`: Show detailed tool information

#### `mcp read-resource` Command

Read resources through MCP.

```bash
# Read file resource
umwelten mcp read-resource file:///path/to/file.txt

# Read URL resource
umwelten mcp read-resource https://example.com/api/data

# Read with specific encoding
umwelten mcp read-resource file:///path/to/file.txt --encoding utf-8
```

**Options**:
- `--encoding <encoding>`: Resource encoding
- `--timeout <ms>`: Read timeout in milliseconds

### Tool Commands

Commands for managing and using tools.

#### `tools` Command

List and manage available tools.

```bash
# List all tools
umwelten tools

# List tools by category
umwelten tools --category file

# Test specific tool
umwelten tools test calculator

# Install tool
umwelten tools install custom-tool

# Remove tool
umwelten tools remove old-tool
```

**Options**:
- `--category <category>`: Filter by tool category
- `--json`: Output in JSON format
- `--verbose`: Show detailed tool information

## Core Functions

### Model Management

#### `listModels(options: ListModelsOptions): Promise<void>`

List available models with filtering and formatting.

```typescript
import { listModels } from '../src/cli/models.js';

await listModels({
  provider: 'google',
  json: true,
  capability: 'vision'
});
```

**Parameters**:
- `options`: Configuration for model listing

#### `runCommand(args: string[]): Promise<CommandResult>`

Execute a run command programmatically.

```typescript
import { runCommand } from '../src/cli/run.js';

const result = await runCommand([
  'run',
  'Hello, world!',
  '--model',
  'gpt-4',
  '--json'
]);

console.log(result.stdout);
```

**Parameters**:
- `args`: Command line arguments array

**Returns**: Promise resolving to command result

### Evaluation Management

#### `evaluateModel(options: EvaluationOptions): Promise<EvaluationResult>`

Run model evaluation programmatically.

```typescript
import { evaluateModel } from '../src/cli/eval.js';

const result = await evaluateModel({
  model: 'gpt-4',
  task: 'coding',
  input: 'Write a function to sort an array',
  metrics: ['accuracy', 'latency']
});

console.log('Evaluation score:', result.score);
```

**Parameters**:
- `options`: Evaluation configuration

**Returns**: Promise resolving to evaluation result

### Chat Management

#### `startChat(options: ChatOptions): Promise<void>`

Start interactive chat session.

```typescript
import { startChat } from '../src/cli/chat.js';

await startChat({
  model: 'gemini-2.0-flash',
  memory: true,
  systemPrompt: 'You are a helpful assistant.'
});
```

**Parameters**:
- `options`: Chat configuration

### MCP Management

#### `connectToMCP(options: MCPConnectionOptions): Promise<MCPClient>`

Connect to MCP server.

```typescript
import { connectToMCP } from '../src/cli/mcp.js';

const client = await connectToMCP({
  server: 'node server.js',
  protocol: 'stdio',
  timeout: 5000
});

// Use MCP client
const tools = await client.listTools();
```

**Parameters**:
- `options`: MCP connection configuration

**Returns**: Promise resolving to MCP client

## Type Definitions

### CommandResult

Result of command execution.

```typescript
interface CommandResult {
  exitCode: number;        // Exit code (0 for success)
  stdout: string;         // Standard output
  stderr: string;         // Standard error
  error?: Error;          // Error if command failed
}
```

### ListModelsOptions

Options for listing models.

```typescript
interface ListModelsOptions {
  provider?: string;      // Filter by provider
  capability?: string;    // Filter by capability
  json?: boolean;         // Output in JSON format
  verbose?: boolean;      // Show detailed information
}
```

### EvaluationOptions

Options for model evaluation.

```typescript
interface EvaluationOptions {
  model: string;          // Model to evaluate
  task: string;           // Evaluation task
  input?: string;         // Input for evaluation
  inputFile?: string;     // Input file path
  output?: string;        // Output file path
  metrics?: string[];     // Metrics to evaluate
  json?: boolean;         // Output in JSON format
}
```

### ChatOptions

Options for interactive chat.

```typescript
interface ChatOptions {
  model?: string;         // Model to use
  memory?: boolean;       // Enable memory
  systemPrompt?: string;  // System prompt
  temperature?: number;   // Model temperature
  maxTokens?: number;     // Maximum tokens
}
```

### MCPConnectionOptions

Options for MCP connection.

```typescript
interface MCPConnectionOptions {
  server: string;         // Server command or URL
  protocol?: string;      // Connection protocol
  token?: string;         // Authentication token
  timeout?: number;       // Connection timeout
}
```

## Usage Examples

### Programmatic CLI Usage

```typescript
import { listModels, runCommand, evaluateModel } from '../src/cli/index.js';

// List models programmatically
await listModels({
  provider: 'google',
  json: true
});

// Run command programmatically
const result = await runCommand([
  'run',
  'Explain quantum computing',
  '--model',
  'gemini-2.0-flash',
  '--json'
]);

if (result.exitCode === 0) {
  console.log('Success:', result.stdout);
} else {
  console.error('Error:', result.stderr);
}

// Evaluate model programmatically
const evaluation = await evaluateModel({
  model: 'gpt-4',
  task: 'reasoning',
  input: 'Solve this logic puzzle: ...',
  metrics: ['accuracy', 'latency']
});

console.log('Evaluation result:', evaluation);
```

### Custom CLI Commands

```typescript
import { Command } from 'commander';
import { getProvider } from '../src/providers/index.js';

// Create custom command
const program = new Command();

program
  .command('cost-analysis')
  .description('Analyze costs across providers')
  .option('-t, --tokens <number>', 'Number of tokens', '1000')
  .action(async (options) => {
    const providers = ['google', 'openrouter', 'ollama'];
    const tokens = parseInt(options.tokens);
    
    for (const providerName of providers) {
      try {
        const provider = getProvider(providerName);
        const models = await provider.getAvailableModels();
        
        console.log(`\n${providerName.toUpperCase()}:`);
        models.slice(0, 3).forEach(model => {
          const costs = provider.calculateCosts(model.name, tokens, tokens / 2);
          console.log(`  ${model.name}: $${costs.totalCost.toFixed(6)}`);
        });
      } catch (error) {
        console.error(`Error with ${providerName}:`, error.message);
      }
    }
  });

program.parse();
```

### CLI Error Handling

```typescript
import { runCommand } from '../src/cli/run.js';

async function safeRunCommand(args: string[]) {
  try {
    const result = await runCommand(args);
    
    if (result.exitCode !== 0) {
      console.error('Command failed:', result.stderr);
      return null;
    }
    
    return result.stdout;
  } catch (error) {
    console.error('Unexpected error:', error);
    return null;
  }
}

// Usage
const output = await safeRunCommand(['run', 'Hello world', '--model', 'gpt-4']);
if (output) {
  console.log('Command output:', output);
}
```

### CLI Configuration

```typescript
import { loadConfig } from '../src/cli/config.js';

// Load CLI configuration
const config = await loadConfig();

// Use configuration
const defaultModel = config.defaultModel || 'gpt-4';
const apiKey = config.providers?.google?.apiKey;

console.log('Default model:', defaultModel);
console.log('Google API key configured:', !!apiKey);
```

## Best Practices

### 1. Command Structure

Follow consistent command structure:

```typescript
// Good: Clear command structure
program
  .command('evaluate')
  .description('Evaluate model performance')
  .option('-m, --model <model>', 'Model to evaluate')
  .option('-t, --task <task>', 'Evaluation task')
  .option('-o, --output <file>', 'Output file')
  .action(async (options) => {
    // Command implementation
  });

// Avoid: Inconsistent structure
program
  .command('eval')
  .option('model')
  .action(async (options) => {
    // Implementation
  });
```

### 2. Error Handling

Implement proper error handling for all commands:

```typescript
async function handleCommandError(error: Error, command: string) {
  if (error.message.includes('API key')) {
    console.error(`Error: Missing API key for ${command}`);
    console.error('Please set the appropriate environment variable.');
    process.exit(1);
  } else if (error.message.includes('rate limit')) {
    console.error('Error: Rate limit exceeded. Please try again later.');
    process.exit(1);
  } else {
    console.error(`Unexpected error in ${command}:`, error.message);
    process.exit(1);
  }
}

// Usage in commands
try {
  await executeCommand();
} catch (error) {
  handleCommandError(error, 'evaluate');
}
```

### 3. Output Formatting

Provide consistent and readable output:

```typescript
import chalk from 'chalk';

function formatModelList(models: ModelDetails[], options: ListModelsOptions) {
  if (options.json) {
    console.log(JSON.stringify(models, null, 2));
    return;
  }
  
  console.log(chalk.bold('\nAvailable Models:'));
  console.log(chalk.gray('─'.repeat(80)));
  
  models.forEach(model => {
    console.log(chalk.cyan(model.name));
    console.log(chalk.gray(`  Provider: ${model.provider}`));
    if (model.description) {
      console.log(chalk.gray(`  Description: ${model.description}`));
    }
    console.log('');
  });
}
```

### 4. Input Validation

Validate command inputs:

```typescript
import { z } from 'zod';

const EvaluationOptionsSchema = z.object({
  model: z.string().min(1, 'Model name is required'),
  task: z.string().min(1, 'Task is required'),
  input: z.string().optional(),
  inputFile: z.string().optional(),
  metrics: z.array(z.string()).optional()
});

function validateEvaluationOptions(options: any) {
  try {
    return EvaluationOptionsSchema.parse(options);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Validation errors:');
      error.errors.forEach(err => {
        console.error(`  ${err.path.join('.')}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
}
```

### 5. Progress Indicators

Show progress for long-running operations:

```typescript
import ora from 'ora';

async function runEvaluationWithProgress(options: EvaluationOptions) {
  const spinner = ora('Running evaluation...').start();
  
  try {
    const result = await evaluateModel(options);
    spinner.succeed('Evaluation completed');
    return result;
  } catch (error) {
    spinner.fail('Evaluation failed');
    throw error;
  }
}
```

## Integration with Other Packages

### With Providers Package

```typescript
import { getProvider } from '../src/providers/index.js';
import { listModels } from '../src/cli/models.js';

// CLI command using providers
async function listProviderModels(providerName: string) {
  const provider = getProvider(providerName);
  const models = await provider.getAvailableModels();
  
  console.log(`${providerName.toUpperCase()} MODELS:`);
  models.forEach(model => {
    console.log(`  ${model.name} - ${model.description || 'No description'}`);
  });
}
```

### With Cognition Package

```typescript
import { BaseModelRunner } from '../src/cognition/runner.js';
import { runCommand } from '../src/cli/run.js';

// CLI command using cognition
async function executeWithRunner(prompt: string, model: string) {
  const runner = new BaseModelRunner();
  const interaction = new Interaction({ name: model, provider: 'google' });
  interaction.addStimulus(new Stimulus(prompt));
  
  const response = await runner.generateText(interaction);
  return response.content;
}
```

### With Evaluation Package

```typescript
import { EvaluationRunner } from '../src/evaluation/runner.js';
import { evaluateModel } from '../src/cli/eval.js';

// CLI command using evaluation
async function runCustomEvaluation(options: EvaluationOptions) {
  const evaluator = new EvaluationRunner();
  const result = await evaluator.evaluate(options);
  
  console.log('Evaluation completed:');
  console.log(`  Score: ${result.score}`);
  console.log(`  Metrics: ${JSON.stringify(result.metrics)}`);
  
  return result;
}
```
