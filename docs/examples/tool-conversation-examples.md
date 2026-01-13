# Tool Conversation Examples

Test how well AI models handle tool-calling in multi-step conversations.

## Overview

The tool conversation testing framework evaluates model capabilities for:
- Selecting the correct tool from available options
- Passing appropriate parameters to tools
- Using tool results in subsequent conversation turns
- Maintaining context across multiple steps

## Running the Examples

```bash
# Run the tool conversation tests
npx tsx src/test/test-tool-conversations.ts
```

## Framework Components

### ConversationRunner

Orchestrates multi-step conversations with tool use:

```typescript
import { ConversationRunner, ToolTestScenario } from '../evaluation/tool-testing/index.js';

const runner = new ConversationRunner({
  verbose: true,
  maxConcurrent: 1,
  defaultTimeout: 30000,
  enableAIScoring: false // Set to true for AI-based scoring
});
```

### ToolTestScenario

Defines a complete test scenario with steps and validation:

```typescript
interface ToolTestScenario {
  name: string;                    // Scenario identifier
  description?: string;            // What's being tested
  stimulus: Stimulus;              // Configuration with tools
  steps: ConversationStep[];       // Conversation steps
  models: ModelDetails[];          // Models to test
  timeout?: number;                // Timeout per step
}
```

## Example 1: Basic Calculator

Testing single-tool usage:

```typescript
import { calculatorTool } from '../stimulus/tools/index.js';
import { Stimulus } from '../stimulus/stimulus.js';

const basicCalculatorScenario: ToolTestScenario = {
  name: 'Basic Calculator',
  description: 'Simple single-step calculator usage',
  stimulus: new Stimulus({
    role: 'math assistant with calculator access',
    objective: 'Use the calculator tool to perform calculations',
    tools: { calculator: calculatorTool },
    maxToolSteps: 3,
  }),
  steps: [
    {
      role: 'user',
      content: 'What is 15 + 27?',
      expectedToolCalls: [
        {
          toolName: 'calculator',
          parameters: (p: any) =>
            p.operation === 'add' ||
            (p.expression && p.expression.includes('+')),
        },
      ],
      validation: {
        contentContains: ['42'],
      },
    },
  ],
  models: [{ name: 'gpt-oss:latest', provider: 'ollama' }],
  timeout: 30000,
};
```

## Example 2: Multi-Step Calculator

Testing context retention across turns:

```typescript
const multiStepScenario: ToolTestScenario = {
  name: 'Multi-Step Calculator',
  description: "Test model's ability to chain calculator operations",
  stimulus: new Stimulus({
    role: 'math assistant with calculator access',
    objective: 'Use the calculator tool to perform calculations. Remember previous results.',
    tools: { calculator: calculatorTool },
    maxToolSteps: 5,
  }),
  steps: [
    {
      role: 'user',
      content: 'What is 15 + 27?',
      expectedToolCalls: [{ toolName: 'calculator' }],
      validation: { contentContains: ['42'] },
    },
    {
      role: 'user',
      content: 'Now multiply that result by 2',
      expectedToolCalls: [
        {
          toolName: 'calculator',
          parameters: (p: any) =>
            p.operation === 'multiply' ||
            (p.expression && p.expression.includes('*')),
        },
      ],
      validation: { contentContains: ['84'] },
    },
  ],
  models: [{ name: 'gpt-oss:latest', provider: 'ollama' }],
  timeout: 45000,
};
```

## Example 3: Tool Selection

Testing correct tool selection from multiple options:

```typescript
import { calculatorTool, statisticsTool } from '../stimulus/tools/index.js';

const toolSelectionScenario: ToolTestScenario = {
  name: 'Tool Selection',
  description: "Test model's ability to select the correct tool",
  stimulus: new Stimulus({
    role: 'helpful assistant with math tools',
    objective: 'Use the appropriate tool for each task',
    tools: {
      calculator: calculatorTool,
      statistics: statisticsTool,
    },
    maxToolSteps: 3,
  }),
  steps: [
    {
      role: 'user',
      content: 'Calculate the mean of [10, 20, 30, 40, 50]',
      expectedToolCalls: [
        {
          toolName: 'statistics',
          parameters: (p: any) =>
            ('numbers' in p && Array.isArray(p.numbers)) ||
            ('data' in p && Array.isArray(p.data)),
        },
      ],
      validation: { contentContains: ['30'] },
    },
  ],
  models: [{ name: 'gpt-oss:latest', provider: 'ollama' }],
  timeout: 30000,
};
```

