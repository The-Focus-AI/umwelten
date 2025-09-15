#!/usr/bin/env npx tsx

/**
 * Cat Poem Evaluation Script
 * 
 * This script demonstrates the new Stimulus-centric evaluation architecture
 * by evaluating multiple models on a creative writing task.
 * 
 * Features demonstrated:
 * - Stimulus definition and usage
 * - SimpleEvaluation strategy
 * - Comprehensive caching
 * - Progress tracking
 * - Result analysis
 */

import { CatPoemStimulus } from '../src/stimulus/creative/cat-poem.js';
import { SimpleEvaluation } from '../src/evaluation/strategies/simple-evaluation.js';
import { EvaluationCache } from '../src/evaluation/caching/cache-service.js';
import { ModelDetails } from '../src/cognition/types.js';
import { EvaluationProgress } from '../src/evaluation/types/evaluation-types.js';

// Configuration
const EVALUATION_ID = 'cat-poem-evaluation';
const PROMPT = "Write a short poem about a cat";

// Models to evaluate (local Ollama models for testing)
const MODELS: ModelDetails[] = [
  // Local Ollama models
  { name: 'gemma3:27b', provider: 'ollama' },
  { name: 'gemma3:12b', provider: 'ollama' },
  { name: 'llama3.2:latest', provider: 'ollama' },
  
  // Cloud models (commented out for testing without API keys)
  // { name: 'gemini-2.0-flash', provider: 'google' },
  // { name: 'gemini-2.5-flash', provider: 'google' },
  // { name: 'openai/gpt-4o-mini', provider: 'openrouter' },
];

// Evaluation configuration
const EVALUATION_CONFIG = {
  evaluationId: EVALUATION_ID,
  useCache: true,
  concurrent: true,
  maxConcurrency: 3,
  resume: true,
  showProgress: true,
};

/**
 * Progress callback to show evaluation progress
 */
function onProgress(progress: EvaluationProgress): void {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  
  switch (progress.status) {
    case 'starting':
      console.log(`[${timestamp}] 🚀 Starting evaluation: ${progress.modelName}`);
      break;
    case 'in-progress':
      if (progress.content) {
        const preview = progress.content.substring(0, 50) + (progress.content.length > 50 ? '...' : '');
        console.log(`[${timestamp}] ⏳ ${progress.modelName}: ${preview}`);
      }
      break;
    case 'completed':
      console.log(`[${timestamp}] ✅ Completed: ${progress.modelName}`);
      if (progress.metadata) {
        const duration = progress.metadata.endTime.getTime() - progress.metadata.startTime.getTime();
        const tokens = progress.metadata.tokenUsage.promptTokens + progress.metadata.tokenUsage.completionTokens;
        console.log(`[${timestamp}] 📊 ${progress.modelName}: ${duration}ms, ${tokens} tokens`);
      }
      break;
    case 'error':
      console.log(`[${timestamp}] ❌ Error: ${progress.modelName} - ${progress.error}`);
      break;
  }
}

/**
 * Analyze and display evaluation results
 */
function analyzeResults(results: any[]): void {
  console.log('\n' + '='.repeat(60));
  console.log('📊 EVALUATION RESULTS ANALYSIS');
  console.log('='.repeat(60));
  
  const successful = results.filter(r => !r.metadata.error);
  const failed = results.filter(r => r.metadata.error);
  
  console.log(`\n📈 Summary:`);
  console.log(`- Total models: ${results.length}`);
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
  }
  
  console.log(`\n🎨 Creative Outputs:`);
  successful.forEach((result, index) => {
    console.log(`\n${index + 1}. ${result.model.provider}:${result.model.name}`);
    console.log(`   Duration: ${result.metadata.duration}ms`);
    console.log(`   Tokens: ${result.response.metadata.tokenUsage.promptTokens + result.response.metadata.tokenUsage.completionTokens}`);
    console.log(`   Cost: $${(result.response.metadata.cost?.total || 0).toFixed(4)}`);
    console.log(`   Poem:`);
    console.log(`   ${result.response.content.split('\n').map((line: string) => `   ${line}`).join('\n')}`);
  });
  
  if (failed.length > 0) {
    console.log(`\n❌ Failed Evaluations:`);
    failed.forEach((result, index) => {
      console.log(`${index + 1}. ${result.model.provider}:${result.model.name} - ${result.metadata.error}`);
    });
  }
  
  console.log('\n' + '='.repeat(60));
}

/**
 * Main evaluation function
 */
async function main(): Promise<void> {
  console.log('🐱 Cat Poem Evaluation - New Architecture Demo');
  console.log('='.repeat(60));
  console.log(`📝 Stimulus: ${CatPoemStimulus.options.name}`);
  console.log(`📝 Description: ${CatPoemStimulus.options.description}`);
  console.log(`📝 Prompt: "${PROMPT}"`);
  console.log(`🤖 Models: ${MODELS.length} models`);
  console.log(`📁 Evaluation ID: ${EVALUATION_ID}`);
  console.log(`💾 Caching: ${EVALUATION_CONFIG.useCache ? 'Enabled' : 'Disabled'}`);
  console.log(`⚡ Concurrent: ${EVALUATION_CONFIG.concurrent ? 'Enabled' : 'Disabled'}`);
  console.log();
  
  try {
    // Create evaluation cache
    const cache = new EvaluationCache(EVALUATION_ID, {
      verbose: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
    
    // Create evaluation strategy
    const evaluation = new SimpleEvaluation(
      CatPoemStimulus,
      MODELS,
      PROMPT,
      cache,
      EVALUATION_CONFIG,
      onProgress
    );
    
    console.log('🚀 Starting evaluation...\n');
    const startTime = Date.now();
    
    // Run evaluation
    const results = await evaluation.run();
    
    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    
    console.log(`\n✅ Evaluation completed in ${totalDuration}ms`);
    
    // Analyze results
    analyzeResults(results);
    
    // Show cache statistics
    const cacheStats = cache.getStats();
    console.log(`\n💾 Cache Statistics:`);
    console.log(`- Total requests: ${cacheStats.totalRequests}`);
    console.log(`- Cache hits: ${cacheStats.hits}`);
    console.log(`- Cache misses: ${cacheStats.misses}`);
    console.log(`- Hit rate: ${(cacheStats.hitRate * 100).toFixed(1)}%`);
    console.log(`- Errors: ${cacheStats.errors}`);
    
    console.log('\n🎉 Evaluation complete! Check the output directory for detailed results.');
    
  } catch (error) {
    console.error('❌ Evaluation failed:', error);
    process.exit(1);
  }
}

// Run the evaluation
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
