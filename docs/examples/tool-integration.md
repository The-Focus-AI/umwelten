# Tool Integration Examples

Real-world examples of using Umwelten's tool calling system for various scenarios.

## Overview

This guide demonstrates practical applications of tool calling in different contexts, from simple calculations to complex data analysis workflows.

## Basic Mathematical Operations

### Simple Calculator Usage

**Scenario**: Basic arithmetic operations in a chat session.

```bash
# Start chat with calculator tool
umwelten chat --provider ollama --model qwen3:latest --tools calculator
```

**Example Conversation**:
```
You: What is 15 * 27?
Model: Let me calculate that for you using the calculator tool.

[CALCULATOR] Called with: { operation: 'multiply', a: 15, b: 27 }
[TOOL CALL] calculator called with: { operation: 'multiply', a: 15, b: 27 }
[TOOL RESULT] calculator result: { operation: 'multiply', operands: [15, 27], result: 405, expression: '15 * 27 = 405' }

The result of 15 * 27 is 405.
```

### Complex Mathematical Expressions

**Scenario**: Parsing and evaluating mathematical expressions.

```bash
umwelten chat --provider ollama --model qwen3:latest --tools calculator
```

**Example Conversation**:
```
You: Calculate 100 / 4 + 7 * 3
Model: I'll break this down into steps using the calculator.

[CALCULATOR] Called with: { expression: '100 / 4' }
[TOOL RESULT] calculator result: { operation: 'divide', operands: [100, 4], result: 25, expression: '100 / 4 = 25' }

[CALCULATOR] Called with: { expression: '7 * 3' }
[TOOL RESULT] calculator result: { operation: 'multiply', operands: [7, 3], result: 21, expression: '7 * 3 = 21' }

[CALCULATOR] Called with: { operation: 'add', a: 25, b: 21 }
[TOOL RESULT] calculator result: { operation: 'add', operands: [25, 21], result: 46, expression: '25 + 21 = 46' }

The result of 100 / 4 + 7 * 3 is 46.
```

## Data Analysis with Statistics

### Basic Statistical Analysis

**Scenario**: Analyzing numerical datasets.

```bash
umwelten chat --provider ollama --model qwen3:latest --tools statistics
```

**Example Conversation**:
```
You: Calculate statistics for the numbers [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
Model: I'll analyze this dataset using the statistics tool.

[STATISTICS] Called with: { numbers: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] }
[TOOL RESULT] statistics result: {
  count: 10,
  mean: 55,
  median: 55,
  mode: null,
  standardDeviation: 28.722813,
  min: 10,
  max: 100,
  range: 90
}

Here's the statistical analysis of your dataset:
- **Count**: 10 numbers
- **Mean (Average)**: 55
- **Median**: 55 (middle value)
- **Mode**: None (no repeated values)
- **Standard Deviation**: 28.72 (measure of spread)
- **Range**: 90 (difference between min and max)
- **Minimum**: 10
- **Maximum**: 100

This appears to be a linear sequence with equal spacing between values.
```

### Comparing Multiple Datasets

**Scenario**: Analyzing and comparing different datasets.

```bash
umwelten chat --provider ollama --model qwen3:latest --tools statistics
```

**Example Conversation**:
```
You: Compare the statistics of [1, 2, 3, 4, 5] and [10, 20, 30, 40, 50]
Model: I'll analyze both datasets and compare them.

[STATISTICS] Called with: { numbers: [1, 2, 3, 4, 5] }
[TOOL RESULT] statistics result: { count: 5, mean: 3, median: 3, mode: null, standardDeviation: 1.414214, min: 1, max: 5, range: 4 }

[STATISTICS] Called with: { numbers: [10, 20, 30, 40, 50] }
[TOOL RESULT] statistics result: { count: 5, mean: 30, median: 30, mode: null, standardDeviation: 14.142136, min: 10, max: 50, range: 40 }

**Dataset 1**: [1, 2, 3, 4, 5]
- Mean: 3, Median: 3, Range: 4, Std Dev: 1.41

**Dataset 2**: [10, 20, 30, 40, 50]
- Mean: 30, Median: 30, Range: 40, Std Dev: 14.14

**Comparison**:
- Both datasets have the same number of values (5)
- Dataset 2 has values 10x larger than Dataset 1
- Both have the same relative spread (standard deviation scales with the values)
- Both are linear sequences with equal spacing
```

