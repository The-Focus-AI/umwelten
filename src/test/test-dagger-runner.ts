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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('Testing DaggerRunner implementation...\n');

  // Test 1: Simple TypeScript code
  console.log('Test 1: Simple TypeScript console.log');
  console.log('----------------------------------------');

  const result1 = await DaggerRunner.runCode({
    code: 'console.log("Hello from Dagger!");',
    language: 'typescript',
    timeout: 30
  });

  console.log('Success:', result1.success);
  console.log('Output:', result1.output);
  console.log('Error:', result1.error);
  console.log('Execution time:', result1.executionTime, 'ms');
  console.log('Cached config:', result1.cached);
  console.log();

  // Test 2: Python code
  console.log('Test 2: Simple Python print');
  console.log('----------------------------------------');

  const result2 = await DaggerRunner.runCode({
    code: 'print("Hello from Python!")',
    language: 'python',
    timeout: 30
  });

  console.log('Success:', result2.success);
  console.log('Output:', result2.output);
  console.log('Error:', result2.error);
  console.log('Execution time:', result2.executionTime, 'ms');
  console.log();

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
    timeout: 30
  });

  console.log('Success:', result3.success);
  console.log('Output:', result3.output);
  console.log('Error:', result3.error);
  console.log('Execution time:', result3.executionTime, 'ms');
  console.log();

  // Test 4: Ruby feed_reader.rb with external gems (feedjira, faraday)
  console.log('Test 4: Ruby feed_reader.rb (with gems: feedjira, faraday)');
  console.log('----------------------------------------');

  const feedReaderPath = path.join(__dirname, 'feed_reader.rb');
  const feedReaderCode = fs.readFileSync(feedReaderPath, 'utf8');

  console.log('Reading Ruby code from:', feedReaderPath);
  console.log('Code requires gems: feedjira, faraday');
  console.log('This test uses LLM to configure container with gem installation...');
  console.log();

  const result4 = await DaggerRunner.runCode({
    code: feedReaderCode,
    language: 'ruby',
    timeout: 120, // Longer timeout for gem installation
    useAIConfig: true // Force LLM to figure out gem installation
  });

  console.log('Success:', result4.success);
  console.log('Output:', result4.output?.slice(0, 500) + (result4.output && result4.output.length > 500 ? '...' : ''));
  console.log('Error:', result4.error);
  console.log('Execution time:', result4.executionTime, 'ms');
  console.log('Container config used:', JSON.stringify(result4.containerConfig, null, 2));
  console.log();

  // Test 5: Cache statistics
  console.log('Test 5: Cache statistics');
  console.log('----------------------------------------');
  const stats = DaggerRunner.getCacheStats();
  console.log('Memory cache size:', stats.memorySize);
  console.log('Disk cache size:', stats.diskSize);
  console.log('Cache directory:', stats.cacheDir);
  console.log();

  // Test 6: Supported languages
  console.log('Test 6: Supported languages');
  console.log('----------------------------------------');
  const languages = DaggerRunner.getSupportedLanguages();
  console.log('Supported languages:', languages.join(', '));
  console.log();

  console.log('All tests completed!');
}

main().catch(console.error);
