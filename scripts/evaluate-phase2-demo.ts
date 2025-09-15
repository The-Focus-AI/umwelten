#!/usr/bin/env tsx

/**
 * Phase 2 Comprehensive Demo
 * 
 * This script demonstrates all Phase 2 features:
 * - CodeGenerationEvaluation
 * - MatrixEvaluation  
 * - BatchEvaluation
 * - Advanced Stimulus Templates
 * - Result Analysis and Reporting
 */

import { 
  AdvancedTypeScriptStimulus, 
  StoryWritingStimulus, 
  DataAnalysisStimulus 
} from '../src/stimulus/index.js';
import { 
  CodeGenerationEvaluation, 
  MatrixEvaluation, 
  BatchEvaluation 
} from '../src/evaluation/strategies/index.js';
import { ResultAnalyzer, ReportGenerator } from '../src/evaluation/analysis/index.js';
import { EvaluationCache } from '../src/evaluation/caching/cache-service.js';
import { ModelDetails } from '../src/cognition/types.js';
import { EvaluationResult } from '../src/evaluation/types/evaluation-types.js';

// Configuration
const EVALUATION_ID = 'phase2-comprehensive-demo';
const MODELS: ModelDetails[] = [
  { name: 'gemma3:27b', provider: 'ollama' },
  { name: 'gemma3:12b', provider: 'ollama' },
  { name: 'llama3.2:latest', provider: 'ollama' },
];

