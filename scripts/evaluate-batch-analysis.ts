#!/usr/bin/env tsx

/**
 * Batch Analysis Evaluation - Phase 2 Demo
 * 
 * This script demonstrates the new BatchEvaluation strategy
 * with analysis stimuli and multiple data items.
 */

import { DataAnalysisStimulus, CodeReviewStimulus, BusinessAnalysisStimulus } from '../src/stimulus/analysis/advanced-analysis.js';
import { BatchEvaluation } from '../src/evaluation/strategies/batch-evaluation.js';
import { EvaluationCache } from '../src/evaluation/caching/cache-service.js';
import { ModelDetails } from '../src/cognition/types.js';

// Configuration
const EVALUATION_ID = 'batch-analysis-evaluation';
const MODELS: ModelDetails[] = [
  { name: 'gemma3:27b', provider: 'ollama' },
  { name: 'gemma3:12b', provider: 'ollama' },
  { name: 'llama3.2:latest', provider: 'ollama' },
];

// Sample data items for analysis
const DATA_ITEMS = [
  {
    id: 'sales-q1',
    content: 'Q1 Sales Data: Revenue $1.2M, Units 15,000, Growth 12%',
    metadata: { quarter: 'Q1', year: 2024, category: 'sales' }
  },
  {
    id: 'sales-q2',
    content: 'Q2 Sales Data: Revenue $1.1M, Units 14,000, Growth -8%',
    metadata: { quarter: 'Q2', year: 2024, category: 'sales' }
  },
  {
    id: 'sales-q3',
    content: 'Q3 Sales Data: Revenue $1.4M, Units 18,000, Growth 27%',
    metadata: { quarter: 'Q3', year: 2024, category: 'sales' }
  },
  {
    id: 'sales-q4',
    content: 'Q4 Sales Data: Revenue $1.6M, Units 20,000, Growth 14%',
    metadata: { quarter: 'Q4', year: 2024, category: 'sales' }
  }
];

const CODE_ITEMS = [
  {
    id: 'api-client',
    content: `function fetchUser(id) {
  return fetch(\`/api/users/\${id}\`)
    .then(response => response.json())
    .catch(error => console.error(error));
}`,
    metadata: { language: 'javascript', type: 'api' }
  },
  {
    id: 'data-processor',
    content: `class DataProcessor {
  process(data) {
    return data.map(item => {
      return {
        id: item.id,
        name: item.name.toUpperCase(),
        value: item.value * 2
      };
    });
  }
}`,
    metadata: { language: 'javascript', type: 'utility' }
  },
  {
    id: 'react-component',
    content: `const UserCard = ({ user }) => {
  return (
    <div className="user-card">
      <h3>{user.name}</h3>
      <p>{user.email}</p>
    </div>
  );
};`,
    metadata: { language: 'react', type: 'component' }
  }
];

const BUSINESS_ITEMS = [
  {
    id: 'remote-work',
    content: 'Remote work adoption increased from 20% to 80% over the past year. Productivity metrics show 15% improvement, but employee satisfaction surveys indicate concerns about work-life balance.',
    metadata: { topic: 'remote-work', impact: 'high' }
  },
  {
    id: 'ai-adoption',
    content: 'AI tools are being adopted across departments. Marketing reports 30% efficiency gains, but IT is concerned about security and data privacy implications.',
    metadata: { topic: 'ai-adoption', impact: 'medium' }
  },
  {
    id: 'market-competition',
    content: 'New competitor entered market with 20% lower pricing. Our market share dropped 5% in Q3. Customer retention rate decreased from 85% to 78%.',
    metadata: { topic: 'competition', impact: 'high' }
  }
];

// Evaluation configuration
const EVALUATION_CONFIG = {
  evaluationId: EVALUATION_ID,
  useCache: true,
  maxConcurrent: 2,
  groupByModel: false,
  progressCallback: (progress: any) => {
    console.log(`📊 Progress: ${progress.completed}/${progress.total} (${progress.percentage.toFixed(1)}%) - ${progress.currentModel} - ${progress.currentItem}`);
  }
};

