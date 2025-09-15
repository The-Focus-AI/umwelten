#!/usr/bin/env tsx

/**
 * Advanced TypeScript Evaluation - Phase 2 Demo
 * 
 * This script demonstrates the new CodeGenerationEvaluation strategy
 * with advanced TypeScript stimulus definitions.
 */

import { AdvancedTypeScriptStimulus, ReactTypeScriptStimulus, NodeJSTypeScriptStimulus } from '../src/stimulus/coding/advanced-typescript.js';
import { CodeGenerationEvaluation } from '../src/evaluation/strategies/code-generation-evaluation.js';
import { EvaluationCache } from '../src/evaluation/caching/cache-service.js';
import { ModelDetails } from '../src/cognition/types.js';

// Configuration
const EVALUATION_ID = 'advanced-typescript-evaluation';
const MODELS: ModelDetails[] = [
  { name: 'gemma3:27b', provider: 'ollama' },
  { name: 'gemma3:12b', provider: 'ollama' },
  { name: 'llama3.2:latest', provider: 'ollama' },
];

const PROMPTS = {
  advanced: "Create a generic API client with retry logic, error handling, and TypeScript generics",
  react: "Create a reusable Button component with TypeScript, proper props interface, and accessibility features",
  nodejs: "Create a REST API with Express, TypeScript, Zod validation, and proper error handling"
};

// Evaluation configuration
const EVALUATION_CONFIG = {
  evaluationId: EVALUATION_ID,
  useCache: true,
  maxConcurrent: 2,
  extractCode: true,
  runDocker: true,
  aiScoring: true,
  fixCommonErrors: true,
  ensureConsoleOutput: true,
  dockerTimeout: 30000
};

