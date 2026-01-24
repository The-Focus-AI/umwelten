#!/usr/bin/env npx tsx

/**
 * Multi-step tool conversation evaluation
 *
 * Evaluates how well different models handle tool-calling in multi-step conversations.
 *
 * Run with: npx tsx src/test/test-tool-conversations.ts
 */

import { ConversationRunner, ToolTestScenario } from '../evaluation/tool-testing/index.js';
import {
  calculatorTool,
  statisticsTool,
  randomNumberTool,
} from '../stimulus/tools/index.js';
import { Stimulus } from '../stimulus/stimulus.js';
import { checkOllamaConnection } from '../test-utils/setup.js';
import { Reporter } from '../reporting/index.js';

// Define test scenarios
const scenarios: ToolTestScenario[] = [
  {
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
  },

  {
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
        expectedToolCalls: [
          {
            toolName: 'calculator',
          },
        ],
        validation: {
          contentContains: ['42'],
        },
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
        validation: {
          contentContains: ['84'],
        },
      },
    ],
    models: [{ name: 'gpt-oss:latest', provider: 'ollama' }],
    timeout: 45000,
  },

  {
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
        validation: {
          contentContains: ['30'],
        },
      },
    ],
    models: [{ name: 'gpt-oss:latest', provider: 'ollama' }],
    timeout: 30000,
  },

  {
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
        expectedToolCalls: [
          {
            toolName: 'randomNumber',
          },
        ],
        validation: {
          toolCallCount: { min: 1 },
        },
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
  },
];

async function main() {
  console.log('===========================================');
  console.log('Tool Conversation Evaluation');
  console.log('===========================================\n');

  // Check Ollama availability
  const ollamaAvailable = await checkOllamaConnection();
  if (!ollamaAvailable) {
    console.error('❌ Ollama is not available. Please start Ollama first.');
    console.log('   Run: ollama serve');
    process.exit(1);
  }
  console.log('✓ Ollama is available\n');

  // Run scenarios
  const runner = new ConversationRunner({
    verbose: true,
    maxConcurrent: 1, // Run one at a time for clearer output
    defaultTimeout: 30000,
    enableAIScoring: false, // Set to true to enable AI-based scoring
  });

  console.log(`Running ${scenarios.length} scenarios...\n`);

  const results = await runner.runScenarios(scenarios);

  // Generate and display report
  const reporter = new Reporter({ outputDir: './output' });
  const report = reporter.fromToolTest(results, 'Tool Conversation Evaluation');

  // Output to console
  reporter.toConsole(report);

  // Save markdown report
  const filepath = await reporter.toFile(report);
  console.log(`\nReport saved to: ${filepath}\n`);

  // Exit with error if any failed
  const failedCount = results.filter((r) => !r.passed).length;
  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
