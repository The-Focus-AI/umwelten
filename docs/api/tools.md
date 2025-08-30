# Tools API Reference

Reference documentation for Umwelten's simplified tool calling system.

## Overview

The tool calling system is built on Vercel AI SDK's `tool()` helper, providing a streamlined approach to creating and using tools with AI models.

## Core Components

### Simple Registry

The tool registry manages available tools using a simple Map-based approach.

```typescript
import { toolRegistry, registerTool, getTool, listTools, getAllTools } from '../stimulus/tools/simple-registry.js';
```

#### `toolRegistry`

Global registry instance for managing tools.

```typescript
class SimpleToolRegistry {
  private tools = new Map<string, any>();

  register(name: string, toolDefinition: any): void
  get(name: string): any | undefined
  list(): string[]
  getAll(): Record<string, any>
  clear(): void
}
```

#### `registerTool(name: string, toolDefinition: any): void`

Register a tool with the global registry.

```typescript
import { registerTool } from '../stimulus/tools/simple-registry.js';
import { myTool } from './my-tool.js';

registerTool('myTool', myTool);
```

#### `getTool(name: string): any | undefined`

Retrieve a tool by name.

```typescript
import { getTool } from '../stimulus/tools/simple-registry.js';

const calculator = getTool('calculator');
if (calculator) {
  const result = await calculator.execute({ operation: 'add', a: 5, b: 3 });
}
```

#### `listTools(): string[]`

Get a list of all registered tool names.

```typescript
import { listTools } from '../stimulus/tools/simple-registry.js';

const toolNames = listTools();
console.log('Available tools:', toolNames);
// Output: ['calculator', 'statistics', 'randomNumber']
```

#### `getAllTools(): Record<string, any>`

Get all registered tools as an object.

```typescript
import { getAllTools } from '../stimulus/tools/simple-registry.js';

const tools = getAllTools();
console.log('Tool count:', Object.keys(tools).length);
```

## Tool Definition

### Creating Tools

Tools are defined using Vercel AI SDK's `tool()` helper:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

const myTool = tool({
  description: "Human-readable description of what the tool does",
  inputSchema: z.object({
    // Define your input parameters using Zod
    param1: z.string().describe("Description of parameter 1"),
    param2: z.number().describe("Description of parameter 2"),
  }),
  execute: async (params) => {
    // Your tool logic here
    console.log(`[TOOL_NAME] Called with:`, params);
    
    // Process parameters and return result
    return {
      result: "Tool execution result",
      metadata: {
        success: true,
        timestamp: new Date().toISOString()
      }
    };
  },
});
```

### Input Schema Design

Design flexible input schemas to handle various parameter formats:

```typescript
// Support multiple parameter formats
const flexibleSchema = z.object({
  numbers: z.array(z.number()).describe("Array of numbers")
}).or(z.object({
  data: z.array(z.number()).describe("Array of numbers")
})).or(z.object({
  values: z.array(z.number()).describe("Array of numbers")
}));

// Handle optional parameters
const optionalSchema = z.object({
  required: z.string().describe("Required parameter"),
  optional: z.number().optional().describe("Optional parameter"),
  withDefault: z.boolean().default(false).describe("Parameter with default")
});
```

### Tool Execution

The `execute` function receives validated parameters and returns results:

```typescript
execute: async (params) => {
  // Parameters are already validated by Zod
  const { operation, a, b } = params;
  
  // Perform tool logic
  let result;
  switch (operation) {
    case 'add': result = a + b; break;
    case 'subtract': result = a - b; break;
    case 'multiply': result = a * b; break;
    case 'divide': 
      if (b === 0) throw new Error("Division by zero");
      result = a / b; 
      break;
    default: throw new Error(`Unknown operation: ${operation}`);
  }
  
  // Return structured result
  return {
    operation,
    operands: [a, b],
    result,
    expression: `${a} ${getOperationSymbol(operation)} ${b} = ${result}`
  };
}
```

## Built-in Tools

### Calculator Tool

**Name**: `calculator`

**Description**: Performs basic arithmetic operations (add, subtract, multiply, divide)

**Input Schema**:
```typescript
const calculatorSchema = z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide"]),
  numbers: z.array(z.number()).length(2)
}).or(z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide"]),
  a: z.number(),
  b: z.number()
})).or(z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide"]),
  num1: z.number(),
  num2: z.number()
})).or(z.object({
  expression: z.string()
}));
```

**Usage**:
```typescript
const calculator = getTool('calculator');
const result = await calculator.execute({ 
  operation: 'add', 
  a: 5, 
  b: 3 
});
// Returns: { operation: 'add', operands: [5, 3], result: 8, expression: '5 + 3 = 8' }
```

### Statistics Tool

**Name**: `statistics`

**Description**: Calculates basic statistics (mean, median, mode, standard deviation) for a list of numbers

**Input Schema**:
```typescript
const statisticsSchema = z.object({
  numbers: z.array(z.number()).min(1)
}).or(z.object({
  data: z.array(z.number()).min(1)
}));
```

**Usage**:
```typescript
const statistics = getTool('statistics');
const result = await statistics.execute({ 
  numbers: [1, 2, 3, 4, 5] 
});
// Returns: { count: 5, mean: 3, median: 3, mode: null, standardDeviation: 1.414214, ... }
```

### Random Number Tool

**Name**: `randomNumber`

**Description**: Generates a random number within a specified range

**Input Schema**:
```typescript
const randomNumberSchema = z.object({
  min: z.number(),
  max: z.number(),
  integer: z.boolean().default(false)
}).or(z.object({
  min: z.number(),
  max: z.number()
}));
```

**Usage**:
```typescript
const randomNumber = getTool('randomNumber');
const result = await randomNumber.execute({ 
  min: 1, 
  max: 100, 
  integer: true 
});
// Returns: { value: 73, range: { min: 1, max: 100 }, type: "integer" }
```

## CLI Integration

### Tools Command

List available tools:

```bash
umwelten tools list
```

Run interactive demo:

```bash
umwelten tools demo
umwelten tools demo --prompt "Calculate 25 * 4, then generate a random number"
umwelten tools demo --max-steps 3
```

### Chat Integration

Use tools in chat sessions:

```bash
umwelten chat --provider ollama --model qwen3:latest --tools calculator,statistics
```

## Integration with Interaction System

### Setting Tools

```typescript
import { Interaction } from '../interaction/interaction.js';
import { getAllTools } from '../stimulus/tools/simple-registry.js';

