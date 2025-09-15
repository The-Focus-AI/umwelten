#!/usr/bin/env tsx

/**
 * Matrix Creative Evaluation - Phase 2 Demo
 * 
 * This script demonstrates the new MatrixEvaluation strategy
 * with creative writing stimuli and multiple dimensions.
 */

import { StoryWritingStimulus, PoetryStimulus, HumorWritingStimulus } from '../src/stimulus/creative/advanced-creative.js';
import { MatrixEvaluation } from '../src/evaluation/strategies/matrix-evaluation.js';
import { EvaluationCache } from '../src/evaluation/caching/cache-service.js';
import { ModelDetails } from '../src/cognition/types.js';

// Configuration
const EVALUATION_ID = 'matrix-creative-evaluation';
const MODELS: ModelDetails[] = [
  { name: 'gemma3:27b', provider: 'ollama' },
  { name: 'gemma3:12b', provider: 'ollama' },
  { name: 'llama3.2:latest', provider: 'ollama' },
];

// Matrix dimensions for creative writing
const CREATIVE_DIMENSIONS = [
  {
    name: 'genre',
    values: ['science fiction', 'fantasy', 'mystery', 'romance', 'horror']
  },
  {
    name: 'tone',
    values: ['serious', 'humorous', 'melancholic', 'upbeat', 'dark']
  },
  {
    name: 'length',
    values: ['short', 'medium', 'long']
  }
];

const PROMPT_TEMPLATE = "Write a {length} {genre} story with a {tone} tone about {topic}";

// Evaluation configuration
const EVALUATION_CONFIG = {
  evaluationId: EVALUATION_ID,
  useCache: true,
  maxConcurrent: 2,
  progressCallback: (progress: any) => {
    console.log(`📊 Progress: ${progress.completed}/${progress.total} (${progress.percentage.toFixed(1)}%) - ${progress.currentModel} - ${JSON.stringify(progress.currentCombination)}`);
  }
};

async function runMatrixCreativeEvaluation() {
  console.log('🎭 Matrix Creative Evaluation - Phase 2 Demo');
  console.log('============================================================');
  console.log(`📝 Stimulus: Creative Writing Matrix`);
  console.log(`📝 Description: Test models' ability to write creative content across multiple dimensions`);
  console.log(`🤖 Models: ${MODELS.length} models`);
  console.log(`📊 Dimensions: ${CREATIVE_DIMENSIONS.length} dimensions`);
  console.log(`🔢 Total Combinations: ${CREATIVE_DIMENSIONS.reduce((acc, dim) => acc * dim.values.length, 1) * MODELS.length}`);
  console.log(`📁 Evaluation ID: ${EVALUATION_ID}`);
  console.log(`💾 Caching: ${EVALUATION_CONFIG.useCache ? 'Enabled' : 'Disabled'}`);
  console.log(`⚡ Concurrent: ${EVALUATION_CONFIG.maxConcurrent} models`);
  console.log('');

  const cache = new EvaluationCache(EVALUATION_ID);
  const results: any[] = [];

  // Test 1: Story Writing Matrix
  console.log('📚 Test 1: Story Writing Matrix');
  console.log('------------------------------------------------------------');
  
  const storyEvaluation = new MatrixEvaluation(
    StoryWritingStimulus,
    MODELS,
    PROMPT_TEMPLATE.replace('{topic}', 'a time traveler'),
    cache,
    {
      dimensions: CREATIVE_DIMENSIONS,
      maxConcurrent: EVALUATION_CONFIG.maxConcurrent,
      progressCallback: EVALUATION_CONFIG.progressCallback
    }
  );

  console.log('🚀 Starting story writing matrix evaluation...');
  const storyResults = await storyEvaluation.run();
  results.push(...storyResults);

  console.log('✅ Story writing matrix evaluation completed');
  console.log('');

  // Test 2: Poetry Matrix (simplified dimensions)
  console.log('🎵 Test 2: Poetry Matrix');
  console.log('------------------------------------------------------------');
  
  const poetryDimensions = [
    {
      name: 'form',
      values: ['sonnet', 'haiku', 'free verse', 'limerick']
    },
    {
      name: 'theme',
      values: ['love', 'nature', 'loss', 'hope']
    }
  ];

  const poetryEvaluation = new MatrixEvaluation(
    PoetryStimulus,
    MODELS,
    PROMPT_TEMPLATE.replace('{topic}', 'the ocean'),
    cache,
    {
      dimensions: poetryDimensions,
      maxConcurrent: EVALUATION_CONFIG.maxConcurrent,
      progressCallback: EVALUATION_CONFIG.progressCallback
    }
  );

  console.log('🚀 Starting poetry matrix evaluation...');
  const poetryResults = await poetryEvaluation.run();
  results.push(...poetryResults);

  console.log('✅ Poetry matrix evaluation completed');
  console.log('');

  // Test 3: Humor Writing Matrix
  console.log('😄 Test 3: Humor Writing Matrix');
  console.log('------------------------------------------------------------');
  
  const humorDimensions = [
    {
      name: 'style',
      values: ['dry wit', 'sarcasm', 'absurdist', 'observational']
    },
    {
      name: 'topic',
      values: ['work', 'relationships', 'technology', 'everyday life']
    }
  ];

  const humorEvaluation = new MatrixEvaluation(
    HumorWritingStimulus,
    MODELS,
    PROMPT_TEMPLATE.replace('{topic}', 'a person who can\'t cook'),
    cache,
    {
      dimensions: humorDimensions,
      maxConcurrent: EVALUATION_CONFIG.maxConcurrent,
      progressCallback: EVALUATION_CONFIG.progressCallback
    }
  );

  console.log('🚀 Starting humor writing matrix evaluation...');
  const humorResults = await humorEvaluation.run();
  results.push(...humorResults);

  console.log('✅ Humor writing matrix evaluation completed');
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
  console.log('🎉 Matrix creative evaluation complete! Check the output directory for detailed results.');
}

function analyzeResults(results: any[]) {
  console.log('============================================================');
  console.log('📊 MATRIX EVALUATION RESULTS ANALYSIS');
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

    // Matrix analysis
    const combinations = successful.map(r => r.combination);
    const uniqueCombinations = new Set(combinations.map(c => JSON.stringify(c)));
    
    console.log(`\n🔢 Matrix Analysis:`);
    console.log(`- Unique combinations tested: ${uniqueCombinations.size}`);
    console.log(`- Average evaluations per combination: ${(successful.length / uniqueCombinations.size).toFixed(1)}`);

    // Show sample results by combination
    console.log(`\n📝 Sample Creative Outputs:`);
    const sampleResults = successful.slice(0, 5);
    sampleResults.forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.model.provider}:${result.model.name}`);
      console.log(`   Combination: ${JSON.stringify(result.combination)}`);
      console.log(`   Duration: ${result.metadata.duration}ms`);
      console.log(`   Tokens: ${result.response.metadata.tokenUsage.promptTokens + result.response.metadata.tokenUsage.completionTokens}`);
      console.log(`   Cost: $${(result.response.metadata.cost?.total || 0).toFixed(4)}`);
      console.log(`   Content Preview: ${result.response.content.substring(0, 100)}...`);
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
runMatrixCreativeEvaluation().catch(console.error);