## Random Number Generation

### Basic Random Number Generation

**Scenario**: Generating random numbers for various purposes.

```bash
umwelten chat --provider ollama --model qwen3:latest --tools randomNumber
```

**Example Conversation**:
```
You: Generate a random number between 1 and 100
Model: I'll generate a random number for you.

[RANDOM] Called with: { min: 1, max: 100, integer: true }
[TOOL RESULT] randomNumber result: { value: 73, range: { min: 1, max: 100 }, type: "integer" }

The random number between 1 and 100 is: **73**
```

### Multiple Random Numbers

**Scenario**: Generating multiple random numbers for different purposes.

```bash
umwelten chat --provider ollama --model qwen3:latest --tools randomNumber
```

**Example Conversation**:
```
You: Generate 3 random numbers: one integer between 1-10, one decimal between 0-1, and one integer between 100-1000
Model: I'll generate three different random numbers for you.

[RANDOM] Called with: { min: 1, max: 10, integer: true }
[TOOL RESULT] randomNumber result: { value: 7, range: { min: 1, max: 10 }, type: "integer" }

[RANDOM] Called with: { min: 0, max: 1, integer: false }
[TOOL RESULT] randomNumber result: { value: 0.847392, range: { min: 0, max: 1 }, type: "decimal" }

[RANDOM] Called with: { min: 100, max: 1000, integer: true }
[TOOL RESULT] randomNumber result: { value: 847, range: { min: 100, max: 1000 }, type: "integer" }

Here are your three random numbers:
1. **Integer (1-10)**: 7
2. **Decimal (0-1)**: 0.847392
3. **Integer (100-1000)**: 847
```

## Multi-Tool Workflows

### Complex Mathematical Workflows

**Scenario**: Combining multiple tools for complex calculations.

```bash
umwelten chat --provider ollama --model qwen3:latest --tools calculator,statistics,randomNumber
```

**Example Conversation**:
```
You: Calculate 15 + 27, then generate a random number between 1 and 100, and finally calculate statistics for [10, 20, 30, 40, 50]
Model: I'll perform these three operations for you.

[CALCULATOR] Called with: { operation: 'add', a: 15, b: 27 }
[TOOL RESULT] calculator result: { operation: 'add', operands: [15, 27], result: 42, expression: '15 + 27 = 42' }

[RANDOM] Called with: { min: 1, max: 100, integer: true }
[TOOL RESULT] randomNumber result: { value: 73, range: { min: 1, max: 100 }, type: "integer" }

[STATISTICS] Called with: { numbers: [10, 20, 30, 40, 50] }
[TOOL RESULT] statistics result: { count: 5, mean: 30, median: 30, mode: null, standardDeviation: 14.142136, min: 10, max: 50, range: 40 }

**Results**:
1. **15 + 27 = 42**
2. **Random number (1-100)**: 73
3. **Statistics for [10, 20, 30, 40, 50]**:
   - Mean: 30, Median: 30, Range: 40
   - Standard Deviation: 14.14
```

### Data Analysis Workflow

**Scenario**: Generating data and analyzing it.

```bash
umwelten chat --provider ollama --model qwen3:latest --tools calculator,statistics,randomNumber
```

