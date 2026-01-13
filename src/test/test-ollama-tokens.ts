#!/usr/bin/env npx tsx

/**
 * Test Ollama token usage reporting
 *
 * Run with: npx tsx src/test/test-ollama-tokens.ts
 */

import { ollama } from 'ai-sdk-ollama';
import { generateText } from 'ai';
import {
  Reporter,
  adaptSingleTestResult,
  ReportSection,
} from '../reporting/index.js';

async function main() {
  console.log('Testing Ollama token usage...');
  console.log('='.repeat(50));

  const startTime = Date.now();
  let success = false;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let responseText = '';
  let errorMsg: string | undefined;

  try {
    // Test with a simple prompt
    const model = ollama('llama3.2:latest');

    console.log('Generating text with Ollama...');
    const result = await generateText({
      model,
      prompt: 'Hello, how are you today?',
    });

    console.log('\nResponse:');
    console.log('='.repeat(30));
    console.log(result.text);
    responseText = result.text;

    console.log('\nToken Usage Analysis:');
    console.log('='.repeat(30));
    console.log('Has usage property:', 'usage' in result);
    console.log('Usage object:', result.usage);
    console.log('Usage type:', typeof result.usage);

    if (result.usage) {
      promptTokens = result.usage.promptTokens;
      completionTokens = result.usage.completionTokens;
      totalTokens = result.usage.totalTokens;
      console.log('Prompt tokens:', promptTokens);
      console.log('Completion tokens:', completionTokens);
      console.log('Total tokens:', totalTokens);
    }

    success = true;
  } catch (error) {
    console.error('Error testing Ollama:', error);
    errorMsg = error instanceof Error ? error.message : String(error);
  }

  const totalDuration = Date.now() - startTime;

  // Build sections
  const sections: ReportSection[] = [
    {
      title: 'Configuration',
      content: {
        type: 'metrics',
        data: [
          { label: 'Model', value: 'llama3.2:latest' },
          { label: 'Provider', value: 'ollama' },
          { label: 'Prompt', value: 'Hello, how are you today?' },
        ],
      },
    },
    {
      title: 'Token Usage',
      content: {
        type: 'metrics',
        data: [
          {
            label: 'Prompt Tokens',
            value: promptTokens,
            unit: 'tokens',
            status: promptTokens > 0 ? 'good' : 'neutral',
          },
          {
            label: 'Completion Tokens',
            value: completionTokens,
            unit: 'tokens',
            status: completionTokens > 0 ? 'good' : 'neutral',
          },
          {
            label: 'Total Tokens',
            value: totalTokens,
            unit: 'tokens',
            status: totalTokens > 0 ? 'good' : 'neutral',
          },
        ],
      },
    },
    {
      title: 'Response',
      content: {
        type: 'text',
        data: responseText || '(no response)',
      },
    },
  ];

  if (errorMsg) {
    sections.push({
      title: 'Error',
      content: { type: 'text', data: errorMsg },
    });
  }

  // Generate report using adapter
  const report = adaptSingleTestResult('Ollama Token Usage', success, {
    title: 'Ollama Token Usage Test',
    duration: totalDuration,
    sections,
    metadata: {
      promptTokens,
      completionTokens,
      totalTokens,
      responseLength: responseText.length,
    },
  });

  const reporter = new Reporter();
  reporter.toConsole(report);
  const filepath = await reporter.toFile(report);
  console.log(`\nReport saved to: ${filepath}`);

  if (!success) {
    process.exit(1);
  }
}

main().catch(console.error);