const interaction = new Interaction(modelDetails, systemPrompt);
const tools = getAllTools();
interaction.setTools(tools);
```

### Tool Execution Flow

1. **Tool Registration**: Tools are registered when imported
2. **Tool Discovery**: CLI discovers tools via `getTool()` function
3. **Tool Execution**: Models call tools through Vercel AI SDK
4. **Result Processing**: Tool results are returned to the model

## Error Handling

### Validation Errors

Zod automatically validates input parameters:

```typescript
// Invalid parameters throw ZodError
try {
  await calculator.execute({ operation: 'add', a: 'invalid', b: 3 });
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Validation error:', error.errors);
  }
}
```

### Execution Errors

Handle errors in tool execution:

```typescript
execute: async (params) => {
  try {
    // Tool logic
    return result;
  } catch (error) {
    // Return error information
    return {
      error: error instanceof Error ? error.message : String(error),
      success: false
    };
  }
}
```

## Best Practices

### Tool Design

1. **Clear Descriptions**: Write descriptive tool descriptions
2. **Flexible Schemas**: Support multiple input formats
3. **Error Handling**: Graceful error handling and feedback
4. **Logging**: Include logging for debugging
5. **Validation**: Use Zod for robust parameter validation

### Performance

1. **Async Operations**: Use async/await for I/O operations
2. **Caching**: Cache expensive operations when appropriate
3. **Resource Management**: Clean up resources properly
4. **Timeout Handling**: Implement timeouts for external calls

### Security

1. **Input Validation**: Always validate and sanitize inputs
2. **Rate Limiting**: Implement rate limiting for external APIs
3. **Error Messages**: Don't expose sensitive information in errors
4. **Access Control**: Implement appropriate access controls

## Examples

### Custom Weather Tool

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { registerTool } from '../stimulus/tools/simple-registry.js';

const weatherSchema = z.object({
  city: z.string().describe("City name to get weather for"),
  units: z.enum(["celsius", "fahrenheit"]).default("celsius")
});

export const weatherTool = tool({
  description: "Get current weather information for a city",
  inputSchema: weatherSchema,
  execute: async (params) => {
    console.log(`[WEATHER] Called with:`, params);
    
    // Simulate API call
    const { city, units } = params;
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

registerTool('weather', weatherTool);
```

### File Analysis Tool

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { registerTool } from '../stimulus/tools/simple-registry.js';
import fs from 'fs/promises';

const fileSchema = z.object({
  path: z.string().describe("Path to the file to analyze"),
  analysis: z.enum(["size", "content", "metadata"]).default("content")
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
          lastModified: stats.mtime.toISOString()
        };
      }
      
      if (analysis === 'content') {
        const content = await fs.readFile(path, 'utf-8');
        return {
          path,
          content: content.substring(0, 1000) + (content.length > 1000 ? '...' : ''),
          length: content.length,
          lines: content.split('\n').length
        };
      }
      
      return {
        path,
        exists: true,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        permissions: stats.mode.toString(8)
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

## Migration from Old System

The new simplified system replaces the complex `ToolDefinition` interface:

### Before (Complex)
```typescript
interface ToolDefinition<TParameters extends z.ZodSchema> {
  name: string;
  description: string;
  parameters: TParameters;
  execute: (args: z.infer<TParameters>, context: ToolExecutionContext) => Promise<ToolExecutionResult>;
  metadata?: { category?: string; tags?: string[]; version?: string; experimental?: boolean; };
}
```

### After (Simple)
```typescript
const myTool = tool({
  description: "Tool description",
  inputSchema: z.object({ /* parameters */ }),
  execute: async (params) => { /* logic */ }
});
```

### Key Changes

1. **No custom interface**: Use Vercel AI SDK's `tool()` helper directly
2. **Simplified registration**: Just call `registerTool(name, tool)`
3. **Direct execution**: No conversion layers or complex contexts
4. **Built-in validation**: Zod schemas handle validation automatically
5. **Streamlined API**: Fewer abstractions, more direct usage
