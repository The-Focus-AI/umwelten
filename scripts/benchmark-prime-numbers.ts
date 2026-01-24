#!/usr/bin/env npx tsx

/**
 * Prime Number Benchmark
 *
 * Benchmarks multiple Ollama models on code generation:
 * 1. Ask each model to write a prime number checker
 * 2. Time how long each takes
 * 3. Extract the code and run it in Dagger
 * 4. Use Claude Opus 4.5 (via OpenRouter) to evaluate code quality
 * 5. Generate comparison report with individual and comparative critiques
 */

import 'dotenv/config';
import { Stimulus } from '../src/stimulus/stimulus.js';
import { CodeGenerationEvaluation } from '../src/evaluation/strategies/code-generation-evaluation.js';
import { EvaluationCache } from '../src/evaluation/caching/cache-service.js';
import { ModelDetails } from '../src/cognition/types.js';
import { Interaction } from '../src/interaction/interaction.js';
import fs from 'fs';
import path from 'path';

// Configuration
const EVALUATION_ID = 'prime-benchmark';
const PROMPT = `Write a TypeScript function called isPrime that checks if a number is prime.

Requirements:
1. Take a number as input, return a boolean
2. Handle edge cases (negative numbers, 0, 1, 2)
3. Be efficient (don't check all numbers up to n)
4. Include test cases that print results to console`;

// Models to benchmark
const MODELS: ModelDetails[] = [
  // OpenRouter cloud models
  { name: 'moonshotai/kimi-k2', provider: 'openrouter' },  // Kimi K2
  { name: 'moonshotai/kimi-k2-thinking', provider: 'openrouter' },  // Kimi K2 thinking
  { name: 'z-ai/glm-4.7', provider: 'openrouter' },  // GLM 4.7
  // Ollama local/cloud models
  { name: 'minimax-m2.1:cloud', provider: 'ollama' },  // 230B cloud model
  { name: 'deepseek-r1:latest', provider: 'ollama' },
  { name: 'qwen3:30b-a3b', provider: 'ollama' },
  { name: 'qwen3:32b', provider: 'ollama' },
  { name: 'deepseek-r1:14b', provider: 'ollama' },
  { name: 'deepseek-r1:32b', provider: 'ollama' },
  { name: 'gpt-oss:latest', provider: 'ollama' },
];

// Claude Opus 4.5 for evaluation via OpenRouter
const EVALUATOR_MODEL: ModelDetails = {
  name: 'anthropic/claude-opus-4',  // Claude Opus 4.5 via OpenRouter
  provider: 'openrouter'
};

// Code generation stimulus
const CodeStimulus = new Stimulus({
  id: 'prime-code-gen',
  name: 'Prime Number Code Generation',
  description: 'Generate efficient prime number checking code',
  role: 'expert TypeScript developer',
  objective: 'write clean, efficient, well-tested TypeScript code',
  instructions: [
    'Write production-quality code',
    'Include proper type annotations',
    'Handle edge cases',
    'Add test cases that print to console'
  ],
  runnerType: 'base'
});

// Evaluation config with Opus 4.5 as evaluator
const EVAL_CONFIG = {
  evaluationId: EVALUATION_ID,
  useCache: true,
  maxConcurrent: 2,
  extractCode: true,
  runDagger: true,
  aiScoring: true,
  fixCommonErrors: true,
  ensureConsoleOutput: true,
  daggerTimeout: 30000,
  evaluatorModel: EVALUATOR_MODEL  // Use Opus 4.5 for AI evaluation
};

