#!/usr/bin/env npx tsx

/**
 * Test streaming reasoning tokens with Gemma3 models
 *
 * Run with: npx tsx src/test/test-reasoning-streaming.ts
 */

import { Interaction } from '../interaction/interaction.js';
import { BaseModelRunner } from '../cognition/runner.js';
import { Stimulus } from '../stimulus/stimulus.js';
import {
  Reporter,
  adaptSimpleTestResults,
  SimpleTestResult,
  ReportSection,
} from '../reporting/index.js';

async function main() {
  console.log('Testing Streaming Reasoning Tokens with Gemma3');
  console.log('='.repeat(60));

  const startTime = Date.now();
  const results: SimpleTestResult[] = [];

  // Test with Gemma3 models that support reasoning
  const models = [
    { name: 'qwen3:32b', provider: 'ollama' as const },
    { name: 'deepseek-r1:14b', provider: 'ollama' as const },
  ];

  for (const modelDetails of models) {
    console.log(`\nTesting ${modelDetails.name}...`);
    console.log('-'.repeat(40));

    const testStart = Date.now();
    const prompt =
      'I need a script that will give me at least 1042 distinct but made up show names. They should be funny and grammatically correct and written in TypeScript. Think through this step by step.';

    const stimulus = new Stimulus({
      role: 'TypeScript developer',
      objective: 'Generate working TypeScript code that compiles and runs successfully. Always wrap your code in ```typescript code blocks. Think through your approach step by step.',
    });
    const interaction = new Interaction(modelDetails, stimulus);
    interaction.addMessage({ role: 'user', content: prompt });

    const runner = new BaseModelRunner();

    try {
      console.log('Starting streaming with reasoning...\n');

      const response = await runner.streamText(interaction);
      const duration = Date.now() - testStart;

      console.log('\n' + '='.repeat(60));
      console.log('FINAL RESULTS:');
      console.log('='.repeat(60));
      console.log(`Model: ${response.metadata.model}`);
      console.log(`Provider: ${response.metadata.provider}`);
      console.log(`Response Length: ${response.content.length} characters`);
      console.log(
        `Tokens Used: ${response.metadata.tokenUsage.completionTokens} completion tokens`
      );

      const reasoningLength = response.reasoning?.length || 0;
      if (reasoningLength > 0) {
        console.log(`\nREASONING CAPTURED:`);
        console.log('-'.repeat(40));
        console.log(response.reasoning);
        console.log(`Reasoning Length: ${reasoningLength} characters`);
      } else {
        console.log('\nNo reasoning captured');
      }

      // Check if TypeScript code was extracted
      const codeMatch = response.content.match(/```typescript\n([\s\S]*?)\n```/);
      const hasCode = !!codeMatch;
      if (hasCode) {
        console.log(`\nTypeScript code extracted (${codeMatch![1].length} characters)`);
      } else {
        console.log('\nNo TypeScript code blocks found');
      }

      results.push({
        name: `${modelDetails.name} (${modelDetails.provider})`,
        success: true,
        details: `Response: ${response.content.length} chars | Reasoning: ${reasoningLength} chars | Code: ${hasCode ? 'yes' : 'no'}`,
        duration,
        metrics: {
          responseLength: response.content.length,
          reasoningLength,
          completionTokens: response.metadata.tokenUsage.completionTokens,
          hasCode: hasCode ? 'yes' : 'no',
        },
      });
    } catch (error) {
      const duration = Date.now() - testStart;
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Error testing ${modelDetails.name}:`, error);
      results.push({
        name: `${modelDetails.name} (${modelDetails.provider})`,
        success: false,
        details: `Error: ${errorMsg}`,
        duration,
      });
    }

    console.log('\n' + '='.repeat(60));
  }

  // Build additional sections
  const successResults = results.filter((r) => r.success && r.metrics);
  const additionalSections: ReportSection[] = [];

  if (successResults.length > 0) {
    additionalSections.push({
      title: 'Reasoning Statistics',
      content: {
        type: 'metrics',
        data: successResults.map((r) => ({
          label: r.name,
          value: r.metrics?.reasoningLength || 0,
          unit: 'chars',
          status: (r.metrics?.reasoningLength || 0) > 0 ? 'good' : 'neutral',
        })),
      },
    });
  }

  // Generate report using adapter
  const report = adaptSimpleTestResults(results, {
    title: 'Reasoning Streaming Test Results',
    type: 'evaluation',
    additionalSections,
    metadata: {
      modelsWithReasoning: successResults.filter(
        (r) => (r.metrics?.reasoningLength || 0) > 0
      ).length,
      modelsWithCode: successResults.filter((r) => r.metrics?.hasCode === 'yes').length,
    },
  });

  const reporter = new Reporter();
  reporter.toConsole(report);
  const filepath = await reporter.toFile(report);
  console.log(`\nReport saved to: ${filepath}`);

  const failed = results.filter((r) => !r.success).length;
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
