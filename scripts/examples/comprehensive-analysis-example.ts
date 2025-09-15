import { ModelDetails } from "../../src/cognition/types.js";
import { SimpleEvaluation } from "../../src/evaluation/strategies/simple-evaluation.js";
import { MatrixEvaluation } from "../../src/evaluation/strategies/matrix-evaluation.js";
import { ComprehensiveAnalyzer } from "../../src/evaluation/analysis/comprehensive-analyzer.js";
import { 
  LiteraryAnalysisTemplate,
  CreativeWritingTemplate,
  PoetryGenerationTemplate
} from "../../src/stimulus/templates/creative-templates.js";
import { 
  CodeGenerationTemplate,
  DebuggingTemplate
} from "../../src/stimulus/templates/coding-templates.js";

// Define models to test
const models: ModelDetails[] = [
  {
    name: "gpt-4",
    provider: "openrouter",
    costs: { promptTokens: 0.0001, completionTokens: 0.0001 },
    maxTokens: 1000,
    temperature: 0.7
  },
  {
    name: "claude-3",
    provider: "openrouter",
    costs: { promptTokens: 0.0001, completionTokens: 0.0001 },
    maxTokens: 1000,
    temperature: 0.7
  },
  {
    name: "gemini-pro",
    provider: "google",
    costs: { promptTokens: 0.0001, completionTokens: 0.0001 },
    maxTokens: 1000,
    temperature: 0.7
  }
];

// Create multiple evaluations to analyze
const evaluations = [
  new SimpleEvaluation({
    id: "creative-writing-test",
    name: "Creative Writing Test",
    description: "Test creative writing capabilities"
  }),
  new SimpleEvaluation({
    id: "code-generation-test",
    name: "Code Generation Test", 
    description: "Test code generation capabilities"
  }),
  new MatrixEvaluation({
    id: "model-comparison-test",
    name: "Model Comparison Test",
    description: "Compare models on literary analysis"
  })
];

// Define test cases
const creativeTestCases = [
  {
    id: "story-writing",
    name: "Story Writing",
    stimulus: CreativeWritingTemplate,
    input: { prompt: "Write a short story about a robot learning to paint" }
  },
  {
    id: "poetry-writing",
    name: "Poetry Writing",
    stimulus: PoetryGenerationTemplate,
    input: { prompt: "Write a haiku about the ocean" }
  }
];

const codingTestCases = [
  {
    id: "function-generation",
    name: "Function Generation",
    stimulus: CodeGenerationTemplate,
    input: { prompt: "Write a Python function to calculate fibonacci numbers" }
  },
  {
    id: "debugging-task",
    name: "Debugging Task",
    stimulus: DebuggingTemplate,
    input: { 
      prompt: "Debug this Python code: def factorial(n): return n * factorial(n-1)",
      code: "def factorial(n): return n * factorial(n-1)"
    }
  }
];

const comparisonTestCases = [
  {
    id: "literary-analysis",
    name: "Literary Analysis",
    stimulus: LiteraryAnalysisTemplate,
    input: { prompt: "Analyze the themes in 'To Kill a Mockingbird'" }
  }
];

// Run all evaluations
console.log("🚀 Starting Comprehensive Analysis Example...");
console.log(`📊 Running ${evaluations.length} evaluations across ${models.length} models`);

const allResults = [];