**Example Conversation**:
```
You: Generate 5 random numbers between 1 and 50, then calculate their statistics
Model: I'll generate 5 random numbers and then analyze them.

[RANDOM] Called with: { min: 1, max: 50, integer: true }
[TOOL RESULT] randomNumber result: { value: 23, range: { min: 1, max: 50 }, type: "integer" }

[RANDOM] Called with: { min: 1, max: 50, integer: true }
[TOOL RESULT] randomNumber result: { value: 7, range: { min: 1, max: 50 }, type: "integer" }

[RANDOM] Called with: { min: 1, max: 50, integer: true }
[TOOL RESULT] randomNumber result: { value: 41, range: { min: 1, max: 50 }, type: "integer" }

[RANDOM] Called with: { min: 1, max: 50, integer: true }
[TOOL RESULT] randomNumber result: { value: 15, range: { min: 1, max: 50 }, type: "integer" }

[RANDOM] Called with: { min: 1, max: 50, integer: true }
[TOOL RESULT] randomNumber result: { value: 38, range: { min: 1, max: 50 }, type: "integer" }

[STATISTICS] Called with: { numbers: [23, 7, 41, 15, 38] }
[TOOL RESULT] statistics result: { count: 5, mean: 24.8, median: 23, mode: null, standardDeviation: 13.2, min: 7, max: 41, range: 34 }

**Generated Numbers**: [23, 7, 41, 15, 38]

**Statistical Analysis**:
- **Count**: 5 numbers
- **Mean**: 24.8
- **Median**: 23 (middle value when sorted)
- **Range**: 34 (from 7 to 41)
- **Standard Deviation**: 13.2 (measure of spread)
- **Minimum**: 7
- **Maximum**: 41

The numbers are fairly well distributed across the range, with a mean close to the middle of the 1-50 range.
```

## Interactive Tool Demo

### Running the Built-in Demo

**Scenario**: Testing tool functionality with the interactive demo.

```bash
# Run the default demo
umwelten tools demo

# Run with custom prompt
umwelten tools demo --prompt "Calculate 25 * 4, then generate a random number between 1 and 50"

# Run with step limit
umwelten tools demo --max-steps 3
```

**Example Demo Output**:
```
🚀 Starting tools demonstration...

📝 User prompt: Calculate 15 + 27, then generate a random number between 1 and 100, and finally calculate statistics for the numbers [10, 20, 30, 40, 50]
🔧 Available tools: calculator, randomNumber, statistics
🔄 Max steps: 5

🤖 AI Response:

[CALCULATOR] Called with: { operation: 'add', a: 15, b: 27 }
[TOOL RESULT] calculator result: { operation: 'add', operands: [15, 27], result: 42, expression: '15 + 27 = 42' }

[RANDOM] Called with: { min: 1, max: 100, integer: true }
[TOOL RESULT] randomNumber result: { value: 73, range: { min: 1, max: 100 }, type: "integer" }

[STATISTICS] Called with: { numbers: [10, 20, 30, 40, 50] }
[TOOL RESULT] statistics result: { count: 5, mean: 30, median: 30, mode: null, standardDeviation: 14.142136, min: 10, max: 50, range: 40 }

**Results**:
1. 15 + 27 = 42
2. Random number: 73
3. Statistics: Mean=30, Median=30, Range=40

✅ Demo completed successfully!
```

## Custom Tool Development

### Creating a Weather Tool

**Scenario**: Building a custom tool for weather information.

```typescript
// weather-tool.ts
import { tool } from 'ai';
import { z } from 'zod';
import { registerTool } from '../stimulus/tools/simple-registry.js';

const weatherSchema = z.object({
  city: z.string().describe("City name to get weather for"),
  units: z.enum(["celsius", "fahrenheit"]).default("celsius").describe("Temperature units")
});

export const weatherTool = tool({
  description: "Get current weather information for a city",
  inputSchema: weatherSchema,
  execute: async (params) => {
    console.log(`[WEATHER] Called with:`, params);
    
    const { city, units } = params;
    
    // Simulate API call (replace with real weather API)
    const temperature = Math.random() * 30 + 10;
    const condition = ["sunny", "cloudy", "rainy", "snowy"][Math.floor(Math.random() * 4)];
    const humidity = Math.floor(Math.random() * 40) + 30;
    
    return {
      city,
      temperature: Math.round(temperature),
      condition,
      humidity: `${humidity}%`,
      units,
      timestamp: new Date().toISOString()
    };
  },
});

registerTool('weather', weatherTool);
```