async function runBatchAnalysisEvaluation() {
  console.log('📊 Batch Analysis Evaluation - Phase 2 Demo');
  console.log('============================================================');
  console.log(`📝 Stimulus: Analysis and Insights`);
  console.log(`📝 Description: Test models' ability to analyze various types of data and content`);
  console.log(`🤖 Models: ${MODELS.length} models`);
  console.log(`📋 Data Items: ${DATA_ITEMS.length + CODE_ITEMS.length + BUSINESS_ITEMS.length} items`);
  console.log(`🔢 Total Evaluations: ${(DATA_ITEMS.length + CODE_ITEMS.length + BUSINESS_ITEMS.length) * MODELS.length}`);
  console.log(`📁 Evaluation ID: ${EVALUATION_ID}`);
  console.log(`💾 Caching: ${EVALUATION_CONFIG.useCache ? 'Enabled' : 'Disabled'}`);
  console.log(`⚡ Concurrent: ${EVALUATION_CONFIG.maxConcurrent} models`);
  console.log('');

  const cache = new EvaluationCache(EVALUATION_ID);
  const results: any[] = [];

  // Test 1: Data Analysis Batch
  console.log('📈 Test 1: Data Analysis Batch');
  console.log('------------------------------------------------------------');
  
  const dataAnalysisEvaluation = new BatchEvaluation(
    DataAnalysisStimulus,
    MODELS,
    "Analyze the following data and provide insights: {content}",
    cache,
    {
      items: DATA_ITEMS,
      maxConcurrent: EVALUATION_CONFIG.maxConcurrent,
      groupByModel: EVALUATION_CONFIG.groupByModel,
      progressCallback: EVALUATION_CONFIG.progressCallback
    }
  );

  console.log('🚀 Starting data analysis batch evaluation...');
  const dataResults = await dataAnalysisEvaluation.run();
  results.push(...dataResults);

  console.log('✅ Data analysis batch evaluation completed');
  console.log('');

  // Test 2: Code Review Batch
  console.log('🔍 Test 2: Code Review Batch');
  console.log('------------------------------------------------------------');
  
  const codeReviewEvaluation = new BatchEvaluation(
    CodeReviewStimulus,
    MODELS,
    "Review the following code and provide feedback: {content}",
    cache,
    {
      items: CODE_ITEMS,
      maxConcurrent: EVALUATION_CONFIG.maxConcurrent,
      groupByModel: EVALUATION_CONFIG.groupByModel,
      progressCallback: EVALUATION_CONFIG.progressCallback
    }
  );

  console.log('🚀 Starting code review batch evaluation...');
  const codeResults = await codeReviewEvaluation.run();
  results.push(...codeResults);

  console.log('✅ Code review batch evaluation completed');
  console.log('');

  // Test 3: Business Analysis Batch
  console.log('💼 Test 3: Business Analysis Batch');
  console.log('------------------------------------------------------------');
  
  const businessAnalysisEvaluation = new BatchEvaluation(
    BusinessAnalysisStimulus,
    MODELS,
    "Analyze the following business situation and provide strategic recommendations: {content}",
    cache,
    {
      items: BUSINESS_ITEMS,
      maxConcurrent: EVALUATION_CONFIG.maxConcurrent,
      groupByModel: EVALUATION_CONFIG.groupByModel,
      progressCallback: EVALUATION_CONFIG.progressCallback
    }
  );

  console.log('🚀 Starting business analysis batch evaluation...');
  const businessResults = await businessAnalysisEvaluation.run();
  results.push(...businessResults);

  console.log('✅ Business analysis batch evaluation completed');
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
  console.log('🎉 Batch analysis evaluation complete! Check the output directory for detailed results.');
}

function analyzeResults(results: any[]) {
  console.log('============================================================');
  console.log('📊 BATCH EVALUATION RESULTS ANALYSIS');
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

    // Batch analysis
    const items = successful.map(r => r.item);
    const uniqueItems = new Set(items.map(i => i.id));
    
    console.log(`\n📋 Batch Analysis:`);
    console.log(`- Unique items processed: ${uniqueItems.size}`);
    console.log(`- Average evaluations per item: ${(successful.length / uniqueItems.size).toFixed(1)}`);

    // Group by item type
    const dataResults = successful.filter(r => r.item.metadata?.category === 'sales');
    const codeResults = successful.filter(r => r.item.metadata?.language);
    const businessResults = successful.filter(r => r.item.metadata?.topic);

    console.log(`\n📊 Results by Category:`);
    console.log(`- Data Analysis: ${dataResults.length} evaluations`);
    console.log(`- Code Review: ${codeResults.length} evaluations`);
    console.log(`- Business Analysis: ${businessResults.length} evaluations`);

    // Show sample results
    console.log(`\n📝 Sample Analysis Outputs:`);
    const sampleResults = successful.slice(0, 5);
    sampleResults.forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.model.provider}:${result.model.name}`);
      console.log(`   Item: ${result.item.id}`);
      console.log(`   Duration: ${result.metadata.duration}ms`);
      console.log(`   Tokens: ${result.response.metadata.tokenUsage.promptTokens + result.response.metadata.tokenUsage.completionTokens}`);
      console.log(`   Cost: $${(result.response.metadata.cost?.total || 0).toFixed(4)}`);
      console.log(`   Analysis Preview: ${result.response.content.substring(0, 150)}...`);
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
runBatchAnalysisEvaluation().catch(console.error);
