import { ModelDetails } from "../../src/cognition/types.js";
import { SimpleEvaluation } from "../../src/evaluation/strategies/simple-evaluation.js";
import { MatrixEvaluation } from "../../src/evaluation/strategies/matrix-evaluation.js";
import { ComprehensiveAnalyzer } from "../../src/evaluation/analysis/comprehensive-analyzer.js";
import { createCreativeStimulus, LiteraryAnalysisTemplate, CreativeWritingTemplate, PoetryGenerationTemplate } from "../../src/stimulus/templates/creative-templates.js";
import { createCodingStimulus, CodeGenerationTemplate, DebuggingTemplate } from "../../src/stimulus/templates/coding-templates.js";
import { getAllModels } from "../../src/cognition/models.js";
import { EvaluationCache } from "../../src/evaluation/caching/cache-service.js";

async function runComprehensiveAnalysisExample() {
  console.log('🔍 Comprehensive Analysis Example: Multi-Domain Evaluation');
  console.log('='.repeat(60));

  // Get available models
  const allModels = await getAllModels();
  const models = allModels
    .filter(model => ['gemma3:12b', 'qwen2.5:14b'].includes(model.name))
    .slice(0, 2); // Limit to 2 models for demo

  console.log(`📚 Using ${models.length} models: ${models.map(m => m.name).join(', ')}`);

  // Create cache
  const cache = new EvaluationCache('comprehensive-analysis-example', { verbose: true });

  // Run multiple evaluations
  const evaluationResults = [];

  // 1. Creative Writing Evaluation
  console.log('\n🎨 Running Creative Writing Evaluation...');
  const creativeStimulus = createCreativeStimulus(CreativeWritingTemplate);
  const creativeEvaluation = new SimpleEvaluation(
    creativeStimulus,
    models,
    "Write a short story about a robot learning to paint. Focus on the emotional journey and the robot's growing understanding of art.",
    cache
  );
  const creativeResults = await creativeEvaluation.run();
  evaluationResults.push({
    type: 'creative',
    results: creativeResults,
    name: 'Creative Writing'
  });

  // 2. Code Generation Evaluation
  console.log('\n💻 Running Code Generation Evaluation...');
  const codingStimulus = createCodingStimulus(CodeGenerationTemplate);
  const codingEvaluation = new SimpleEvaluation(
    codingStimulus,
    models,
    "Write a Python function that calculates the factorial of a number using recursion. Include error handling and documentation.",
    cache
  );
  const codingResults = await codingEvaluation.run();
  evaluationResults.push({
    type: 'coding',
    results: codingResults,
    name: 'Code Generation'
  });

  // 3. Literary Analysis Matrix Evaluation
  console.log('\n📖 Running Literary Analysis Matrix Evaluation...');
  const literaryStimulus = createCreativeStimulus(LiteraryAnalysisTemplate);
  const matrixEvaluation = new MatrixEvaluation(
    literaryStimulus,
    models,
    "Analyze the following literary work and provide insights about its themes, characters, and literary devices.",
    cache,
    {
      dimensions: [
        { name: 'workType', values: ['novel', 'poem', 'short-story'] },
        { name: 'timePeriod', values: ['classical', 'modern', 'contemporary'] },
        { name: 'genre', values: ['drama', 'comedy', 'tragedy'] }
      ],
      maxConcurrent: 2,
      progressCallback: (progress) => {
        console.log(`Matrix Progress: ${progress.completed}/${progress.total} (${progress.percentage.toFixed(1)}%)`);
      }
    }
  );
  const matrixResults = await matrixEvaluation.run();
  evaluationResults.push({
    type: 'matrix',
    results: matrixResults,
    name: 'Literary Analysis Matrix'
  });

  // 4. Comprehensive Analysis
  console.log('\n📊 Running Comprehensive Analysis...');
  
  // Analyze each evaluation type
  for (const evaluation of evaluationResults) {
    console.log(`\n🔍 Analyzing ${evaluation.name}...`);
    
    const analyzer = new ComprehensiveAnalyzer(evaluation.results);
    const analysis = analyzer.analyze();

    console.log(`\n📈 ${evaluation.name} Analysis:`);
    console.log(`   Total Responses: ${analysis.summary.totalResponses}`);
    console.log(`   Average Quality: ${analysis.summary.averageQuality.toFixed(2)}/10`);
    console.log(`   Average Performance: ${analysis.summary.averagePerformance.toFixed(2)}/10`);
    console.log(`   Total Cost: $${analysis.summary.totalCost.toFixed(6)}`);
    console.log(`   Best Model: ${analysis.summary.bestModel}`);
    console.log(`   Worst Model: ${analysis.summary.worstModel}`);
    
    if (analysis.performance) {
      console.log(`   Performance Score: ${analysis.performance.overallScore.toFixed(2)}/10`);
      console.log(`   Speed Grade: ${analysis.performance.speedGrade}`);
      console.log(`   Efficiency Grade: ${analysis.performance.efficiencyGrade}`);
    }
    
    if (analysis.quality) {
      console.log(`   Quality Score: ${analysis.quality.overallScore.toFixed(2)}/10`);
      console.log(`   Coherence Grade: ${analysis.quality.coherenceGrade}`);
      console.log(`   Relevance Grade: ${analysis.quality.relevanceGrade}`);
    }

    if (analysis.combined) {
      console.log(`   Combined Score: ${analysis.combined.overallScore.toFixed(2)}/10`);
      console.log(`   Efficiency Score: ${analysis.combined.efficiencyScore.toFixed(2)}/10`);
      console.log(`   Cost Effectiveness: ${analysis.combined.costEffectiveness.toFixed(2)}/10`);
    }
  }

  // Cross-evaluation analysis
  console.log('\n🔄 Cross-Evaluation Analysis:');
  console.log('-'.repeat(40));
  
  const allResults = evaluationResults.flatMap(e => e.results);
  const crossAnalyzer = new ComprehensiveAnalyzer(allResults);
  const crossAnalysis = crossAnalyzer.analyze();

  console.log(`\n📊 Overall Performance Summary:`);
  console.log(`   Total Evaluations: ${evaluationResults.length}`);
  console.log(`   Total Responses: ${crossAnalysis.summary.totalResponses}`);
  console.log(`   Average Quality: ${crossAnalysis.summary.averageQuality.toFixed(2)}/10`);
  console.log(`   Average Performance: ${crossAnalysis.summary.averagePerformance.toFixed(2)}/10`);
  console.log(`   Total Cost: $${crossAnalysis.summary.totalCost.toFixed(6)}`);
  console.log(`   Best Model: ${crossAnalysis.summary.bestModel}`);
  console.log(`   Worst Model: ${crossAnalysis.summary.worstModel}`);

  if (crossAnalysis.performance) {
    console.log(`   Overall Performance Score: ${crossAnalysis.performance.overallScore.toFixed(2)}/10`);
  }

  if (crossAnalysis.quality) {
    console.log(`   Overall Quality Score: ${crossAnalysis.quality.overallScore.toFixed(2)}/10`);
  }

  if (crossAnalysis.combined) {
    console.log(`\n🏆 Combined Analysis:`);
    console.log(`   Overall Score: ${crossAnalysis.combined.overallScore.toFixed(2)}/10`);
    console.log(`   Efficiency Score: ${crossAnalysis.combined.efficiencyScore.toFixed(2)}/10`);
    console.log(`   Cost Effectiveness: ${crossAnalysis.combined.costEffectiveness.toFixed(2)}/10`);
  }

  console.log('\n✅ Comprehensive Analysis Complete!');
  console.log('🎉 All evaluations and analyses completed successfully!');
}

// Run the example
runComprehensiveAnalysisExample().catch(console.error);