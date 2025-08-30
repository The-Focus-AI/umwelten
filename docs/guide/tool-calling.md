# Tool Calling

Learn how to use Umwelten's simplified tool calling system to enhance AI model capabilities with external functions.

## Overview

Umwelten provides a streamlined tool calling system built on Vercel AI SDK, allowing AI models to execute external functions during conversations. This enables:

- **Mathematical operations**: Calculator, statistics, random number generation
- **Data processing**: File analysis, web searches, API calls
- **Code execution**: Running and testing code snippets
- **Custom functions**: Your own specialized tools

## Quick Start

### Basic Tool Usage

Use tools in chat sessions:

```bash
# Chat with calculator and statistics tools
umwelten chat --provider ollama --model qwen3:latest --tools calculator,statistics

# Use with premium models
umwelten chat --provider openrouter --model openai/gpt-4o --tools calculator,statistics
```

### List Available Tools

See what tools are available:

```bash
# List all tools
umwelten tools list

# Output shows:
# 📋 calculator
#    Description: Performs basic arithmetic operations (add, subtract, multiply, divide)
# 📋 randomNumber
#    Description: Generates a random number within a specified range
# 📋 statistics
#    Description: Calculates basic statistics (mean, median, mode, standard deviation) for a list of numbers
```

## Built-in Tools

### Calculator Tool

Performs basic arithmetic operations with flexible input formats.

**Usage Examples**:
```bash
# Direct calculation
umwelten chat --provider ollama --model qwen3:latest --tools calculator
# User: "What is 15 * 27?"

# Expression parsing
# User: "Calculate 100 / 4 + 7"
```

**Supported Operations**:
- Addition (`add`)
- Subtraction (`subtract`) 
- Multiplication (`multiply`)
- Division (`divide`)

**Input Formats**:
- `{ operation: "add", a: 5, b: 3 }`
- `{ operation: "multiply", numbers: [10, 20] }`
- `{ operation: "divide", num1: 100, num2: 4 }`
- `{ expression: "15 * 27" }`

### Statistics Tool

Calculates comprehensive statistics for numerical data.

**Usage Examples**:
```bash
umwelten chat --provider ollama --model qwen3:latest --tools statistics
# User: "Calculate statistics for [10, 20, 30, 40, 50]"
```

**Calculated Metrics**:
- Mean (average)
- Median (middle value)
- Mode (most frequent value)
- Standard deviation
- Minimum and maximum values
- Range

**Input Formats**:
- `{ numbers: [1, 2, 3, 4, 5] }`
- `{ data: [10, 20, 30, 40, 50] }`

### Random Number Tool

Generates random numbers within specified ranges.

**Usage Examples**:
```bash
umwelten chat --provider ollama --model qwen3:latest --tools randomNumber
# User: "Generate a random number between 1 and 100"
```

**Features**:
- Integer or decimal generation
- Configurable range
- Inclusive/exclusive bounds

**Input Formats**:
- `{ min: 1, max: 100, integer: true }`
- `{ min: 0, max: 1, integer: false }`

## Tool Demo

Test tool functionality with the built-in demo:

```bash
# Run interactive tool demo
umwelten tools demo

# Custom demo with specific prompt
umwelten tools demo --prompt "Calculate 25 * 4, then generate a random number between 1 and 50"

# Demo with step limit
umwelten tools demo --max-steps 3
```

## Creating Custom Tools

### Simple Tool Definition

Create tools using Vercel AI SDK's `tool()` helper:

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { registerTool } from '../stimulus/tools/simple-registry.js';

// Define input schema
const weatherSchema = z.object({
  city: z.string().describe("City name to get weather for"),
  units: z.enum(["celsius", "fahrenheit"]).default("celsius").describe("Temperature units")
});