try {
  // Run creative writing evaluation
  console.log("\n📝 Running Creative Writing Evaluation...");
  const creativeResult = await evaluations[0].run({
    model: models[0], // Use first model for simple evaluation
    testCases: creativeTestCases
  });
  allResults.push(creativeResult);

  // Run code generation evaluation
  console.log("💻 Running Code Generation Evaluation...");
  const codingResult = await evaluations[1].run({
    model: models[1], // Use second model for simple evaluation
    testCases: codingTestCases
  });
  allResults.push(codingResult);

  // Run model comparison evaluation
  console.log("🔄 Running Model Comparison Evaluation...");
  const comparisonResult = await evaluations[2].run({
    models: models,
    testCases: comparisonTestCases
  });
  allResults.push(comparisonResult);

  console.log("✅ All evaluations completed successfully!");

  // Perform comprehensive analysis
  console.log("\n📊 Performing Comprehensive Analysis...");
  const analyzer = new ComprehensiveAnalyzer(allResults);
  const analysis = analyzer.analyze();

  // Display analysis results
  console.log("\n" + "=".repeat(60));
  console.log("📈 COMPREHENSIVE ANALYSIS RESULTS");
  console.log("=".repeat(60));

  console.log(`\n🎯 Overall Score: ${analysis.combined.overallScore.toFixed(1)}/100`);
  console.log(`⚡ Efficiency Score: ${analysis.combined.efficiencyScore.toFixed(1)}/100`);
  console.log(`💰 Cost Effectiveness: ${analysis.combined.costEffectiveness.toFixed(2)} quality per dollar`);
  console.log(`📊 Total Evaluations: ${analysis.summary.totalEvaluations}`);
  console.log(`💬 Total Responses: ${analysis.summary.totalResponses}`);
  console.log(`⭐ Average Quality: ${analysis.summary.averageQuality.toFixed(1)}%`);
  console.log(`🚀 Average Performance: ${analysis.summary.averagePerformance.toFixed(1)}%`);
  console.log(`💵 Total Cost: $${analysis.summary.totalCost.toFixed(6)}`);
  console.log(`🏆 Best Model: ${analysis.summary.bestModel}`);
  console.log(`⚠️  Worst Model: ${analysis.summary.worstModel}`);

  // Display priority actions
  if (analysis.combined.priorityActions.length > 0) {
    console.log("\n🔴 PRIORITY ACTIONS:");
    analysis.combined.priorityActions.forEach(action => {
      console.log(`   ${action}`);
    });
  }

  // Display recommendations
  if (analysis.combined.recommendations.length > 0) {
    console.log("\n💡 RECOMMENDATIONS:");
    analysis.combined.recommendations.forEach(rec => {
      console.log(`   ${rec}`);
    });
  }

  // Display performance metrics
  console.log("\n📊 PERFORMANCE METRICS:");
  console.log(`   Average Response Time: ${analysis.performance.overall.averageResponseTime.toFixed(2)}ms`);
  console.log(`   Throughput: ${analysis.performance.overall.throughput.toFixed(2)} responses/min`);
  console.log(`   Error Rate: ${(analysis.performance.overall.errorRate * 100).toFixed(1)}%`);
  console.log(`   Cache Hit Rate: ${(analysis.performance.overall.cacheHitRate * 100).toFixed(1)}%`);
  console.log(`   Cost per Token: $${analysis.performance.overall.costPerToken.toFixed(8)}`);

  // Display quality metrics
  console.log("\n⭐ QUALITY METRICS:");
  console.log(`   Overall Quality: ${(analysis.quality.overall.overallQuality * 100).toFixed(1)}%`);
  console.log(`   Coherence: ${(analysis.quality.overall.coherenceScore * 100).toFixed(1)}%`);
  console.log(`   Relevance: ${(analysis.quality.overall.relevanceScore * 100).toFixed(1)}%`);
  console.log(`   Creativity: ${(analysis.quality.overall.creativityScore * 100).toFixed(1)}%`);
  console.log(`   Technical Accuracy: ${(analysis.quality.overall.technicalAccuracy * 100).toFixed(1)}%`);

  // Display model comparison
  console.log("\n🤖 MODEL COMPARISON:");
  for (const model of analysis.performance.byModel) {
    const modelKey = `${model.model}:${model.provider}`;
    const qualityMetrics = analysis.quality.byModel[modelKey];
    
    console.log(`\n   ${model.model} (${model.provider}):`);
    console.log(`     Response Time: ${model.metrics.averageResponseTime.toFixed(2)}ms`);
    console.log(`     Cost: $${model.metrics.totalCost.toFixed(6)}`);
    console.log(`     Error Rate: ${(model.metrics.errorRate * 100).toFixed(1)}%`);
    if (qualityMetrics) {
      console.log(`     Quality: ${(qualityMetrics.overallQuality * 100).toFixed(1)}%`);
    }
  }

  // Generate and save comprehensive report
  console.log("\n📄 Generating comprehensive report...");
  const report = analyzer.generateComprehensiveReport();
  
  // Save report to file
  const fs = await import('fs');
  const reportPath = `output/comprehensive-analysis-report-${Date.now()}.md`;
  fs.writeFileSync(reportPath, report);
  console.log(`📄 Report saved to: ${reportPath}`);

  // Display sample responses
  console.log("\n📝 SAMPLE RESPONSES:");
  for (let i = 0; i < Math.min(3, allResults.length); i++) {
    const result = allResults[i];
    if (result.responses.length > 0) {
      const response = result.responses[0];
      console.log(`\n--- ${result.name} (${response.metadata.model}) ---`);
      console.log(response.content.substring(0, 200) + "...");
    }
  }

} catch (error) {
  console.error("❌ Analysis failed:", error);
  process.exit(1);
}

console.log("\n🎉 Comprehensive Analysis Example Complete!");
console.log("📊 Check the generated report for detailed analysis results.");
