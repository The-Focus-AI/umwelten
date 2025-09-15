# Comprehensive Analysis Example

This example demonstrates how to perform detailed performance and quality analysis across multiple evaluations using the ComprehensiveAnalyzer.

## Running the Example

```bash
pnpm tsx scripts/examples/comprehensive-analysis-example.ts
```

## What This Example Shows

- **Performance Analysis**: Comprehensive performance metrics and optimization recommendations
- **Quality Assessment**: Multi-dimensional quality analysis (coherence, relevance, creativity, technical accuracy)
- **Model Comparison**: Side-by-side comparison of model performance
- **Cost Analysis**: Detailed cost breakdown and efficiency metrics
- **Actionable Insights**: Specific recommendations for optimization

## Code Walkthrough

### 1. Import Dependencies

```typescript
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
```

### 2. Create Multiple Evaluations

```typescript
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
```

### 3. Define Test Cases

```typescript
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
```

### 4. Run All Evaluations

```typescript
const allResults = [];

// Run creative writing evaluation
console.log("\n📝 Running Creative Writing Evaluation...");
const creativeResult = await evaluations[0].run({
  model: models[0],
  testCases: creativeTestCases
});
allResults.push(creativeResult);

// Run code generation evaluation
console.log("💻 Running Code Generation Evaluation...");
const codingResult = await evaluations[1].run({
  model: models[1],
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
```

### 5. Perform Comprehensive Analysis

```typescript
console.log("\n📊 Performing Comprehensive Analysis...");
const analyzer = new ComprehensiveAnalyzer(allResults);
const analysis = analyzer.analyze();
```

### 6. Display Analysis Results

```typescript
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
```

### 7. Generate Comprehensive Report

```typescript
console.log("\n📄 Generating comprehensive report...");
const report = analyzer.generateComprehensiveReport();

// Save report to file
const fs = await import('fs');
const reportPath = `output/comprehensive-analysis-report-${Date.now()}.md`;
fs.writeFileSync(reportPath, report);
console.log(`📄 Report saved to: ${reportPath}`);
```

## Key Features Demonstrated

### Performance Analysis
The ComprehensiveAnalyzer provides:
- **Response Time Analysis**: Average, min, max response times
- **Throughput Metrics**: Responses per minute
- **Error Rate Tracking**: Success/failure rates
- **Cost Analysis**: Detailed cost breakdown by model
- **Cache Performance**: Cache hit rates and efficiency

### Quality Assessment
Multi-dimensional quality analysis:
- **Coherence Score**: Text structure and flow analysis
- **Relevance Score**: Prompt-response alignment
- **Creativity Score**: Originality and innovation
- **Technical Accuracy**: Code quality and correctness

### Model Comparison
Side-by-side model analysis:
- **Performance Comparison**: Speed, efficiency, cost
- **Quality Comparison**: Response quality across dimensions
- **Cost Effectiveness**: Quality per dollar spent
- **Best/Worst Model Identification**: Automated ranking

### Actionable Insights
The analyzer provides:
- **Priority Actions**: Urgent issues that need attention
- **Recommendations**: Specific optimization suggestions
- **Bottleneck Identification**: Performance limiting factors
- **Cost Optimization**: Ways to reduce costs while maintaining quality

## Advanced Usage

### Custom Quality Metrics

```typescript
import { QualityAnalyzer } from '../../src/evaluation/analysis/quality-analyzer.js';

const qualityAnalyzer = new QualityAnalyzer(results);

// Get detailed quality breakdown
const qualityAnalysis = qualityAnalyzer.analyze();

console.log('Quality by Model:');
for (const [model, metrics] of Object.entries(qualityAnalysis.byModel)) {
  console.log(`${model}:`);
  console.log(`  Coherence: ${(metrics.coherenceScore * 100).toFixed(1)}%`);
  console.log(`  Relevance: ${(metrics.relevanceScore * 100).toFixed(1)}%`);
  console.log(`  Creativity: ${(metrics.creativityScore * 100).toFixed(1)}%`);
  console.log(`  Technical Accuracy: ${(metrics.technicalAccuracy * 100).toFixed(1)}%`);
}
```

### Performance Optimization

```typescript
import { PerformanceAnalyzer } from '../../src/evaluation/analysis/performance-analyzer.js';

const performanceAnalyzer = new PerformanceAnalyzer(results);

// Get performance recommendations
const performanceAnalysis = performanceAnalyzer.analyze();

console.log('Performance Recommendations:');
performanceAnalysis.recommendations.forEach(rec => {
  console.log(`- ${rec}`);
});

// Get bottleneck analysis
console.log('Identified Bottlenecks:');
performanceAnalysis.bottlenecks.forEach(bottleneck => {
  console.log(`- ${bottleneck}`);
});
```

### Cost Analysis

```typescript
// Detailed cost breakdown
const costAnalysis = analysis.performance.costAnalysis;

console.log('Cost Analysis:');
console.log(`Total Cost: $${costAnalysis.totalCost.toFixed(6)}`);
console.log('Cost by Model:');
for (const [model, cost] of Object.entries(costAnalysis.costPerModel)) {
  console.log(`  ${model}: $${cost.toFixed(6)}`);
}
console.log('Cost Efficiency (tokens per dollar):');
for (const [model, efficiency] of Object.entries(costAnalysis.costEfficiency)) {
  console.log(`  ${model}: ${efficiency.toFixed(0)} tokens/$`);
}
```

