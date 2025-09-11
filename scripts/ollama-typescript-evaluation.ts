#!/usr/bin/env tsx

/**
 * Ollama TypeScript Evaluation Pipeline
 * 
 * This script performs a complete evaluation of Ollama models for TypeScript code generation:
 * PASS 1: Generate responses from all models
 * PASS 2: Extract TypeScript code from responses
 * PASS 3: Build and run Docker containers for each extracted code
 * PASS 4: Evaluate results and generate scores
 * PASS 5: Combine everything into final report
 */

import fs from 'fs';
import path from 'path';
import { FunctionEvaluationRunner } from '../src/evaluation/evaluate.js';
import { Interaction } from '../src/interaction/interaction.js';
import { Stimulus } from '../src/stimulus/stimulus.js';
import { extractTypeScriptCode, fixCommonTypeScriptErrors, ensureConsoleOutput } from '../src/evaluation/typescript-code-extractor.js';
import { DockerRunner } from '../src/evaluation/docker-runner.js';
import { CodeScorer } from '../src/evaluation/code-scorer.js';

// Configuration
const OLLAMA_MODELS = [
  { name: 'gpt-oss:20b', provider: 'ollama' },
  { name: 'gemma3:12b', provider: 'ollama' },
  { name: 'gemma3:27b', provider: 'ollama' },
  { name: 'deepseek-r1:32b', provider: 'ollama' },
  { name: 'devstral:24b', provider: 'ollama' },
  { name: 'mistral-small3.2:24b', provider: 'ollama' },
  { name: 'llama3.2:latest', provider: 'ollama' }
] as const;

const PROMPT = `i need a script that will give me at least 1042 distinct but made up show names. they should be funny and grammatically correct and written in typescript`;

const EVALUATION_ID = 'ollama-typescript-eval';
const WORKDIR = path.join(process.cwd(), 'output/evaluations', EVALUATION_ID);

interface ModelResult {
  modelName: string;
  response?: any;
  extractedCode?: string;
  dockerResult?: any;
  score?: any;
  timing?: {
    responseTime?: number;
    extractionTime?: number;
    dockerTime?: number;
    totalTime?: number;
  };
}

async function main() {
  const overallStartTime = Date.now();
  
  console.log('🚀 Starting Ollama TypeScript Evaluation Pipeline');
  console.log('='.repeat(60));
  console.log(`📝 Prompt: "${PROMPT}"`);
  console.log(`🤖 Models: ${OLLAMA_MODELS.length} Ollama models`);
  console.log(`📁 Workdir: ${WORKDIR}`);
  console.log();

  const results: ModelResult[] = OLLAMA_MODELS.map(model => ({ 
    modelName: model.name,
    timing: {}
  }));
  
  // PASS 1: Generate responses from all models
  console.log('📤 PASS 1: Generating responses from Ollama models...');
  await generateModelResponses(results);
  console.log(`✅ Generated responses for ${results.filter(r => r.response).length} models`);
  console.log();

  // PASS 2: Extract TypeScript code from responses
  console.log('🔧 PASS 2: Extracting TypeScript code from responses...');
  await extractTypeScriptCodeFromResponses(results);
  console.log(`✅ Extracted code for ${results.filter(r => r.extractedCode).length} models`);
  console.log();

  // PASS 3: Run code in Docker containers
  console.log('🐳 PASS 3: Running code in Docker containers...');
  await runCodeInDockerContainers(results);
  console.log(`✅ Docker executions completed for ${results.filter(r => r.dockerResult).length} models`);
  console.log();

  // PASS 4: Evaluate results and generate scores
  console.log('📊 PASS 4: Evaluating results and generating scores...');
  await evaluateResults(results);
  console.log(`✅ Evaluated ${results.filter(r => r.score).length} models`);
  console.log();

  // PASS 5: Generate final report
  console.log('📋 PASS 5: Generating final evaluation report...');
  await generateFinalReport(results);
  console.log('✅ Final report generated');
  console.log();



  // Print summary
  printSummary(results, overallStartTime);
}