async function main() {
  console.log('🔢 Prime Number Code Generation Benchmark');
  console.log('='.repeat(60));
  console.log(`📝 Prompt: "${PROMPT.split('\n')[0]}..."`);
  console.log(`🤖 Models to test: ${MODELS.length}`);
  console.log(`🧠 Evaluator: ${EVALUATOR_MODEL.provider}:${EVALUATOR_MODEL.name}`);
  console.log(`📁 Evaluation ID: ${EVALUATION_ID}`);
  console.log(`🔷 Dagger: Enabled`);
  console.log();

  const cache = new EvaluationCache(EVALUATION_ID, {
    verbose: true,
    maxAge: 24 * 60 * 60 * 1000,
  });

  const evaluation = new CodeGenerationEvaluation(
    CodeStimulus,
    MODELS,
    PROMPT,
    cache,
    EVAL_CONFIG
  );

  console.log('🚀 Starting benchmark...\n');
  const startTime = Date.now();

  const results = await evaluation.run();

  const totalDuration = Date.now() - startTime;
  console.log(`\n✅ Benchmark completed in ${totalDuration}ms`);

  // Analyze results and build report
  const analysisReport = analyzeResults(results);

  // Generate comparative critique using Opus 4.5
  const comparativeReport = await generateComparativeCritique(results);

  // Cache stats
  const stats = cache.getStats();
  console.log(`\n💾 Cache Statistics:`);
  console.log(`- Requests: ${stats.totalRequests}`);
  console.log(`- Hits: ${stats.hits}`);
  console.log(`- Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);

  // Save full report
  const reportPath = saveReport(analysisReport, comparativeReport, totalDuration, stats);
  console.log(`\n📁 Results saved to: output/evaluations/${EVALUATION_ID}/`);
  console.log(`📄 Report saved to: ${reportPath}`);
}

function analyzeResults(results: any[]): string {
  console.log('\n' + '='.repeat(60));
  console.log('📊 BENCHMARK RESULTS');
  console.log('='.repeat(60));

  let report = `# Prime Number Code Generation Benchmark Report

**Date:** ${new Date().toISOString()}
**Evaluator:** ${EVALUATOR_MODEL.provider}:${EVALUATOR_MODEL.name}
**Models Tested:** ${MODELS.length}

## Prompt

\`\`\`
${PROMPT}
\`\`\`

`;

  const successful = results.filter(r => !r.metadata.error);
  const withDagger = successful.filter(r => r.daggerResult?.success);
  const withScore = successful.filter(r => r.codeScore);

  console.log(`\n📈 Summary:`);
  console.log(`- Total: ${results.length}`);
  console.log(`- Successful responses: ${successful.length}`);
  console.log(`- Dagger passed: ${withDagger.length}`);
  console.log(`- AI scored: ${withScore.length}`);

  report += `## Summary

| Metric | Value |
|--------|-------|
| Total Models | ${results.length} |
| Successful Responses | ${successful.length} |
| Dagger Execution Passed | ${withDagger.length} |
| AI Scored | ${withScore.length} |
`;

  // Helper to get actual generation time from response metadata
  const getGenerationTimeFromResponse = (r: any): number => {
    if (r.response?.metadata?.startTime && r.response?.metadata?.endTime) {
      const start = new Date(r.response.metadata.startTime).getTime();
      const end = new Date(r.response.metadata.endTime).getTime();
      return end - start;
    }
    return r.timing?.responseTime || 0;
  };

  if (successful.length > 0) {
    const avgTime = successful.reduce((sum, r) => sum + getGenerationTimeFromResponse(r), 0) / successful.length;
    console.log(`\n⏱️ Performance:`);
    console.log(`- Avg response time: ${(avgTime / 1000).toFixed(1)}s`);
    report += `| Avg Response Time | ${(avgTime / 1000).toFixed(1)}s |\n`;
  }

  report += `\n`;

  // Extract scores from codeScore.evals array
  const getScoreFromResult = (r: any) => {
    if (!r.codeScore?.evals) return null;
    const totalScoreEval = r.codeScore.evals.find((e: any) => e.key === 'total_score');
    return totalScoreEval ? parseFloat(totalScoreEval.value) : null;
  };

  const getAIScoreFromResult = (r: any) => {
    if (!r.codeScore?.evals) return null;
    const aiScoreEval = r.codeScore.evals.find((e: any) => e.key === 'ai_code_quality_score');
    return aiScoreEval ? parseInt(aiScoreEval.value) : null;
  };

  const getAISummaryFromResult = (r: any) => {
    if (!r.codeScore?.evals) return null;
    const summaryEval = r.codeScore.evals.find((e: any) => e.key === 'ai_code_quality_summary');
    return summaryEval ? summaryEval.value : null;
  };

  // Rank by score
  const ranked = [...successful]
    .filter(r => getScoreFromResult(r) !== null)
    .sort((a, b) => (getScoreFromResult(b) || 0) - (getScoreFromResult(a) || 0));

  if (ranked.length > 0) {
    console.log(`\n🏆 Rankings (by total score):`);
    report += `## Rankings

| Rank | Model | Total Score | AI Quality | Dagger | Generation Time |
|------|-------|-------------|------------|--------|-----------------|
`;
    ranked.forEach((r, i) => {
      const dagger = r.daggerResult?.success ? '✅' : '❌';
      const totalScore = getScoreFromResult(r)?.toFixed(3) || 'N/A';
      const aiScore = getAIScoreFromResult(r) || 'N/A';
      const genTimeMs = getGenerationTimeFromResponse(r);
      const time = (genTimeMs / 1000).toFixed(1);
      console.log(`${i + 1}. ${r.model.name}`);
      console.log(`   Total: ${totalScore} | AI Quality: ${aiScore}/5 | Dagger: ${dagger} | Time: ${time}s`);
      report += `| ${i + 1} | ${r.model.name} | ${totalScore} | ${aiScore}/5 | ${dagger} | ${time}s |\n`;
    });
    report += `\n`;
  }

  // Show individual critiques
  console.log(`\n📝 Individual AI Critiques:`);
  report += `## Individual Model Critiques

`;
  successful.forEach((r) => {
    console.log(`\n--- ${r.model.name} ---`);
    const aiScore = getAIScoreFromResult(r);
    const aiSummary = getAISummaryFromResult(r);
    const dagger = r.daggerResult?.success ? '✅ PASSED' : '❌ FAILED';
    const generationTimeMs = getGenerationTimeFromResponse(r);
    const time = (generationTimeMs / 1000).toFixed(1);

    console.log(`⏱️  Generation Time: ${time}s`);
    console.log(`🔷 Dagger Execution: ${dagger}`);
    console.log(`⭐ AI Quality Score: ${aiScore || 'N/A'}/5`);
    console.log(`💬 Critique: ${aiSummary || 'No critique available'}`);

    report += `### ${r.model.name}

- **Generation Time:** ${time}s
- **Dagger Execution:** ${dagger}
- **AI Quality Score:** ${aiScore || 'N/A'}/5
- **Critique:** ${aiSummary || 'No critique available'}
`;

    if (r.daggerResult?.output) {
      const outputPreview = r.daggerResult.output.slice(0, 150);
      console.log(`📤 Output: ${outputPreview}${r.daggerResult.output.length > 150 ? '...' : ''}`);
      report += `- **Output Preview:** \`${outputPreview.replace(/\n/g, ' ')}${r.daggerResult.output.length > 150 ? '...' : ''}\`\n`;
    }

    if (r.extractedCode) {
      report += `
<details>
<summary>View Generated Code</summary>

\`\`\`typescript
${r.extractedCode}
\`\`\`

</details>
`;
    }

    report += `\n`;
  });

  // Failures
  const failed = results.filter(r => r.metadata.error);
  if (failed.length > 0) {
    console.log(`\n❌ Failures:`);
    report += `## Failures\n\n`;
    failed.forEach(r => {
      console.log(`- ${r.model.name}: ${r.metadata.error}`);
      report += `- **${r.model.name}:** ${r.metadata.error}\n`;
    });
    report += `\n`;
  }

  return report;
}

async function generateComparativeCritique(results: any[]): Promise<string> {
  console.log('\n' + '='.repeat(60));
  console.log('🧠 COMPARATIVE ANALYSIS (by Claude Opus 4.5)');
  console.log('='.repeat(60));

  const successful = results.filter(r => !r.metadata.error);
  if (successful.length < 2) {
    console.log('Not enough successful results for comparative analysis.');
    return '';
  }

  // Helper functions
  const getAIScoreFromResult = (r: any) => {
    if (!r.codeScore?.evals) return null;
    const aiScoreEval = r.codeScore.evals.find((e: any) => e.key === 'ai_code_quality_score');
    return aiScoreEval ? parseInt(aiScoreEval.value) : null;
  };

  const getAISummaryFromResult = (r: any) => {
    if (!r.codeScore?.evals) return null;
    const summaryEval = r.codeScore.evals.find((e: any) => e.key === 'ai_code_quality_summary');
    return summaryEval ? summaryEval.value : null;
  };

  // Build summary for comparative analysis
  const modelSummaries = successful.map(r => {
    const time = ((r.timing?.responseTime || 0) / 1000).toFixed(1);
    const dagger = r.daggerResult?.success ? 'PASSED' : 'FAILED';
    const aiScore = getAIScoreFromResult(r);
    const aiSummary = getAISummaryFromResult(r);
    const codePreview = r.extractedCode?.slice(0, 500) || 'No code extracted';

    return `
Model: ${r.model.name}
- Generation Time: ${time}s
- Dagger Execution: ${dagger}
- AI Quality Score: ${aiScore}/5
- Individual Critique: ${aiSummary}
- Code Preview:
\`\`\`typescript
${codePreview}${r.extractedCode?.length > 500 ? '\n... (truncated)' : ''}
\`\`\`
`;
  }).join('\n---\n');

  const comparativePrompt = `You are an expert code reviewer. I have benchmarked ${successful.length} different AI models on the task of writing a TypeScript prime number checker function.

Here are the results for each model:

${modelSummaries}

Please provide a comprehensive comparative analysis that includes:

1. **Overall Winner**: Which model produced the best code overall and why?
2. **Speed vs Quality Trade-off**: How do the models compare in terms of generation time vs code quality?
3. **Execution Success**: What patterns do you notice in models that passed vs failed Dagger execution?
4. **Code Style Comparison**: Compare the coding styles, approaches, and efficiency of the different implementations.
5. **Recommendations**: Based on these results, which model would you recommend for different use cases (fast prototyping, production code, learning)?

Keep your analysis concise but insightful.`;

  try {
    console.log('\n⏳ Generating comparative analysis...\n');

    const evaluationStimulus = new Stimulus({
      role: "senior software architect and code reviewer",
      objective: "provide insightful comparative analysis of code generated by different AI models",
      runnerType: 'base'
    });

    const interaction = new Interaction(EVALUATOR_MODEL, evaluationStimulus);
    interaction.addMessage({ role: 'user', content: comparativePrompt });

    const response = await interaction.streamText();

    console.log(response.content);
    return response.content;

  } catch (error) {
    console.error('Failed to generate comparative critique:', error);
    console.log('\n(Comparative analysis requires OPENROUTER_API_KEY to be set)');
    return '';
  }
}

function saveReport(analysisReport: string, comparativeReport: string, totalDuration: number, stats: any): string {
  const outputDir = path.join(process.cwd(), 'output', 'evaluations', EVALUATION_ID);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const fullReport = `${analysisReport}
## Comparative Analysis (by Claude Opus 4.5)

${comparativeReport}

---

## Benchmark Metadata

- **Total Duration:** ${(totalDuration / 1000).toFixed(1)}s
- **Cache Requests:** ${stats.totalRequests}
- **Cache Hits:** ${stats.hits}
- **Cache Hit Rate:** ${(stats.hitRate * 100).toFixed(1)}%
- **Generated:** ${new Date().toISOString()}
`;

  const reportPath = path.join(outputDir, 'REPORT.md');
  fs.writeFileSync(reportPath, fullReport);

  return reportPath;
}

main().catch(console.error);
