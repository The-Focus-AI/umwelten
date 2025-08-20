#!/usr/bin/env tsx

/**
 * Test Multi-Language Evaluation
 * 
 * A simple test script to demonstrate the multi-language evaluation functionality
 * with a subset of models and languages for quick testing.
 */

import fs from 'fs';
import path from 'path';
import { FunctionEvaluationRunner } from '../src/evaluation/evaluate.js';
import { BaseModelRunner } from '../src/cognition/runner.js';
import { Interaction } from '../src/interaction/interaction.js';
import { extractAllCodeBlocks, getCodeForLanguage, fixCommonCodeErrors, ensureConsoleOutput } from '../src/evaluation/code-extractor.js';
import { DockerRunner } from '../src/evaluation/docker-runner.js';

// Test configuration - smaller subset for quick testing
const TEST_MODELS = [
  { name: 'gpt-oss:20b', provider: 'ollama' },
  { name: 'gemma3:12b', provider: 'ollama' }
] as const;

const TEST_LANGUAGES = [
  { 
    name: 'typescript', 
    prompt: 'write a simple function that prints "Hello World" in typescript' 
  },
  { 
    name: 'python', 
    prompt: 'write a simple function that prints "Hello World" in python' 
  },
  { 
    name: 'bash', 
    prompt: 'write a simple script that prints "Hello World" in bash' 
  }
] as const;

const EVALUATION_ID = 'test-multi-language';
const WORKDIR = path.join(process.cwd(), 'output/evaluations', EVALUATION_ID);

interface TestResult {
  modelName: string;
  language: string;
  response?: any;
  extractedCode?: string;
  dockerResult?: any;
  success: boolean;
}

async function main() {
  console.log('🧪 Testing Multi-Language Evaluation');
  console.log('='.repeat(50));
  console.log(`🤖 Models: ${TEST_MODELS.length}`);
  console.log(`🌐 Languages: ${TEST_LANGUAGES.length}`);
  console.log(`📁 Workdir: ${WORKDIR}`);
  console.log();

  const results: TestResult[] = [];

  // Test each language with each model
  for (const languageConfig of TEST_LANGUAGES) {
    console.log(`\n🌐 Testing ${languageConfig.name.toUpperCase()}...`);
    
    for (const model of TEST_MODELS) {
      console.log(`  🤖 Testing ${model.name}...`);
      
      const result: TestResult = {
        modelName: model.name,
        language: languageConfig.name,
        success: false
      };

      try {
        // Step 1: Generate response
        const runner = new FunctionEvaluationRunner(EVALUATION_ID, languageConfig.name, async (details) => {
          const modelRunner = new BaseModelRunner();
          const interaction = new Interaction(details, 'You are a helpful programming assistant.');
          interaction.addMessage({ role: 'user', content: languageConfig.prompt });
          
          return await modelRunner.streamText(interaction);
        });

        const response = await runner.evaluate({ name: model.name, provider: 'ollama' });
        if (response) {
          result.response = response;
          console.log(`    ✅ Response generated (${response.content.length} chars)`);
        }

        // Step 2: Extract code
        if (result.response) {
          const extracted = extractAllCodeBlocks(result.response.content);
          const extractedCode = getCodeForLanguage(extracted, languageConfig.name);
          
          if (extractedCode) {
            // Fix common errors and ensure console output
            let processedCode = fixCommonCodeErrors(extractedCode, languageConfig.name);
            processedCode = ensureConsoleOutput(processedCode, languageConfig.name);
            result.extractedCode = processedCode;
            console.log(`    ✅ Code extracted (${processedCode.length} chars)`);
          } else {
            console.log(`    ❌ No ${languageConfig.name} code found. Available: ${extracted.blocks.map(b => b.language).join(', ')}`);
          }
        }

        // Step 3: Run in Docker
        if (result.extractedCode) {
          const dockerResult = await DockerRunner.runCode({
            code: result.extractedCode,
            language: languageConfig.name,
            timeout: 10,
            modelName: result.modelName
          });
          
          result.dockerResult = dockerResult;
          
          if (dockerResult.success) {
            result.success = true;
            console.log(`    ✅ Docker execution successful (${dockerResult.output?.length || 0} chars output)`);
          } else {
            console.log(`    ❌ Docker execution failed: ${dockerResult.error}`);
          }
        }

      } catch (error) {
        console.error(`    ❌ Error: ${error}`);
      }

      results.push(result);
    }
  }

  // Print summary
  printSummary(results);
}

function printSummary(results: TestResult[]) {
  console.log('\n📊 Test Summary');
  console.log('='.repeat(50));
  
  const totalTests = results.length;
  const successfulTests = results.filter(r => r.success).length;
  const successRate = (successfulTests / totalTests) * 100;
  
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Successful: ${successfulTests}`);
  console.log(`Failed: ${totalTests - successfulTests}`);
  console.log(`Success Rate: ${successRate.toFixed(1)}%`);
  
  console.log('\n📋 Detailed Results:');
  for (const result of results) {
    const status = result.success ? '✅' : '❌';
    console.log(`${status} ${result.modelName} - ${result.language}`);
    
    if (!result.success) {
      if (!result.response) {
        console.log(`    No response generated`);
      } else if (!result.extractedCode) {
        console.log(`    No code extracted`);
      } else if (result.dockerResult?.error) {
        console.log(`    Docker error: ${result.dockerResult.error}`);
      }
    }
  }
  
  // Show successful outputs
  const successfulResults = results.filter(r => r.success);
  if (successfulResults.length > 0) {
    console.log('\n🎉 Successful Executions:');
    for (const result of successfulResults) {
      console.log(`\n${result.modelName} - ${result.language}:`);
      console.log('Output:');
      console.log(result.dockerResult?.output || 'No output');
    }
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