/**
 * PASS 1: Generate responses from all models
 */
async function generateModelResponses(results: ModelResult[]) {
  const responsesDir = path.join(WORKDIR, 'responses');
  
  // Create responses directory
  if (!fs.existsSync(responsesDir)) {
    fs.mkdirSync(responsesDir, { recursive: true });
  }

  for (const result of results) {
    console.log(`  🤖 Testing ${result.modelName}...`);
    
    try {
      const startTime = Date.now();
      
      // Create evaluation runner with function to generate response
      const runner = new FunctionEvaluationRunner(EVALUATION_ID, 'responses', async (details) => {
        const typescriptStimulus = new Stimulus({
          role: "helpful TypeScript programming assistant",
          objective: "generate TypeScript code solutions",
          runnerType: 'base'
        });
        const interaction = new Interaction(details, typescriptStimulus);
        interaction.addMessage({ role: 'user', content: PROMPT });
        
        return await interaction.streamText();
      });

      // Run evaluation for this model
      const response = await runner.evaluate({ name: result.modelName, provider: 'ollama' });
      if (response) {
        result.response = response;
        
        // Extract actual response time from metadata if available
        if (response.metadata?.startTime && response.metadata?.endTime) {
          const actualStartTime = new Date(response.metadata.startTime).getTime();
          const actualEndTime = new Date(response.metadata.endTime).getTime();
          result.timing!.responseTime = actualEndTime - actualStartTime;
          console.log(`    ✅ Response generated (${response.content.length} chars) in ${result.timing!.responseTime}ms (${(result.timing!.responseTime / 1000).toFixed(1)}s)`);
        } else {
          // Fallback to file loading time (will be very small for cached responses)
          result.timing!.responseTime = Date.now() - startTime;
          console.log(`    ✅ Response generated (${response.content.length} chars) in ${result.timing!.responseTime}ms (cached)`);
        }
      } else {
        console.log(`    ⚠️  No response generated`);
      }
      
    } catch (error) {
      console.error(`    ❌ Error generating response for ${result.modelName}:`, error);
    }
  }
}

/**
 * PASS 2: Extract TypeScript code from responses
 */
async function extractTypeScriptCodeFromResponses(results: ModelResult[]) {
  const extractedDir = path.join(WORKDIR, 'extracted-code');
  
  // Create extracted code directory
  if (!fs.existsSync(extractedDir)) {
    fs.mkdirSync(extractedDir, { recursive: true });
  }

  for (const result of results) {
    if (!result.response) {
      console.log(`  ⚠️  Skipping ${result.modelName} - no response available`);
      continue;
    }

    console.log(`  🔧 Extracting code from ${result.modelName}...`);
    
    try {
      const startTime = Date.now();
      const content = result.response.content;
      let extractedCode = extractTypeScriptCode(content);
      
      if (extractedCode) {
        // Fix common TypeScript errors
        extractedCode = fixCommonTypeScriptErrors(extractedCode);
        // Ensure the code outputs to console.log instead of files
        extractedCode = ensureConsoleOutput(extractedCode);
        result.extractedCode = extractedCode;
        
        // Save extracted code to file
        const codeFile = path.join(extractedDir, `${result.modelName.replace(/[^a-zA-Z0-9]/g, '-')}.ts`);
        fs.writeFileSync(codeFile, extractedCode);
        
        result.timing!.extractionTime = Date.now() - startTime;
        console.log(`    ✅ Code extracted (${extractedCode.length} chars) in ${result.timing!.extractionTime}ms`);
      } else {
        console.log(`    ❌ No TypeScript code found in response`);
      }
      
    } catch (error) {
      console.error(`    ❌ Error extracting code from ${result.modelName}:`, error);
    }
  }
}

/**
 * PASS 3: Run code in Docker containers
 */
