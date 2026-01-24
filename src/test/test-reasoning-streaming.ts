#!/usr/bin/env npx tsx

/**
 * Test streaming reasoning tokens with multiple models
 *
 * Run with: npx tsx src/test/test-reasoning-streaming.ts
 */

import { Interaction } from '../interaction/interaction.js';
import { BaseModelRunner } from '../cognition/runner.js';
import { Stimulus } from '../stimulus/stimulus.js';
import {
  Reporter,
  ReportSection,
  Report,
} from '../reporting/index.js';

interface ModelTestResult {
  model: string;
  provider: string;
  success: boolean;
  error?: string;
  // Timing
  durationMs: number;
  // Tokens
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  // Cost
  promptCost: number;
  completionCost: number;
  totalCost: number;
  // Response
  responseLength: number;
  reasoningLength: number;
  codeLength: number;
  hasCode: boolean;
  tokensPerSecond: number;
}

async function testModel(
  modelName: string,
  provider: 'ollama' | 'openrouter' = 'ollama'
): Promise<ModelTestResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${modelName} (${provider})`);
  console.log('='.repeat(60));

  const startTime = Date.now();
  const modelDetails = { name: modelName, provider };
  const prompt =
    'I need a script that will give me at least 1042 distinct but made up show names. They should be funny and grammatically correct and written in TypeScript. Think through this step by step.';

  const result: ModelTestResult = {
    model: modelName,
    provider,
    success: false,
    durationMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    promptCost: 0,
    completionCost: 0,
    totalCost: 0,
    responseLength: 0,
    reasoningLength: 0,
    codeLength: 0,
    hasCode: false,
    tokensPerSecond: 0,
  };

  try {
    const stimulus = new Stimulus({
      role: 'TypeScript developer',
      objective:
        'Generate working TypeScript code that compiles and runs successfully. Always wrap your code in ```typescript code blocks. Think through your approach step by step.',
    });
    const interaction = new Interaction(modelDetails, stimulus);
    interaction.addMessage({ role: 'user', content: prompt });

    const runner = new BaseModelRunner();
    console.log('Starting streaming with reasoning...\n');

    const response = await runner.streamText(interaction);

    // Calculate duration
    result.durationMs =
      response.metadata.startTime && response.metadata.endTime
        ? new Date(response.metadata.endTime).getTime() -
          new Date(response.metadata.startTime).getTime()
        : Date.now() - startTime;

    // Token usage
    result.promptTokens = response.metadata.tokenUsage.promptTokens || 0;
    result.completionTokens = response.metadata.tokenUsage.completionTokens || 0;
    result.totalTokens =
      response.metadata.tokenUsage.total ||
      result.promptTokens + result.completionTokens;

    // Cost
    result.promptCost = response.metadata.cost?.promptCost || 0;
    result.completionCost = response.metadata.cost?.completionCost || 0;
    result.totalCost = response.metadata.cost?.totalCost || 0;

    // Response metrics
    result.responseLength = response.content.length;
    result.reasoningLength = response.reasoning?.length || 0;

    // Check for TypeScript code
    const codeMatch = response.content.match(/```typescript\n([\s\S]*?)\n```/);
    result.hasCode = !!codeMatch;
    result.codeLength = codeMatch ? codeMatch[1].length : 0;

    // Tokens per second
    result.tokensPerSecond =
      result.durationMs > 0
        ? result.completionTokens / (result.durationMs / 1000)
        : 0;

    result.success = true;

    // Print summary
    console.log('\n--- Response Preview ---');
    console.log(
      response.content.slice(0, 300) +
        (response.content.length > 300 ? '...' : '')
    );

    if (result.reasoningLength > 0) {
      console.log(`\n--- Reasoning (${result.reasoningLength} chars) ---`);
      console.log(
        response.reasoning?.slice(0, 200) +
          (result.reasoningLength > 200 ? '...' : '')
      );
    }

    console.log('\n--- Metrics ---');
    console.log(`Duration: ${(result.durationMs / 1000).toFixed(2)}s`);
    console.log(
      `Tokens: ${result.totalTokens} (${result.promptTokens} prompt + ${result.completionTokens} completion)`
    );
    console.log(`Speed: ${result.tokensPerSecond.toFixed(1)} tokens/sec`);
    console.log(`Cost: $${result.totalCost.toFixed(6)}`);
    console.log(`Code found: ${result.hasCode ? 'Yes' : 'No'}`);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.durationMs = Date.now() - startTime;
    console.error(`Error: ${result.error}`);
  }

  return result;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatCost(cost: number): string {
  if (cost === 0) return 'Free';
  if (cost < 0.0001) return `$${cost.toFixed(8)}`;
  if (cost < 0.01) return `$${cost.toFixed(6)}`;
  return `$${cost.toFixed(4)}`;
}