## Example 4: Multiple Tools in Sequence

Testing use of different tools across conversation:

```typescript
import {
  calculatorTool,
  statisticsTool,
  randomNumberTool
} from '../stimulus/tools/index.js';

const multipleToolsScenario: ToolTestScenario = {
  name: 'Multiple Tools',
  description: 'Test using multiple different tools in sequence',
  stimulus: new Stimulus({
    role: 'helpful assistant with math tools',
    objective: 'Use the available tools to help with calculations',
    tools: {
      calculator: calculatorTool,
      statistics: statisticsTool,
      randomNumber: randomNumberTool,
    },
    maxToolSteps: 5,
  }),
  steps: [
    {
      role: 'user',
      content: 'Generate a random integer between 1 and 10',
      expectedToolCalls: [{ toolName: 'randomNumber' }],
      validation: { toolCallCount: { min: 1 } },
    },
    {
      role: 'user',
      content: 'Now add 5 to that number',
      expectedToolCalls: [
        {
          toolName: 'calculator',
          parameters: (p: any) => p.operation === 'add',
        },
      ],
    },
  ],
  models: [{ name: 'gpt-oss:latest', provider: 'ollama' }],
  timeout: 45000,
};
```

## Running Scenarios

Execute scenarios and generate reports:

```typescript
import { ConversationRunner } from '../evaluation/tool-testing/index.js';
import { Reporter } from '../reporting/index.js';

async function main() {
  // Create runner
  const runner = new ConversationRunner({
    verbose: true,
    maxConcurrent: 1,
    defaultTimeout: 30000,
  });

  // Define scenarios array
  const scenarios = [
    basicCalculatorScenario,
    multiStepScenario,
    toolSelectionScenario,
    multipleToolsScenario,
  ];

  // Run all scenarios
  const results = await runner.runScenarios(scenarios);

  // Generate reports
  const reporter = new Reporter({ outputDir: './reports' });
  const report = reporter.fromToolTest(results, 'Tool Conversation Evaluation');

  // Output to console
  reporter.toConsole(report);

  // Save markdown report
  const filepath = await reporter.toFile(report);
  console.log(`Report saved to: ${filepath}`);

  // Check for failures
  const failedCount = results.filter((r) => !r.passed).length;
  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
```

## Validation Options

### Content Validation

```typescript
validation: {
  contentContains: ['expected', 'strings'],  // Must contain all
  contentMatches: /regex pattern/,           // Must match regex
}
```

### Tool Call Validation

```typescript
validation: {
  toolCallCount: { min: 1, max: 3 },  // Expected call count
}
```

### Custom Validation

```typescript
validation: {
  custom: (response, toolCalls) => {
    // Custom validation logic
    return response.content.length > 100;
  }
}
```

## Expected Tool Call Patterns

### Exact Match

```typescript
expectedToolCalls: [
  {
    toolName: 'calculator',
    parameters: { operation: 'add', a: 15, b: 27 },
  }
]
```

### Predicate Function

```typescript
expectedToolCalls: [
  {
    toolName: 'calculator',
    parameters: (p) => p.operation === 'add' && p.a + p.b === 42,
  }
]
```

### Optional Tool Calls

```typescript
expectedToolCalls: [
  {
    toolName: 'helper',
    required: false,  // Won't fail if not called
  }
]
```

## Result Types

### ToolTestResult

```typescript
interface ToolTestResult {
  scenario: string;              // Scenario name
  model: ModelDetails;           // Model tested
  steps: StepValidationResult[]; // Results per step
  passed: boolean;               // Overall pass/fail
  score?: number;                // Score (0-100)
  timing: {
    total: number;
    perStep: number[];
  };
  errors: string[];
}
```

### StepValidationResult

```typescript
interface StepValidationResult {
  passed: boolean;
  failures: string[];
  toolCalls: ToolCall[];
  response: ModelResponse;
  duration: number;
}
```

## Full Test Script

See the complete test implementation at `src/test/test-tool-conversations.ts`:

```bash
npx tsx src/test/test-tool-conversations.ts
```

## Requirements

- Ollama running locally (`ollama serve`)
- A model with tool calling support (e.g., `gpt-oss:latest`)

## Related Documentation

- [Tool Calling Guide](/guide/tool-calling) - How tool calling works
- [Tool Integration](/examples/tool-integration) - Basic tool examples
- [Code Execution Examples](/examples/code-execution-examples) - Running generated code