async function runCodeInDockerContainers(results: ModelResult[]) {
  for (const result of results) {
    if (!result.extractedCode) {
      console.log(`  ⚠️  Skipping ${result.modelName} - no code extracted`);
      continue;
    }

    console.log(`  🐳 Running ${result.modelName} code in Docker...`);
    
    try {
      const startTime = Date.now();
      
      // Run code in Docker container
      const dockerResult = await DockerRunner.runCode({
        code: result.extractedCode,
        language: 'typescript',
        timeout: 30,
        modelName: result.modelName
      });
      
      result.dockerResult = {
        modelName: result.modelName,
        buildSuccess: dockerResult.success,
        testSuccess: dockerResult.success,
        output: dockerResult.output,
        error: dockerResult.error
      };
      
      result.timing!.dockerTime = Date.now() - startTime;
      
      if (dockerResult.success) {
        const outputLines = dockerResult.output?.split('\n').filter(line => line.trim().length > 0).length || 0;
        const distinctLines = new Set(dockerResult.output?.split('\n').filter(line => line.trim().length > 0)).size;
        console.log(`    ✅ Docker execution successful (${outputLines} lines, ${distinctLines} unique, ${dockerResult.output?.length || 0} chars) in ${result.timing!.dockerTime}ms`);
      } else {
        console.log(`    ❌ Docker execution failed: ${dockerResult.error} (${result.timing!.dockerTime}ms)`);
      }
      
    } catch (error) {
      console.error(`    ❌ Error running Docker for ${result.modelName}:`, error);
    }
  }
}

/**
 * PASS 4: Evaluate results and generate scores using AI-powered code quality evaluation
 */
async function evaluateResults(results: ModelResult[]) {
  const scoresDir = path.join(WORKDIR, 'scores');
  
  // Create scores directory
  if (!fs.existsSync(scoresDir)) {
    fs.mkdirSync(scoresDir, { recursive: true });
  }

  // Initialize the AI-powered code scorer
  const codeScorer = new CodeScorer(EVALUATION_ID, 'gpt-oss:20b');

  for (const result of results) {
    console.log(`  📊 Evaluating ${result.modelName} with AI...`);
    
    try {
      if (!result.response) {
        console.log(`    ⚠️  Skipping ${result.modelName} - no response available`);
        continue;
      }

      // Use the AI-powered code scorer to evaluate the response
      const scoreResponse = await codeScorer.scoreResponse(result.response);
      
      // Calculate total time for this model
      if (result.timing) {
        result.timing.totalTime = (result.timing.responseTime || 0) + 
                                 (result.timing.extractionTime || 0) + 
                                 (result.timing.dockerTime || 0);
      }

      // Create enhanced score with AI evaluation results
      const score = {
        modelName: result.modelName,
        hasResponse: !!result.response,
        hasExtractedCode: !!result.extractedCode,
        codeLength: result.extractedCode?.length || 0,
        dockerBuildSuccess: result.dockerResult?.buildSuccess || false,
        dockerTestSuccess: result.dockerResult?.testSuccess || false,
        output: result.dockerResult?.output || null,
        outputLength: result.dockerResult?.output?.length || 0,
        error: result.dockerResult?.error || null,
        timing: result.timing,
        aiCodeQualityScore: 0,
        aiCodeQualitySummary: '',
        totalScore: 0,
        timestamp: new Date().toISOString()
      };

      // Extract AI evaluation results from scoreResponse
      const aiQualityEval = scoreResponse.evals.find(e => e.key === 'ai_code_quality_score');
      const aiSummaryEval = scoreResponse.evals.find(e => e.key === 'ai_code_quality_summary');
      const totalScoreEval = scoreResponse.evals.find(e => e.key === 'total_score');

      if (aiQualityEval) {
        score.aiCodeQualityScore = parseInt(aiQualityEval.value);
      }
      if (aiSummaryEval) {
        score.aiCodeQualitySummary = aiSummaryEval.value;
      }
      if (totalScoreEval) {
        score.totalScore = parseFloat(totalScoreEval.value);
      }

      result.score = score;
      
      // Save score to file
      const scoreFile = path.join(scoresDir, `${result.modelName.replace(/[^a-zA-Z0-9]/g, '-')}-ollama.json`);
      fs.writeFileSync(scoreFile, JSON.stringify(score, null, 2));
      
      console.log(`    ✅ AI evaluation complete - Quality: ${score.aiCodeQualityScore}/5, Total Score: ${score.totalScore.toFixed(3)}`);
      
    } catch (error) {
      console.error(`    ❌ Error evaluating ${result.modelName}:`, error);
    }
  }
}