function buildModelSection(result: ModelTestResult): ReportSection {
  return {
    title: `${result.model} (${result.provider})`,
    content: {
      type: 'metrics',
      data: [
        // Timing - most important!
        {
          label: 'Duration',
          value: formatDuration(result.durationMs),
          status: result.success ? 'good' : 'bad',
        },
        {
          label: 'Speed',
          value: `${result.tokensPerSecond.toFixed(1)} tok/s`,
          status: result.tokensPerSecond > 20 ? 'good' : 'neutral',
        },
        // Cost - critical!
        {
          label: 'Total Cost',
          value: formatCost(result.totalCost),
          status: result.totalCost === 0 ? 'good' : 'neutral',
        },
        {
          label: 'Prompt Cost',
          value: formatCost(result.promptCost),
        },
        {
          label: 'Completion Cost',
          value: formatCost(result.completionCost),
        },
        // Tokens
        {
          label: 'Total Tokens',
          value: result.totalTokens,
          unit: 'tokens',
        },
        {
          label: 'Prompt Tokens',
          value: result.promptTokens,
          unit: 'tokens',
        },
        {
          label: 'Completion Tokens',
          value: result.completionTokens,
          unit: 'tokens',
        },
        // Response & Reasoning
        {
          label: 'Response Length',
          value: result.responseLength,
          unit: 'chars',
        },
        {
          label: 'Reasoning Length',
          value: result.reasoningLength,
          unit: 'chars',
          status: result.reasoningLength > 0 ? 'good' : 'neutral',
        },
        {
          label: 'Code Length',
          value: result.codeLength,
          unit: 'chars',
          status: result.hasCode ? 'good' : 'bad',
        },
        // Status
        {
          label: 'Status',
          value: result.success ? 'PASSED' : `FAILED: ${result.error}`,
          status: result.success ? 'good' : 'bad',
        },
      ],
    },
  };
}

async function main() {
  console.log('Testing Streaming Reasoning Tokens');
  console.log('='.repeat(60));

  const overallStart = Date.now();

  // Models to test - these support reasoning
  const modelsToTest = [
    { name: 'qwen3:32b', provider: 'ollama' as const },
    { name: 'deepseek-r1:14b', provider: 'ollama' as const },
  ];

  const results: ModelTestResult[] = [];

  for (const model of modelsToTest) {
    const result = await testModel(model.name, model.provider);
    results.push(result);
  }

  const totalDuration = Date.now() - overallStart;
  const passed = results.filter((r) => r.success).length;
  const failed = results.length - passed;
  const totalCost = results.reduce((sum, r) => sum + r.totalCost, 0);

  // Build report sections - ONE SECTION PER MODEL
  const sections: ReportSection[] = [];

  // Performance comparison summary
  sections.push({
    title: 'Performance Comparison',
    content: {
      type: 'metrics',
      data: results.map((r) => ({
        label: r.model,
        value: `${formatDuration(r.durationMs)} | ${r.tokensPerSecond.toFixed(1)} tok/s | ${formatCost(r.totalCost)} | ${r.hasCode ? 'Code: Yes' : 'Code: No'}`,
        status: r.success ? 'good' : 'bad',
      })),
    },
  });

  // Individual model sections with full details
  for (const result of results) {
    sections.push(buildModelSection(result));
  }

  // Build the report
  const report: Report = {
    id: `reasoning-streaming-${Date.now()}`,
    title: 'Reasoning Streaming Test Results',
    timestamp: new Date(),
    type: 'evaluation',
    summary: {
      totalItems: results.length,
      passed,
      failed,
      successRate: results.length > 0 ? (passed / results.length) * 100 : 0,
      duration: totalDuration,
      highlights: [
        `Tested ${results.length} model(s)`,
        passed === results.length
          ? 'All models passed'
          : `${failed} model(s) failed`,
        `Total time: ${formatDuration(totalDuration)}`,
        `Total cost: ${formatCost(totalCost)}`,
        `Models with reasoning: ${results.filter((r) => r.reasoningLength > 0).length}`,
        `Models with code: ${results.filter((r) => r.hasCode).length}`,
      ],
    },
    sections,
    metadata: {
      models: results.map((r) => r.model),
      totalDuration,
      totalCost,
      averageSpeed:
        results.length > 0
          ? results.reduce((sum, r) => sum + r.tokensPerSecond, 0) /
            results.length
          : 0,
      modelsWithReasoning: results.filter((r) => r.reasoningLength > 0).length,
      modelsWithCode: results.filter((r) => r.hasCode).length,
    },
  };

  const reporter = new Reporter();
  reporter.toConsole(report);
  const filepath = await reporter.toFile(report, 'reasoning-streaming-report.md');
  console.log(`\nReport saved to: ${filepath}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