async function runPhase2Demo() {
  console.log('🚀 Phase 2 Comprehensive Demo');
  console.log('============================================================');
  console.log('This demo showcases all Phase 2 features:');
  console.log('- CodeGenerationEvaluation with Docker execution');
  console.log('- MatrixEvaluation with multiple dimensions');
  console.log('- BatchEvaluation with multiple data items');
  console.log('- Advanced stimulus templates');
  console.log('- Result analysis and reporting');
  console.log('');

  const cache = new EvaluationCache(EVALUATION_ID);
  const allResults: EvaluationResult[] = [];

  // Demo 1: Code Generation Evaluation
  console.log('🔧 Demo 1: Code Generation Evaluation');
  console.log('------------------------------------------------------------');
  
  const codeEvaluation = new CodeGenerationEvaluation(
    AdvancedTypeScriptStimulus,
    MODELS,
    "Create a generic API client with retry logic, error handling, and TypeScript generics",
    cache,
    {
      extractCode: true,
      runDocker: true,
      aiScoring: true,
      fixCommonErrors: true,
      ensureConsoleOutput: true,
      dockerTimeout: 30000,
      maxConcurrent: 2
    }
  );

  console.log('🚀 Running code generation evaluation...');
  const codeResults = await codeEvaluation.run();
  allResults.push(...codeResults);
  console.log(`✅ Code generation completed: ${codeResults.length} results`);
  console.log('');

  // Demo 2: Matrix Evaluation
  console.log('📊 Demo 2: Matrix Evaluation');
  console.log('------------------------------------------------------------');
  
  const matrixDimensions = [
    {
      name: 'genre',
      values: ['science fiction', 'fantasy', 'mystery']
    },
    {
      name: 'tone',
      values: ['serious', 'humorous', 'melancholic']
    }
  ];

  const matrixEvaluation = new MatrixEvaluation(
    StoryWritingStimulus,
    MODELS,
    "Write a {length} {genre} story with a {tone} tone about a time traveler",
    cache,
    {
      dimensions: matrixDimensions,
      maxConcurrent: 2,
      progressCallback: (progress) => {
        console.log(`📊 Matrix Progress: ${progress.completed}/${progress.total} (${progress.percentage.toFixed(1)}%)`);
      }
    }
  );

  console.log('🚀 Running matrix evaluation...');
  const matrixResults = await matrixEvaluation.run();
  allResults.push(...matrixResults);
  console.log(`✅ Matrix evaluation completed: ${matrixResults.length} results`);
  console.log('');

  // Demo 3: Batch Evaluation
  console.log('📋 Demo 3: Batch Evaluation');
  console.log('------------------------------------------------------------');
  
  const batchItems = [
    {
      id: 'sales-q1',
      content: 'Q1 Sales Data: Revenue $1.2M, Units 15,000, Growth 12%',
      metadata: { quarter: 'Q1', year: 2024 }
    },
    {
      id: 'sales-q2',
      content: 'Q2 Sales Data: Revenue $1.1M, Units 14,000, Growth -8%',
      metadata: { quarter: 'Q2', year: 2024 }
    },
    {
      id: 'sales-q3',
      content: 'Q3 Sales Data: Revenue $1.4M, Units 18,000, Growth 27%',
      metadata: { quarter: 'Q3', year: 2024 }
    }
  ];

  const batchEvaluation = new BatchEvaluation(
    DataAnalysisStimulus,
    MODELS,
    "Analyze the following data and provide insights: {content}",
    cache,
    {
      items: batchItems,
      maxConcurrent: 2,
      groupByModel: false,
      progressCallback: (progress) => {
        console.log(`📋 Batch Progress: ${progress.completed}/${progress.total} (${progress.percentage.toFixed(1)}%)`);
      }
    }
  );

  console.log('🚀 Running batch evaluation...');
  const batchResults = await batchEvaluation.run();
  allResults.push(...batchResults);
  console.log(`✅ Batch evaluation completed: ${batchResults.length} results`);
  console.log('');

  // Demo 4: Result Analysis and Reporting
  console.log('📊 Demo 4: Result Analysis and Reporting');
  console.log('------------------------------------------------------------');
  
  const analyzer = new ResultAnalyzer();
  const analysis = analyzer.analyze(allResults);

  console.log('📈 Analysis Results:');
  console.log(`- Total Evaluations: ${analysis.metrics.totalEvaluations}`);
  console.log(`- Success Rate: ${analysis.metrics.successRate.toFixed(1)}%`);
  console.log(`- Average Duration: ${(analysis.metrics.averageDuration / 1000).toFixed(1)}s`);
  console.log(`- Total Cost: $${analysis.metrics.totalCost.toFixed(2)}`);
  console.log(`- Error Rate: ${analysis.metrics.errorRate.toFixed(1)}%`);
  console.log('');

  // Generate reports
  const reportGenerator = new ReportGenerator({
    outputDir: cache.getWorkdir(),
    format: 'all',
    includeDetails: true,
    includeRecommendations: true,
    includeCharts: false
  });

  console.log('📄 Generating reports...');
  const reportFiles = await reportGenerator.generateReport(analysis, allResults);
  console.log(`✅ Reports generated: ${reportFiles.length} files`);
  reportFiles.forEach(file => {
    console.log(`   - ${file}`);
  });
  console.log('');

  // Show recommendations
  if (analysis.recommendations.length > 0) {
    console.log('💡 Recommendations:');
    analysis.recommendations.forEach((rec, index) => {
      console.log(`   ${index + 1}. ${rec}`);
    });
    console.log('');
  }

  // Show model performance summary
  console.log('🏆 Model Performance Summary:');
  analysis.modelPerformance.forEach(model => {
    console.log(`   ${model.model.provider}:${model.model.name}:`);
    console.log(`     - Evaluations: ${model.evaluations}`);
    console.log(`     - Success Rate: ${model.successRate.toFixed(1)}%`);
    console.log(`     - Avg Duration: ${(model.averageDuration / 1000).toFixed(1)}s`);
    console.log(`     - Total Cost: $${model.totalCost.toFixed(2)}`);
    if (model.errors.length > 0) {
      console.log(`     - Errors: ${model.errors.length}`);
    }
  });
  console.log('');

  // Show stimulus performance summary
  console.log('🎯 Stimulus Performance Summary:');
  analysis.stimulusPerformance.forEach(stimulus => {
    console.log(`   ${stimulus.stimulusId}:`);
    console.log(`     - Evaluations: ${stimulus.evaluations}`);
    console.log(`     - Success Rate: ${stimulus.successRate.toFixed(1)}%`);
    console.log(`     - Avg Duration: ${(stimulus.averageDuration / 1000).toFixed(1)}s`);
    console.log(`     - Total Cost: $${stimulus.totalCost.toFixed(2)}`);
    console.log(`     - Models: ${stimulus.models.map(m => m.name).join(', ')}`);
  });
  console.log('');

  // Cache statistics
  const stats = cache.getStats();
  console.log('💾 Cache Statistics:');
  console.log(`- Total requests: ${stats.totalRequests}`);
  console.log(`- Cache hits: ${stats.hits}`);
  console.log(`- Cache misses: ${stats.misses}`);
  console.log(`- Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
  console.log(`- Errors: ${stats.errors}`);
  console.log('');

  console.log('🎉 Phase 2 comprehensive demo complete!');
  console.log('Check the output directory for detailed results and reports.');
}

// Run the demo
runPhase2Demo().catch(console.error);