/**
 * PASS 5: Generate final report
 */
async function generateFinalReport(results: ModelResult[]) {
  const analysisDir = path.join(WORKDIR, 'analysis');
  
  // Create analysis directory
  if (!fs.existsSync(analysisDir)) {
    fs.mkdirSync(analysisDir, { recursive: true });
  }

  // Generate comprehensive report
  const report = generateComprehensiveReport(results);
  
  // Save report to file
  const reportFile = path.join(analysisDir, 'comprehensive-evaluation-report.md');
  fs.writeFileSync(reportFile, report);
  
  console.log(`  📄 Report saved to: ${reportFile}`);
  console.log('\n' + report);
}

/**
 * Generate comprehensive evaluation report
 */
function generateComprehensiveReport(results: ModelResult[]): string {
  const successfulModels = results.filter(r => r.score?.dockerTestSuccess);
  const failedModels = results.filter(r => !r.score?.dockerTestSuccess);
  
  let report = `# Ollama TypeScript Code Generation Evaluation Report\n\n`;
  report += `**Generated:** ${new Date().toISOString()}\n`;
  report += `**Total Models:** ${results.length}\n`;
  report += `**Successful:** ${successfulModels.length}\n`;
  report += `**Failed:** ${failedModels.length}\n\n`;
  
  report += `## Summary\n\n`;
  report += `- **Models with responses:** ${results.filter(r => r.response).length}/${results.length}\n`;
  report += `- **Models with extracted code:** ${results.filter(r => r.extractedCode).length}/${results.length}\n`;
  report += `- **Models with successful Docker executions:** ${successfulModels.length}/${results.length}\n`;
  report += `- **AI Evaluator Model:** gpt-oss:20b\n`;
  report += `- **Average AI Quality Score:** ${(results.reduce((sum, r) => sum + (r.score?.aiCodeQualityScore || 0), 0) / results.length).toFixed(2)}/5\n`;
  report += `- **Average Total Score:** ${(results.reduce((sum, r) => sum + (r.score?.totalScore || 0), 0) / results.length).toFixed(3)}\n\n`;
  
  report += `## Successful Models\n\n`;
  for (const result of successfulModels) {
      report += `### ${result.modelName}\n`;
  report += `- **Code Length:** ${result.score?.codeLength} characters\n`;
  report += `- **Output Length:** ${result.score?.outputLength} characters\n`;
  report += `- **Output Lines:** ${result.dockerResult?.output?.split('\n').filter(line => line.trim().length > 0).length || 0}\n`;
  report += `- **Unique Items:** ${new Set(result.dockerResult?.output?.split('\n').filter(line => line.trim().length > 0)).size || 0}\n`;
  report += `- **Response Time:** ${result.score?.timing?.responseTime || 0}ms\n`;
  report += `- **Extraction Time:** ${result.score?.timing?.extractionTime || 0}ms\n`;
  report += `- **Docker Time:** ${result.score?.timing?.dockerTime || 0}ms\n`;
  report += `- **Total Time:** ${result.score?.timing?.totalTime || 0}ms\n`;
  report += `- **AI Code Quality:** ${result.score?.aiCodeQualityScore || 0}/5\n`;
  report += `- **AI Summary:** ${result.score?.aiCodeQualitySummary || 'No evaluation'}\n`;
  report += `- **Total Score:** ${result.score?.totalScore || 0}\n`;
  report += `- **Docker Execution:** ✅ Success\n\n`;
  }
  
  report += `## Failed Models\n\n`;
  for (const result of failedModels) {
      report += `### ${result.modelName}\n`;
  report += `- **Has Response:** ${result.response ? '✅' : '❌'}\n`;
  report += `- **Has Extracted Code:** ${result.extractedCode ? '✅' : '❌'}\n`;
  report += `- **Response Time:** ${result.score?.timing?.responseTime || 0}ms\n`;
  report += `- **Extraction Time:** ${result.score?.timing?.extractionTime || 0}ms\n`;
  report += `- **Docker Time:** ${result.score?.timing?.dockerTime || 0}ms\n`;
  report += `- **Total Time:** ${result.score?.timing?.totalTime || 0}ms\n`;
  report += `- **AI Code Quality:** ${result.score?.aiCodeQualityScore || 0}/5\n`;
  report += `- **AI Summary:** ${result.score?.aiCodeQualitySummary || 'No evaluation'}\n`;
  report += `- **Total Score:** ${result.score?.totalScore || 0}\n`;
  report += `- **Docker Execution:** ${result.score?.dockerTestSuccess ? '✅' : '❌'}\n`;
  if (result.score?.error) {
    report += `- **Error:** ${result.score.error}\n`;
  }
  report += `\n`;
  }
  
  return report;
}