// Create tool
export const weatherTool = tool({
  description: "Get current weather information for a city",
  inputSchema: weatherSchema,
  execute: async (params) => {
    console.log(`[WEATHER] Called with:`, params);
    
    // Your weather API logic here
    const { city, units } = params;
    
    // Simulate API call
    const temperature = Math.random() * 30 + 10;
    const condition = ["sunny", "cloudy", "rainy"][Math.floor(Math.random() * 3)];
    
    return {
      city,
      temperature: Math.round(temperature),
      condition,
      units,
      timestamp: new Date().toISOString()
    };
  },
});

// Register the tool
registerTool('weather', weatherTool);
```

### Tool Registration

Tools are automatically registered when imported:

```typescript
// In your tool file
import { registerTool } from '../stimulus/tools/simple-registry.js';

// Register immediately after definition
registerTool('myTool', myTool);
```

### Tool Structure

Each tool consists of:

1. **Description**: Human-readable explanation of what the tool does
2. **Input Schema**: Zod schema defining expected parameters
3. **Execute Function**: Async function that performs the tool's work
4. **Registration**: Adding the tool to the global registry

## Advanced Usage

### Multiple Tools

Combine multiple tools for complex tasks:

```bash
# Use multiple tools in one session
umwelten chat --provider ollama --model qwen3:latest --tools calculator,statistics,randomNumber

# Example conversation:
# User: "Calculate 15 + 27, then generate a random number between 1 and 100, 
#       and finally calculate statistics for [10, 20, 30, 40, 50]"
```

### Tool Chaining

Models can chain multiple tool calls:

```bash
# The model will automatically:
# 1. Calculate 15 + 27 = 42
# 2. Generate random number (e.g., 73)
# 3. Calculate statistics for the array
# 4. Provide a comprehensive response
```

### Error Handling

Tools include robust error handling:

- **Parameter validation**: Automatic validation using Zod schemas
- **Execution errors**: Graceful handling of API failures
- **User feedback**: Clear error messages for debugging

## Best Practices

### Tool Selection

- **Choose relevant tools**: Select tools that match your use case
- **Combine effectively**: Use multiple tools for complex tasks
- **Provide context**: Give tools the information they need

### Input Format Flexibility

Design tools to handle multiple input formats:

```typescript
// Support various parameter names
const schema = z.object({
  numbers: z.array(z.number())
}).or(z.object({
  data: z.array(z.number())
}));
```

### Logging and Debugging

Include logging in tool execution:

```typescript
execute: async (params) => {
  console.log(`[TOOL_NAME] Called with:`, params);
  // ... tool logic
  return result;
}
```

## Troubleshooting

### Common Issues

**Tool not found**:
```bash
# Check if tool is registered
umwelten tools list

# Verify tool name spelling
umwelten chat --tools calculator  # ✅ Correct
umwelten chat --tools Calculator  # ❌ Wrong case
```

**Tool execution errors**:
- Check console output for detailed error messages
- Verify input parameters match expected schema
- Ensure external APIs are accessible

**Model not using tools**:
- Confirm model supports tool calling (e.g., `qwen3:latest`, `gpt-4o`)
- Check tool descriptions are clear and helpful
- Verify prompt encourages tool usage

### Debug Mode

Enable debug logging:

```bash
DEBUG=1 umwelten chat --provider ollama --model qwen3:latest --tools calculator
```

## Integration with Other Features

### Memory and Tools

Combine tools with memory for persistent context:

```bash
umwelten chat --provider ollama --model qwen3:latest --tools calculator --memory
```

### Structured Output

Use tools with structured output:

```bash
umwelten chat --provider ollama --model qwen3:latest --tools calculator --output-format json
```

### Batch Processing

Tools work with batch processing:

```bash
umwelten run "Calculate 10 * 5" --provider ollama --model qwen3:latest --tools calculator
```

## Next Steps

- **Explore MCP Integration**: Connect external tools via Model Context Protocol
- **Build Custom Tools**: Create specialized tools for your domain
- **Tool Composition**: Combine tools for complex workflows
- **Performance Optimization**: Optimize tool execution for speed and cost

For more advanced tool development, see the [API Reference](../api/tools.md) and [Examples](../examples/tool-integration.md).
