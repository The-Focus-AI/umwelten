#!/usr/bin/env npx tsx

/**
 * Simple reasoning streaming test with Qwen3
 *
 * Run with: npx tsx src/test/test-reasoning-streaming-simple.ts
 */

import { Interaction } from '../interaction/interaction.js';
import { BaseModelRunner } from '../cognition/runner.js';
import { Stimulus } from '../stimulus/stimulus.js';
import {
  Reporter,
  adaptSingleTestResult,
  ReportSection,
} from '../reporting/index.js';

async function main() {
  console.log('Testing Simple Streaming with Qwen3');
  console.log('='.repeat(50));

  const startTime = Date.now();
  const modelDetails = { name: 'qwen3:32b', provider: 'ollama' as const };
  const prompt =
    'Write a short TypeScript function that adds two numbers. Think through this step by step.';

  const stimulus = new Stimulus({
    role: 'TypeScript developer',
    objective: 'Generate working TypeScript code. Think through your approach step by step.',
  });
  const interaction = new Interaction(modelDetails, stimulus);
  interaction.addMessage({ role: 'user', content: prompt });

  const runner = new BaseModelRunner();

  let success = false;
  let responseLength = 0;
  let completionTokens = 0;
  let reasoningLength = 0;
  let codeLength = 0;
  let errorMsg: string | undefined;

  try {
    console.log('Starting streaming...\n');

    const response = await runner.streamText(interaction);

    console.log('\n' + '='.repeat(50));
    console.log('RESULTS:');
    console.log('='.repeat(50));
    console.log(`Model: ${response.metadata.model}`);
    console.log(`Response Length: ${response.content.length} characters`);
    console.log(
      `Tokens Used: ${response.metadata.tokenUsage.completionTokens} completion tokens`
    );

    responseLength = response.content.length;
    completionTokens = response.metadata.tokenUsage.completionTokens;

    if (response.reasoning) {
      console.log(
        `\nREASONING CAPTURED (${response.reasoning.length} characters):`
      );
      console.log('-'.repeat(30));
      console.log(response.reasoning);
      reasoningLength = response.reasoning.length;
    } else {
      console.log('\nNo reasoning captured');
    }

    // Check if TypeScript code was extracted
    const codeMatch = response.content.match(
      /```(?:typescript|ts)\n([\s\S]*?)\n```/
    );
    if (codeMatch) {
      console.log(`\nTypeScript code extracted (${codeMatch[1].length} characters):`);
      console.log('-'.repeat(30));
      console.log(codeMatch[1]);
      codeLength = codeMatch[1].length;
    } else {
      console.log('\nNo TypeScript code blocks found');
      console.log('Content preview:');
      console.log(response.content.substring(0, 200) + '...');
    }

    success = true;
  } catch (error) {
    console.error(`Error:`, error);
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
          { label: 'Model', value: modelDetails.name },
          { label: 'Provider', value: modelDetails.provider },
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
            value: responseLength,
            unit: 'chars',
            status: responseLength > 0 ? 'good' : 'bad',
          },
          { label: 'Completion Tokens', value: completionTokens, unit: 'tokens' },
          {
            label: 'Reasoning Length',
            value: reasoningLength,
            unit: 'chars',
            status: reasoningLength > 0 ? 'good' : 'neutral',
          },
          {
            label: 'Code Length',
            value: codeLength,
            unit: 'chars',
            status: codeLength > 0 ? 'good' : 'bad',
          },
        ],
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
  const report = adaptSingleTestResult('Simple Reasoning Streaming', success, {
    title: 'Simple Reasoning Streaming Test',
    duration: totalDuration,
    sections,
    metadata: {
      model: modelDetails.name,
      provider: modelDetails.provider,
      responseLength,
      reasoningLength,
      codeLength,
    },
  });

  const reporter = new Reporter();
  reporter.toConsole(report);
  const filepath = await reporter.toFile(report, 'reasoning-streaming-simple-report.md');
  console.log(`\nReport saved to: ${filepath}`);

  if (!success) {
    process.exit(1);
  }
}

main().catch(console.error);