async function runAdvancedTypeScriptEvaluation() {
  console.log('🚀 Advanced TypeScript Evaluation - Phase 2 Demo');
  console.log('============================================================');
  console.log(`📝 Stimulus: Advanced TypeScript Development`);
  console.log(`📝 Description: Test models' ability to generate complex TypeScript code`);
  console.log(`🤖 Models: ${MODELS.length} models`);
  console.log(`📁 Evaluation ID: ${EVALUATION_ID}`);
  console.log(`💾 Caching: ${EVALUATION_CONFIG.useCache ? 'Enabled' : 'Disabled'}`);
  console.log(`⚡ Concurrent: ${EVALUATION_CONFIG.maxConcurrent} models`);
  console.log(`🐳 Docker: ${EVALUATION_CONFIG.runDocker ? 'Enabled' : 'Disabled'}`);
  console.log(`🤖 AI Scoring: ${EVALUATION_CONFIG.aiScoring ? 'Enabled' : 'Disabled'}`);
  console.log('');

  const cache = new EvaluationCache(EVALUATION_ID);
  const results: any[] = [];

  // Test 1: Advanced TypeScript
  console.log('🔧 Test 1: Advanced TypeScript Development');
  console.log('------------------------------------------------------------');
  
  const advancedEvaluation = new CodeGenerationEvaluation(
    AdvancedTypeScriptStimulus,
    MODELS,
    PROMPTS.advanced,
    cache,
    EVALUATION_CONFIG
  );

  console.log('🚀 Starting advanced TypeScript evaluation...');
  const advancedResults = await advancedEvaluation.run();
  results.push(...advancedResults);

  console.log('✅ Advanced TypeScript evaluation completed');
  console.log('');

  // Test 2: React TypeScript
  console.log('⚛️ Test 2: React TypeScript Development');
  console.log('------------------------------------------------------------');
  
  const reactEvaluation = new CodeGenerationEvaluation(
    ReactTypeScriptStimulus,
    MODELS,
    PROMPTS.react,
    cache,
    EVALUATION_CONFIG
  );

  console.log('🚀 Starting React TypeScript evaluation...');
  const reactResults = await reactEvaluation.run();
  results.push(...reactResults);

  console.log('✅ React TypeScript evaluation completed');
  console.log('');

  // Test 3: Node.js TypeScript
  console.log('🟢 Test 3: Node.js TypeScript Development');
  console.log('------------------------------------------------------------');
  
  const nodejsEvaluation = new CodeGenerationEvaluation(
    NodeJSTypeScriptStimulus,
    MODELS,
    PROMPTS.nodejs,
    cache,
    EVALUATION_CONFIG
  );

  console.log('🚀 Starting Node.js TypeScript evaluation...');
  const nodejsResults = await nodejsEvaluation.run();
  results.push(...nodejsResults);

  console.log('✅ Node.js TypeScript evaluation completed');
  console.log('');

  // Analysis
  analyzeResults(results);
  
  // Cache statistics
  const stats = cache.getStats();
  console.log('============================================================');
  console.log('💾 Cache Statistics:');
  console.log(`- Total requests: ${stats.totalRequests}`);
  console.log(`- Cache hits: ${stats.hits}`);
  console.log(`- Cache misses: ${stats.misses}`);
  console.log(`- Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
  console.log(`- Errors: ${stats.errors}`);
  console.log('');
  console.log('🎉 Advanced TypeScript evaluation complete! Check the output directory for detailed results.');
}

function analyzeResults(results: any[]) {
  console.log('============================================================');
  console.log('📊 EVALUATION RESULTS ANALYSIS');
  console.log('============================================================');

  const successful = results.filter(r => !r.metadata.error);
  const failed = results.filter(r => r.metadata.error);

  console.log('📈 Summary:');
  console.log(`- Total evaluations: ${results.length}`);
  console.log(`- Successful: ${successful.length}`);
  console.log(`- Failed: ${failed.length}`);
  console.log(`- Success rate: ${((successful.length / results.length) * 100).toFixed(1)}%`);
  
  if (successful.length > 0) {
    const avgDuration = successful.reduce((sum, r) => sum + r.metadata.duration, 0) / successful.length;
    const avgTokens = successful.reduce((sum, r) => sum + (r.response.metadata.tokenUsage.promptTokens + r.response.metadata.tokenUsage.completionTokens), 0) / successful.length;
    const totalCost = successful.reduce((sum, r) => sum + (r.response.metadata.cost?.total || 0), 0);
    
    console.log(`\n⏱️ Performance:`);
    console.log(`- Average duration: ${avgDuration.toFixed(0)}ms`);
    console.log(`- Average tokens: ${avgTokens.toFixed(0)}`);
    console.log(`- Total cost: $${totalCost.toFixed(4)}`);

    // Code generation analysis
    const withCode = successful.filter(r => r.extractedCode);
    const withDocker = successful.filter(r => r.dockerResult);
    const withScoring = successful.filter(r => r.codeScore);

    console.log(`\n🔧 Code Generation:`);
    console.log(`- Code extracted: ${withCode.length}/${successful.length}`);
    console.log(`- Docker executed: ${withDocker.length}/${successful.length}`);
    console.log(`- AI scored: ${withScoring.length}/${successful.length}`);

    // Show sample results
    console.log(`\n💻 Sample Code Outputs:`);
    successful.slice(0, 3).forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.model.provider}:${result.model.name}`);
      console.log(`   Duration: ${result.metadata.duration}ms`);
      console.log(`   Tokens: ${result.response.metadata.tokenUsage.promptTokens + result.response.metadata.tokenUsage.completionTokens}`);
      console.log(`   Cost: $${(result.response.metadata.cost?.total || 0).toFixed(4)}`);
      if (result.extractedCode) {
        console.log(`   Code Length: ${result.extractedCode.length} characters`);
      }
      if (result.dockerResult) {
        console.log(`   Docker Status: ${result.dockerResult.success ? 'Success' : 'Failed'}`);
      }
      if (result.codeScore) {
        console.log(`   AI Score: ${result.codeScore.overallScore || 'N/A'}`);
      }
    });
  }
  
  if (failed.length > 0) {
    console.log(`\n❌ Failed Evaluations:`);
    failed.forEach((result, index) => {
      console.log(`${index + 1}. ${result.model.provider}:${result.model.name} - ${result.metadata.error}`);
    });
  }
}

// Run the evaluation
runAdvancedTypeScriptEvaluation().catch(console.error);