/**
 * Print summary
 */
function printSummary(results: ModelResult[], overallStartTime: number) {
  console.log('🎉 Evaluation Pipeline Complete!');
  console.log('='.repeat(60));
  
  const successful = results.filter(r => r.score?.dockerTestSuccess).length;
  const failed = results.filter(r => !r.score?.dockerTestSuccess).length;
  
  console.log('📊 Final Summary:');
  console.log(`   - Total models tested: ${results.length}`);
  console.log(`   - Successful Docker tests: ${successful}`);
  console.log(`   - Failed Docker tests: ${failed}`);
  console.log(`   - Success rate: ${((successful / results.length) * 100).toFixed(1)}%`);
  
  console.log('\n📁 Results Location:');
  console.log(`   - Responses: ${path.join(WORKDIR, 'responses')}`);
  console.log(`   - Extracted Code: ${path.join(WORKDIR, 'extracted-code')}`);
  console.log(`   - Scores: ${path.join(WORKDIR, 'scores')}`);
  console.log(`   - Analysis: ${path.join(WORKDIR, 'analysis')}`);
  
  if (successful > 0) {
    console.log('\n🏆 Top Performers (by Total Score):');
    const topPerformers = results
      .filter(r => r.score?.totalScore)
      .sort((a, b) => (b.score?.totalScore || 0) - (a.score?.totalScore || 0))
      .slice(0, 3);
    
    topPerformers.forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.modelName}: Score ${result.score?.totalScore?.toFixed(3)}, AI Quality ${result.score?.aiCodeQualityScore}/5, ${result.score?.outputLength || 0} chars output`);
    });
  }
  
  // Show timing summary
  const totalTime = Date.now() - overallStartTime;
  console.log(`\n⏱️  Total Evaluation Time: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);
  
  const avgResponseTime = results
    .filter(r => r.score?.timing?.responseTime)
    .reduce((sum, r) => sum + (r.score?.timing?.responseTime || 0), 0) / results.filter(r => r.score?.timing?.responseTime).length;
  
  const avgDockerTime = results
    .filter(r => r.score?.timing?.dockerTime)
    .reduce((sum, r) => sum + (r.score?.timing?.dockerTime || 0), 0) / results.filter(r => r.score?.timing?.dockerTime).length;
  
  console.log(`📊 Average Response Time: ${avgResponseTime.toFixed(0)}ms`);
  console.log(`📊 Average Docker Time: ${avgDockerTime.toFixed(0)}ms`);
}

// Run the main function
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
