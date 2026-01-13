#!/usr/bin/env npx tsx

/**
 * Simple prompt test with Ollama
 *
 * Run with: npx tsx src/test/test-simple-prompt.ts
 */

import { BaseModelRunner } from '../cognition/runner.js';
import { Interaction } from '../interaction/interaction.js';
import { Stimulus } from '../stimulus/stimulus.js';
import {
  Reporter,
  adaptSingleTestResult,
  ReportSection,
} from '../reporting/index.js';

async function testModel(modelName: string) {
  console.log(`\nTesting ${modelName} with simple prompt`);
  console.log('='.repeat(50));

  const startTime = Date.now();
  const modelDetails = { name: modelName, provider: 'ollama' as const };
  const prompt =
    'I need a script that will give me at least 1042 distinct but made up show names. they should be funny and grammatically correct and written in typescript.';

  let success = false;
  let responseLength = 0;
  let reasoningLength = 0;
  let responseTime = 0;
  let errorMsg: string | undefined;

  try {
    const stimulus = new Stimulus({
      role: 'TypeScript developer',
      objective: 'Generate TypeScript code',
    });
    const interaction = new Interaction(modelDetails, stimulus);
    interaction.addMessage({
      role: 'user',
      content: prompt,
    });

    const runner = new BaseModelRunner();
    console.log('Starting streaming...\n');

    const result = await runner.streamText(interaction);
    responseTime =
      result.metadata.startTime && result.metadata.endTime
        ? new Date(result.metadata.endTime).getTime() -
          new Date(result.metadata.startTime).getTime()
        : Date.now() - startTime;

    console.log('\nFinal Response:');
    console.log('='.repeat(50));
    console.log(
      result.content.slice(0, 500) + (result.content.length > 500 ? '...' : '')
    );

    responseLength = result.content.length;

    console.log('\nReasoning:');
    console.log('='.repeat(50));
    if (result.reasoning) {
      console.log(result.reasoning);
      reasoningLength = result.reasoning.length;
    } else {
      console.log('No reasoning captured');
    }

    console.log('\nMetadata:');
    console.log('='.repeat(50));
    console.log(`Response Length: ${result.content.length} characters`);
    console.log(`Response Time: ${responseTime}ms`);

    success = true;
  } catch (error) {
    console.error(`Error testing ${modelName}:`, error);
    errorMsg = error instanceof Error ? error.message : String(error);
  }

  return {
    model: modelName,
    success,
    responseLength,
    reasoningLength,
    responseTime,
    error: errorMsg,
    duration: Date.now() - startTime,
  };
}

async function main() {
  const startTime = Date.now();

  // Test just one model
  const result = await testModel('gpt-oss:latest');

  const totalDuration = Date.now() - startTime;

  // Build sections
  const sections: ReportSection[] = [
    {
      title: 'Configuration',
      content: {
        type: 'metrics',
        data: [
          { label: 'Model', value: result.model },
          { label: 'Provider', value: 'ollama' },
        ],
      },
    },
    {
      title: 'Results',
      content: {
        type: 'metrics',
        data: [
          {
            label: 'Response Length',
            value: result.responseLength,
            unit: 'chars',
            status: result.responseLength > 0 ? 'good' : 'bad',
          },
          {
            label: 'Reasoning Length',
            value: result.reasoningLength,
            unit: 'chars',
            status: result.reasoningLength > 0 ? 'good' : 'neutral',
          },
          {
            label: 'Response Time',
            value: result.responseTime,
            unit: 'ms',
          },
        ],
      },
    },
  ];

  if (result.error) {
    sections.push({
      title: 'Error',
      content: { type: 'text', data: result.error },
    });
  }

  // Generate report using adapter
  const report = adaptSingleTestResult('Simple Prompt Test', result.success, {
    title: 'Simple Prompt Test',
    duration: totalDuration,
    sections,
    metadata: {
      model: result.model,
      responseLength: result.responseLength,
      responseTime: result.responseTime,
    },
  });

  const reporter = new Reporter();
  reporter.toConsole(report);
  const filepath = await reporter.toFile(report);
  console.log(`\nReport saved to: ${filepath}`);

  if (!result.success) {
    process.exit(1);
  }
}

main().catch(console.error);