**Usage**:
```bash
# Import the custom tool
import './weather-tool.js';

# Use in chat
umwelten chat --provider ollama --model qwen3:latest --tools weather
```

**Example Conversation**:
```
You: What's the weather like in San Francisco?
Model: I'll check the weather in San Francisco for you.

[WEATHER] Called with: { city: 'San Francisco', units: 'celsius' }
[TOOL RESULT] weather result: { city: 'San Francisco', temperature: 18, condition: 'cloudy', humidity: '45%', units: 'celsius', timestamp: '2024-01-15T10:30:00.000Z' }

The current weather in San Francisco is:
- **Temperature**: 18°C
- **Condition**: Cloudy
- **Humidity**: 45%
- **Time**: 10:30 AM

It's a mild, cloudy day in San Francisco with moderate humidity.
```

### Creating a File Analysis Tool

**Scenario**: Building a tool to analyze file properties.

```typescript
// file-analysis-tool.ts
import { tool } from 'ai';
import { z } from 'zod';
import { registerTool } from '../stimulus/tools/simple-registry.js';
import fs from 'fs/promises';

const fileSchema = z.object({
  path: z.string().describe("Path to the file to analyze"),
  analysis: z.enum(["size", "content", "metadata"]).default("metadata").describe("Type of analysis to perform")
});

export const fileAnalysisTool = tool({
  description: "Analyze file content, size, or metadata",
  inputSchema: fileSchema,
  execute: async (params) => {
    console.log(`[FILE_ANALYSIS] Called with:`, params);
    
    const { path, analysis } = params;
    
    try {
      const stats = await fs.stat(path);
      
      if (analysis === 'size') {
        return {
          path,
          size: stats.size,
          sizeInKB: Math.round(stats.size / 1024),
          sizeInMB: Math.round(stats.size / (1024 * 1024) * 100) / 100,
          lastModified: stats.mtime.toISOString()
        };
      }
      
      if (analysis === 'content') {
        const content = await fs.readFile(path, 'utf-8');
        return {
          path,
          content: content.substring(0, 1000) + (content.length > 1000 ? '...' : ''),
          length: content.length,
          lines: content.split('\n').length,
          words: content.split(/\s+/).length
        };
      }
      
      return {
        path,
        exists: true,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        size: stats.size,
        permissions: stats.mode.toString(8),
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString()
      };
    } catch (error) {
      return {
        path,
        error: error instanceof Error ? error.message : String(error),
        exists: false
      };
    }
  },
});

registerTool('fileAnalysis', fileAnalysisTool);
```

## Best Practices

### Tool Selection

- **Choose relevant tools**: Select tools that match your use case
- **Combine effectively**: Use multiple tools for complex tasks
- **Provide context**: Give tools the information they need

### Error Handling

- **Validate inputs**: Use Zod schemas for robust validation
- **Handle failures**: Graceful error handling and user feedback
- **Log operations**: Include logging for debugging

### Performance

- **Async operations**: Use async/await for I/O operations
- **Caching**: Cache expensive operations when appropriate
- **Resource management**: Clean up resources properly

## Next Steps

- **Explore MCP Integration**: Connect external tools via Model Context Protocol
- **Build Custom Tools**: Create specialized tools for your domain
- **Tool Composition**: Combine tools for complex workflows
- **Performance Optimization**: Optimize tool execution for speed and cost

For more advanced tool development, see the [API Reference](../api/tools.md) and [Tool Calling Guide](../guide/tool-calling.md).
