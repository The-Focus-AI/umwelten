#!/usr/bin/env npx tsx

/**
 * Test script for the DaggerRunner implementation
 *
 * Run with: npx tsx src/test/test-dagger-runner.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { DaggerRunner } from '../evaluation/dagger-runner.js';
import {
  Reporter,
  adaptSimpleTestResults,
  SimpleTestResult,
  ReportSection,
} from '../reporting/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('Testing DaggerRunner implementation...\n');

  const results: SimpleTestResult[] = [];

  // Test 1: Simple TypeScript code
  console.log('Test 1: Simple TypeScript console.log');
  console.log('----------------------------------------');

  const result1 = await DaggerRunner.runCode({
    code: 'console.log("Hello from Dagger!");',
    language: 'typescript',
    timeout: 30,
  });

  results.push({
    name: 'Simple TypeScript console.log',
    success: result1.success,
    details: result1.success
      ? `Output: ${result1.output?.trim()}`
      : `Error: ${result1.error}`,
    duration: result1.executionTime,
    metrics: { language: 'typescript', cached: result1.cached ? 'yes' : 'no' },
  });

  console.log('Success:', result1.success);
  console.log('Output:', result1.output);
  console.log('Execution time:', result1.executionTime, 'ms\n');

  // Test 2: Python code
  console.log('Test 2: Simple Python print');
  console.log('----------------------------------------');

  const result2 = await DaggerRunner.runCode({
    code: 'print("Hello from Python!")',
    language: 'python',
    timeout: 30,
  });

  results.push({
    name: 'Simple Python print',
    success: result2.success,
    details: result2.success
      ? `Output: ${result2.output?.trim()}`
      : `Error: ${result2.error}`,
    duration: result2.executionTime,
    metrics: { language: 'python' },
  });

  console.log('Success:', result2.success);
  console.log('Output:', result2.output);
  console.log('Execution time:', result2.executionTime, 'ms\n');

  // Test 3: TypeScript with computation
  console.log('Test 3: TypeScript prime number check');
  console.log('----------------------------------------');

  const primeCode = `
function isPrime(n: number): boolean {
  if (n <= 1) return false;
  if (n <= 3) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

const testNumbers = [2, 17, 100, 997];
testNumbers.forEach(n => {
  console.log(\`\${n} is prime: \${isPrime(n)}\`);
});
`;

  const result3 = await DaggerRunner.runCode({
    code: primeCode,
    language: 'typescript',
    timeout: 30,
  });

  results.push({
    name: 'TypeScript prime number check',
    success: result3.success,
    details: result3.success
      ? `Output: ${result3.output?.trim().slice(0, 100)}`
      : `Error: ${result3.error}`,
    duration: result3.executionTime,
    metrics: { language: 'typescript' },
  });

  console.log('Success:', result3.success);
  console.log('Output:', result3.output);
  console.log('Execution time:', result3.executionTime, 'ms\n');

  // Test 4: Ruby feed_reader.rb with external gems
  console.log('Test 4: Ruby feed_reader.rb (with gems)');
  console.log('----------------------------------------');

  const feedReaderPath = path.join(__dirname, 'feed_reader.rb');
  let result4 = { success: false, error: 'File not found', executionTime: 0 };

  if (fs.existsSync(feedReaderPath)) {
    const feedReaderCode = fs.readFileSync(feedReaderPath, 'utf8');
    console.log('Reading Ruby code from:', feedReaderPath);
    console.log('This test uses LLM to configure container...\n');

    const daggerResult = await DaggerRunner.runCode({
      code: feedReaderCode,
      language: 'ruby',
      timeout: 120,
      useAIConfig: true,
    });
    result4 = {
      success: daggerResult.success,
      error: daggerResult.error,
      executionTime: daggerResult.executionTime || 0,
    };

    console.log('Success:', daggerResult.success);
    console.log(
      'Output:',
      daggerResult.output?.slice(0, 500) +
        (daggerResult.output && daggerResult.output.length > 500 ? '...' : '')
    );
    console.log('Execution time:', daggerResult.executionTime, 'ms');
  } else {
    console.log('Skipping: feed_reader.rb not found');
  }

  results.push({
    name: 'Ruby with external gems',
    success: result4.success,
    details: result4.success ? 'Executed with gem dependencies' : `Error: ${result4.error}`,
    duration: result4.executionTime,
    metrics: { language: 'ruby', useAIConfig: 'yes' },
  });
  console.log();

  // Gather cache stats and supported languages
  const stats = DaggerRunner.getCacheStats();
  const languages = DaggerRunner.getSupportedLanguages();

  console.log('Cache statistics:');
  console.log('  Memory cache size:', stats.memorySize);
  console.log('  Disk cache size:', stats.diskSize);
  console.log('  Cache directory:', stats.cacheDir);
  console.log('Supported languages:', languages.join(', '));
  console.log();

  // Build additional sections for the report
  const additionalSections: ReportSection[] = [
    {
      title: 'Cache Statistics',
      content: {
        type: 'metrics',
        data: [
          { label: 'Memory Cache', value: stats.memorySize, unit: 'entries' },
          { label: 'Disk Cache', value: stats.diskSize, unit: 'entries' },
          { label: 'Cache Dir', value: stats.cacheDir },
        ],
      },
    },
    {
      title: 'Supported Languages',
      content: { type: 'text', data: languages.join(', ') },
    },
  ];

  // Generate report using adapter
  const report = adaptSimpleTestResults(results, {
    title: 'DaggerRunner Test Results',
    type: 'code-generation',
    additionalSections,
    metadata: {
      cacheStats: stats,
      supportedLanguages: languages,
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