### Custom Analysis Configuration

```typescript
const analyzer = new ComprehensiveAnalyzer(results, {
  // Custom quality weights
  qualityWeights: {
    coherence: 0.3,
    relevance: 0.3,
    creativity: 0.2,
    technicalAccuracy: 0.2
  },
  
  // Custom performance weights
  performanceWeights: {
    responseTime: 0.4,
    throughput: 0.3,
    errorRate: 0.3
  },
  
  // Analysis options
  options: {
    includeDetailedMetrics: true,
    generateRecommendations: true,
    identifyBottlenecks: true,
    costAnalysis: true
  }
});
```

## Expected Output

```
🚀 Starting Comprehensive Analysis Example...
📊 Running 3 evaluations across 3 models

📝 Running Creative Writing Evaluation...
💻 Running Code Generation Evaluation...
🔄 Running Model Comparison Evaluation...
✅ All evaluations completed successfully!

📊 Performing Comprehensive Analysis...

============================================================
📈 COMPREHENSIVE ANALYSIS RESULTS
============================================================

🎯 Overall Score: 78.5/100
⚡ Efficiency Score: 82.3/100
💰 Cost Effectiveness: 1250.5 quality per dollar
📊 Total Evaluations: 3
💬 Total Responses: 8
⭐ Average Quality: 76.2%
🚀 Average Performance: 81.8%
💵 Total Cost: $0.012500
🏆 Best Model: gpt-4
⚠️  Worst Model: gemini-pro

🔴 PRIORITY ACTIONS:
   🟡 MEDIUM: Optimize response times for better user experience
   🟡 MEDIUM: Implement caching to reduce costs

💡 RECOMMENDATIONS:
   💾 Implement aggressive caching to reduce costs and improve performance
   📝 Enhance prompt engineering to improve response coherence
   🎯 Refine prompts to increase relevance and accuracy
   💰 Consider more cost-effective models for similar quality levels

📊 PERFORMANCE METRICS:
   Average Response Time: 1850.5ms
   Throughput: 12.3 responses/min
   Error Rate: 2.5%
   Cache Hit Rate: 15.0%
   Cost per Token: $0.0000125

⭐ QUALITY METRICS:
   Overall Quality: 76.2%
   Coherence: 78.5%
   Relevance: 82.1%
   Creativity: 71.3%
   Technical Accuracy: 72.9%

🤖 MODEL COMPARISON:
   gpt-4 (openrouter):
     Response Time: 1650.0ms
     Cost: $0.004500
     Error Rate: 0.0%
     Quality: 82.5%

   claude-3 (openrouter):
     Response Time: 1950.0ms
     Cost: $0.004200
     Error Rate: 5.0%
     Quality: 78.9%

   gemini-pro (google):
     Response Time: 2050.0ms
     Cost: $0.003800
     Error Rate: 2.5%
     Quality: 67.2%

💰 COST ANALYSIS:
   Total Cost: $0.012500
   Cost by Model:
     gpt-4: $0.004500
     claude-3: $0.004200
     gemini-pro: $0.003800
   Cost Efficiency (tokens per dollar):
     gpt-4: 1250 tokens/$
     claude-3: 1180 tokens/$
     gemini-pro: 1100 tokens/$

📄 Generating comprehensive report...
📄 Report saved to: output/comprehensive-analysis-report-1704067200000.md

📝 SAMPLE RESPONSES:
--- Creative Writing Test (gpt-4) ---
The robot's brush moved across the canvas with deliberate precision, each stroke a calculated expression of something it couldn't quite name. It had been learning to paint for three months now, and while its technical skills were flawless, the emotional depth remained elusive...

--- Code Generation Test (claude-3) ---
def fibonacci(n, memo={}):
    """
    Calculate the nth Fibonacci number using memoization for efficiency.
    
    Args:
        n (int): The position in the Fibonacci sequence
        memo (dict): Memoization dictionary to store computed values
    
    Returns:
        int: The nth Fibonacci number
    
    Raises:
        ValueError: If n is negative
    """
    if n < 0:
        raise ValueError("Fibonacci sequence is not defined for negative numbers")
    
    if n in memo:
        return memo[n]
    
    if n <= 1:
        return n
    
    memo[n] = fibonacci(n-1, memo) + fibonacci(n-2, memo)
    return memo[n]

🎉 Comprehensive Analysis Example Complete!
📊 Check the generated report for detailed analysis results.
```

## Use Cases

### Model Evaluation
- Compare multiple models across different tasks
- Identify the best model for specific use cases
- Evaluate model performance over time
- A/B test different model configurations

### Performance Optimization
- Identify performance bottlenecks
- Optimize response times and throughput
- Implement caching strategies
- Monitor resource usage

### Cost Analysis
- Track costs across different models
- Optimize cost vs. quality trade-offs
- Budget planning and forecasting
- ROI analysis for AI investments

### Quality Assurance
- Monitor response quality over time
- Identify quality degradation
- Implement quality improvement strategies
- Track quality metrics across models

## Next Steps

- Try the [Simple Evaluation Example](/examples/simple-evaluation) for basic evaluations
- Explore the [Matrix Evaluation Example](/examples/matrix-evaluation) for model comparison
- Check out the [Complex Pipeline Example](/examples/complex-pipeline) for advanced workflows
- Review the [Batch Evaluation Example](/examples/batch-evaluation) for processing multiple inputs
