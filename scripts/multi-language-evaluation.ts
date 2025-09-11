#!/usr/bin/env tsx

/**
 * Multi-Language Evaluation Pipeline
 * 
 * This script performs a complete evaluation of Ollama models across multiple programming languages:
 * PASS 1: Generate responses from all models for each language
 * PASS 2: Extract code from responses for each language
 * PASS 3: Build and run Docker containers for each extracted code
 * PASS 4: Evaluate results and generate scores
 * PASS 5: Combine everything into final cross-language report
 */

import fs from 'fs';
import path from 'path';
import { FunctionEvaluationRunner } from '../src/evaluation/evaluate.js';
import { Interaction } from '../src/interaction/interaction.js';
import { Stimulus } from '../src/stimulus/stimulus.js';
import { extractAllCodeBlocks, getCodeForLanguage, fixCommonCodeErrors, ensureConsoleOutput } from '../src/evaluation/code-extractor.js';
import { DockerRunner } from '../src/evaluation/docker-runner.js';
import { CodeScorer } from '../src/evaluation/code-scorer.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration
const OLLAMA_MODELS = [
  { name: 'gpt-oss:20b', provider: 'ollama' },
  { name: 'gemma3:12b', provider: 'ollama' },
  { name: 'gemma3:27b', provider: 'ollama' },
  { name: 'deepseek-r1:32b', provider: 'ollama' },
  { name: 'devstral:24b', provider: 'ollama' },
  { name: 'mistral-small3.2:24b', provider: 'ollama' },
  { name: 'llama3.2:latest', provider: 'ollama' },
  { name: 'qwen3-coder:latest', provider: 'ollama' },
  { name: 'codestral:latest', provider: 'ollama' },
  { name: 'phi4:latest', provider: 'ollama' },
  { name: 'phi4-mini:latest', provider: 'ollama' }
] as const;

const LANGUAGES = [
  { 
    name: 'typescript', 
    prompt: 'i need a script that will give me at least 1042 distinct but made up show names. they should be funny and grammatically correct and written in typescript' 
  },
  { 
    name: 'python', 
    prompt: 'i need a script that will give me at least 1042 distinct but made up show names. they should be funny and grammatically correct and written in python' 
  },
  { 
    name: 'ruby', 
    prompt: 'i need a script that will give me at least 1042 distinct but made up show names. they should be funny and grammatically correct and written in ruby' 
  },
  { 
    name: 'perl', 
    prompt: 'i need a script that will give me at least 1042 distinct but made up show names. they should be funny and grammatically correct and written in perl' 
  },
  { 
    name: 'bash', 
    prompt: 'i need a script that will give me at least 1042 distinct but made up show names. they should be funny and grammatically correct and written in bash' 
  },
  { 
    name: 'javascript', 
    prompt: 'i need a script that will give me at least 1042 distinct but made up show names. they should be funny and grammatically correct and written in javascript' 
  },
  {
    name: 'go',
    prompt: 'i need a script that will give me at least 1042 distinct but made up show names. they should be funny and grammatically correct and written in go'
  },
  {
    name: 'rust',
    prompt: 'i need a script that will give me at least 1042 distinct but made up show names. they should be funny and grammatically correct and written in rust'
  },
  {
    name: 'swift',
    prompt: 'i need a script that will give me at least 1042 distinct but made up show names. they should be funny and grammatically correct and written in swift'
  }
] as const;

const EVALUATION_ID = 'multi-language-eval';
const WORKDIR = path.join(process.cwd(), 'output/evaluations', EVALUATION_ID);

interface ModelResult {
  modelName: string;
  language: string;
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

interface LanguageResult {
  language: string;
  modelResults: ModelResult[];
}

async function main() {
  const overallStartTime = Date.now();
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const targetLanguage = args[0]?.toLowerCase();
  
  // Filter languages if a specific language is requested
  const languagesToEvaluate = targetLanguage 
    ? LANGUAGES.filter(lang => lang.name === targetLanguage)
    : LANGUAGES;
  
  if (targetLanguage && languagesToEvaluate.length === 0) {
    console.error(`❌ Language '${targetLanguage}' not found. Available languages:`);
    console.error(`   ${LANGUAGES.map(l => l.name).join(', ')}`);
    process.exit(1);
  }
  
  console.log('🚀 Starting Multi-Language Evaluation Pipeline');
  console.log('='.repeat(60));
  console.log(`🤖 Models: ${OLLAMA_MODELS.length} Ollama models`);
  console.log(`🌐 Languages: ${languagesToEvaluate.length} programming languages${targetLanguage ? ` (${targetLanguage} only)` : ''}`);
  console.log(`📁 Workdir: ${WORKDIR}`);
  console.log();

  const results: LanguageResult[] = [];

  // For each language, run the full evaluation pipeline
  for (const languageConfig of languagesToEvaluate) {
    console.log(`\n🌐 Evaluating ${languageConfig.name.toUpperCase()}...`);
    console.log('='.repeat(40));
    
    const languageResults: ModelResult[] = OLLAMA_MODELS.map(model => ({ 
      modelName: model.name,
      language: languageConfig.name,
      timing: {}
    }));

    // PASS 1: Generate responses for this language
    console.log(`📤 PASS 1: Generating ${languageConfig.name} responses...`);
    await generateModelResponses(languageResults, languageConfig.prompt, languageConfig.name);
    console.log(`✅ Generated responses for ${languageResults.filter(r => r.response).length} models`);
    
    // PASS 2: Extract code for this language
    console.log(`🔧 PASS 2: Extracting ${languageConfig.name} code...`);
    await extractCodeFromResponses(languageResults, languageConfig.name);
    console.log(`✅ Extracted code for ${languageResults.filter(r => r.extractedCode).length} models`);
    
    // PASS 3: Run code in Docker for this language
    console.log(`🐳 PASS 3: Running ${languageConfig.name} code in Docker...`);
    await runCodeInDockerContainers(languageResults, languageConfig.name);
    console.log(`✅ Docker executions completed for ${languageResults.filter(r => r.dockerResult).length} models`);
    
    // PASS 4: Evaluate results for this language
    console.log(`📊 PASS 4: Evaluating ${languageConfig.name} results...`);
    await evaluateResults(languageResults, languageConfig.name);
    console.log(`✅ Evaluated ${languageResults.filter(r => r.score).length} models`);
    
    // PASS 5: Generate language-specific analysis report immediately
    console.log(`📋 PASS 5: Generating ${languageConfig.name} analysis report...`);
    await generateLanguageAnalysisReport(languageResults, languageConfig.name);
    console.log(`✅ ${languageConfig.name} analysis report generated`);
    
    results.push({
      language: languageConfig.name,
      modelResults: languageResults
    });
  }

  // PASS 6: Generate comprehensive cross-language report
  console.log('\n📋 PASS 6: Generating comprehensive cross-language report...');
  await generateCrossLanguageComparisonReport(results);
  console.log('✅ Cross-language comparison report generated');
  console.log();

  // Print summary
  printCrossLanguageSummary(results, overallStartTime);
}

/**
 * PASS 1: Generate responses from all models for a specific language
 */
async function generateModelResponses(results: ModelResult[], prompt: string, language: string) {
  
  for (const result of results) {
    console.log(`  🤖 Testing ${result.modelName}...`);
    
    try {
      const startTime = Date.now();
      
      // Create evaluation runner with function to generate response
      const runner = new FunctionEvaluationRunner(EVALUATION_ID, `${language}/responses`, async (details) => {
        const programmingStimulus = new Stimulus({
          role: "helpful programming assistant",
          objective: "generate code solutions",
          runnerType: 'base'
        });
        const interaction = new Interaction(details, programmingStimulus);
        interaction.addMessage({ role: 'user', content: prompt });
        
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
 * PASS 2: Extract code from responses for a specific language
 */
async function extractCodeFromResponses(results: ModelResult[], language: string) {
  const extractedDir = path.join(WORKDIR, language, 'extracted-code');
  
  // Create extracted code directory
  if (!fs.existsSync(extractedDir)) {
    fs.mkdirSync(extractedDir, { recursive: true });
  }

  for (const result of results) {
    if (!result.response) {
      console.log(`  ⚠️  Skipping ${result.modelName} - no response available`);
      continue;
    }

    console.log(`  🔧 Extracting ${language} code from ${result.modelName}...`);
    
    try {
      const startTime = Date.now();
      const content = result.response.content;
      
      // Extract all code blocks and find the target language
      const extracted = extractAllCodeBlocks(content);
      let extractedCode = getCodeForLanguage(extracted, language);
      
      if (extractedCode) {
        // Fix common errors and ensure console output
        extractedCode = fixCommonCodeErrors(extractedCode, language);
        extractedCode = ensureConsoleOutput(extractedCode, language);
        result.extractedCode = extractedCode;
        
        // Save extracted code to file
        const codeFile = path.join(extractedDir, `${result.modelName.replace(/[^a-zA-Z0-9]/g, '-')}.${getFileExtension(language)}`);
        fs.writeFileSync(codeFile, extractedCode);
        
        result.timing!.extractionTime = Date.now() - startTime;
        console.log(`    ✅ Code extracted (${extractedCode.length} chars) in ${result.timing!.extractionTime}ms`);
      } else {
        console.log(`    ❌ No ${language} code found in response. Available: ${extracted.blocks.map(b => b.language).join(', ')}`);
      }
      
    } catch (error) {
      console.error(`    ❌ Error extracting code from ${result.modelName}:`, error);
    }
  }
}

/**
 * Clean up any hanging Docker containers
 */
async function cleanupDockerContainers() {
  try {
    // Stop any running containers
    await execAsync('docker ps -q | xargs -r docker stop');
    // Remove any stopped containers
    await execAsync('docker ps -aq | xargs -r docker rm');
    console.log('  🧹 Cleaned up Docker containers');
  } catch (error) {
    console.log('  ⚠️  Docker cleanup failed (this is normal if no containers were running)');
  }
}

/**
 * PASS 3: Run code in Docker containers for a specific language
 */
async function runCodeInDockerContainers(results: ModelResult[], language: string) {
  // Clean up any hanging containers before starting
  await cleanupDockerContainers();
  
  // For bash scripts, use a very short timeout to prevent hanging
  const timeout = language === 'bash' ? 5 : 30;
  
  for (const result of results) {
    if (!result.extractedCode) {
      console.log(`  ⚠️  Skipping ${result.modelName} - no code extracted`);
      continue;
    }

    console.log(`  🐳 Running ${result.modelName} ${language} code in Docker...`);
    
    try {
      const startTime = Date.now();
      
      // Run code in Docker container
      const dockerResult = await DockerRunner.runCode({
        code: result.extractedCode,
        language: language,
        timeout: timeout,
        modelName: result.modelName
      });
      
      result.dockerResult = {
        modelName: result.modelName,
        language: language,
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
        // Limit error output to first 20 lines for console display
        const errorMessage = dockerResult.error || 'Unknown error';
        const errorLines = errorMessage.split('\n');
        const limitedError = errorLines.length > 20 
          ? errorLines.slice(0, 20).join('\n') + `\n... (${errorLines.length - 20} more lines)`
          : errorMessage;
        console.log(`    ❌ Docker execution failed: ${limitedError} (${result.timing!.dockerTime}ms)`);
      }
      
    } catch (error) {
      console.error(`    ❌ Error running Docker for ${result.modelName}:`, error);
      // Clean up after errors
      await cleanupDockerContainers();
    }
  }
  
  // Final cleanup after all executions
  await cleanupDockerContainers();
}

/**
 * PASS 4: Evaluate results and generate scores for a specific language
 */
async function evaluateResults(results: ModelResult[], language: string) {
  const scoresDir = path.join(WORKDIR, language, 'scores');
  
  // Create scores directory
  if (!fs.existsSync(scoresDir)) {
    fs.mkdirSync(scoresDir, { recursive: true });
  }

  // Initialize the AI-powered code scorer
  // Pass a custom analysis directory to disable automatic analysis saving
  const codeScorer = new CodeScorer(EVALUATION_ID, 'gpt-oss:20b', 'disabled');

  for (const result of results) {
    console.log(`  📊 Evaluating ${result.modelName} ${language} code with AI...`);
    
    try {
      if (!result.response) {
        console.log(`    ⚠️  Skipping ${result.modelName} - no response available`);
        continue;
      }

      // Check if score file already exists
      const scoreFile = path.join(scoresDir, `${result.modelName.replace(/[^a-zA-Z0-9]/g, '-')}-${language}.json`);
      if (fs.existsSync(scoreFile)) {
        console.log(`    📁 Loading existing score for ${result.modelName}...`);
        const existingScore = JSON.parse(fs.readFileSync(scoreFile, 'utf8'));
        result.score = existingScore;
        console.log(`    ✅ Loaded existing score - Quality: ${existingScore.aiCodeQualityScore}/5, Total Score: ${existingScore.totalScore?.toFixed(3)}`);
        continue;
      }

      // Use the AI-powered code scorer to evaluate the response
      // Note: We disable the CodeScorer's automatic analysis saving since we handle it manually
      const scoreResponse = await codeScorer.scoreResponse(result.response, language);
      
      // Calculate total time for this model
      if (result.timing) {
        result.timing.totalTime = (result.timing.responseTime || 0) + 
                                 (result.timing.extractionTime || 0) + 
                                 (result.timing.dockerTime || 0);
      }

      // Create enhanced score with AI evaluation results
      const score = {
        modelName: result.modelName,
        language: language,
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
      const scoreFilePath = path.join(scoresDir, `${result.modelName.replace(/[^a-zA-Z0-9]/g, '-')}-${language}.json`);
      fs.writeFileSync(scoreFilePath, JSON.stringify(score, null, 2));
      
      console.log(`    ✅ AI evaluation complete - Quality: ${score.aiCodeQualityScore}/5, Total Score: ${score.totalScore.toFixed(3)}`);
      
    } catch (error) {
      console.error(`    ❌ Error evaluating ${result.modelName}:`, error);
    }
  }
}

/**
 * PASS 5: Generate language-specific analysis report for a single language
 */
async function generateLanguageAnalysisReport(modelResults: ModelResult[], language: string) {
  const languageAnalysisDir = path.join(WORKDIR, language, 'analysis');
  
  // Create language-specific analysis directory
  if (!fs.existsSync(languageAnalysisDir)) {
    fs.mkdirSync(languageAnalysisDir, { recursive: true });
  }

  // Create language result structure for the report function
  const languageResult: LanguageResult = {
    language: language,
    modelResults: modelResults
  };

  // Generate language-specific report
  const report = generateLanguageSpecificReport(languageResult);
  
  // Save report to language-specific directory
  const reportFile = path.join(languageAnalysisDir, `${language}-evaluation-report.md`);
  fs.writeFileSync(reportFile, report);
  
  console.log(`  📄 ${language} report saved to: ${reportFile}`);
}

/**
 * PASS 5: Generate language-specific analysis reports
 */
async function generateLanguageAnalysisReports(results: LanguageResult[]) {
  console.log(`📊 PASS 5: Generating language-specific analysis reports...`);
  
  for (const languageResult of results) {
    const language = languageResult.language;
    const languageAnalysisDir = path.join(WORKDIR, language, 'analysis');
    
    // Create language-specific analysis directory
    if (!fs.existsSync(languageAnalysisDir)) {
      fs.mkdirSync(languageAnalysisDir, { recursive: true });
    }

    // Generate language-specific report
    const report = generateLanguageSpecificReport(languageResult);
    
    // Save report to language-specific directory
    const reportFile = path.join(languageAnalysisDir, `${language}-evaluation-report.md`);
    fs.writeFileSync(reportFile, report);
    
    console.log(`  📄 ${language} report saved to: ${reportFile}`);
  }
}

/**
 * PASS 6: Generate comprehensive cross-language comparison report
 */
async function generateCrossLanguageComparisonReport(results: LanguageResult[]) {
  const crossAnalysisDir = path.join(WORKDIR, 'cross-language-analysis');
  
  // Create cross-language analysis directory
  if (!fs.existsSync(crossAnalysisDir)) {
    fs.mkdirSync(crossAnalysisDir, { recursive: true });
  }

  // Generate comprehensive cross-language report
  const report = generateComprehensiveCrossLanguageReport(results);
  
  // Save report to file
  const reportFile = path.join(crossAnalysisDir, 'cross-language-evaluation-report.md');
  fs.writeFileSync(reportFile, report);
  
  console.log(`  📄 Cross-language report saved to: ${reportFile}`);
  console.log('\n' + report);
}

/**
 * Generate language-specific evaluation report
 */
function generateLanguageSpecificReport(languageResult: LanguageResult): string {
  const language = languageResult.language;
  let report = `# ${language.toUpperCase()} Code Generation Evaluation Report\n\n`;
  report += `**Generated:** ${new Date().toISOString()}\n`;
  report += `**Language:** ${language}\n`;
  report += `**Total Models:** ${languageResult.modelResults.length}\n\n`;
  
  const successfulModels = languageResult.modelResults.filter(r => r.score?.dockerTestSuccess);
  const failedModels = languageResult.modelResults.filter(r => !r.score?.dockerTestSuccess);
  
  report += `## Summary\n\n`;
  report += `**Success Rate:** ${successfulModels.length}/${languageResult.modelResults.length} (${((successfulModels.length / languageResult.modelResults.length) * 100).toFixed(1)}%)\n\n`;
  
  if (successfulModels.length > 0) {
    report += `### Successful Models\n\n`;
    for (const result of successfulModels) {
      report += `#### ${result.modelName}\n`;
      report += `- **Code Length:** ${result.score?.codeLength} characters\n`;
      report += `- **AI Quality Score:** ${result.score?.aiCodeQualityScore}/5\n`;
      report += `- **AI Summary:** ${result.score?.aiCodeQualitySummary || 'No AI evaluation'}\n`;
      report += `- **Total Score:** ${result.score?.totalScore?.toFixed(3)}\n`;
      report += `- **Response Time:** ${result.score?.timing?.responseTime}ms\n`;
      report += `- **Docker Output:** ${result.score?.outputLength} characters\n\n`;
    }
  }
  
  if (failedModels.length > 0) {
    report += `### Failed Models\n\n`;
    for (const result of failedModels) {
      report += `#### ${result.modelName}\n`;
      if (!result.response) {
        report += `- **Error:** No response generated\n\n`;
      } else if (!result.extractedCode) {
        report += `- **Error:** No ${language} code extracted\n\n`;
      } else if (result.score?.error) {
        // Limit error output to first 20 lines
        const errorLines = result.score.error.split('\n');
        const limitedError = errorLines.length > 20 
          ? errorLines.slice(0, 20).join('\n') + `\n... (${errorLines.length - 20} more lines)`
          : result.score.error;
        report += `- **Error:** ${limitedError}\n\n`;
      } else if (result.score?.aiCodeQualitySummary) {
        report += `- **AI Summary:** ${result.score.aiCodeQualitySummary}\n\n`;
      }
    }
  }
  
  return report;
}

/**
 * Generate comprehensive cross-language evaluation report
 */
function generateComprehensiveCrossLanguageReport(results: LanguageResult[]): string {
  let report = `# Multi-Language Code Generation Evaluation Report\n\n`;
  report += `**Generated:** ${new Date().toISOString()}\n`;
  report += `**Total Models:** ${OLLAMA_MODELS.length}\n`;
  report += `**Total Languages:** ${LANGUAGES.length}\n`;
  report += `**Total Evaluations:** ${OLLAMA_MODELS.length * LANGUAGES.length}\n\n`;
  
  // Language comparison table
  report += `## Language Performance Summary\n\n`;
  report += `| Language | Success Rate | Avg Score | Best Model | Avg Response Time |\n`;
  report += `|----------|-------------|-----------|------------|-------------------|\n`;
  
  for (const languageResult of results) {
    const successfulModels = languageResult.modelResults.filter(r => r.score?.dockerTestSuccess);
    const successRate = (successfulModels.length / languageResult.modelResults.length) * 100;
    const avgScore = languageResult.modelResults.reduce((sum, r) => sum + (r.score?.totalScore || 0), 0) / languageResult.modelResults.length;
    const avgResponseTime = languageResult.modelResults.reduce((sum, r) => sum + (r.score?.timing?.responseTime || 0), 0) / languageResult.modelResults.length;
    
    const bestModel = languageResult.modelResults
      .filter(r => r.score?.totalScore)
      .sort((a, b) => (b.score?.totalScore || 0) - (a.score?.totalScore || 0))[0];
    
    report += `| ${languageResult.language} | ${successRate.toFixed(1)}% | ${avgScore.toFixed(3)} | ${bestModel?.modelName || 'N/A'} | ${avgResponseTime.toFixed(0)}ms |\n`;
  }
  
  // Model comparison table
  report += `\n## Model Performance Summary\n\n`;
  report += `| Model | Avg Success Rate | Avg Score | Best Language | Avg Response Time |\n`;
  report += `|-------|-----------------|-----------|---------------|-------------------|\n`;
  
  for (const model of OLLAMA_MODELS) {
    const modelResults = results.flatMap(lr => lr.modelResults.filter(r => r.modelName === model.name));
    const successfulResults = modelResults.filter(r => r.score?.dockerTestSuccess);
    const avgSuccessRate = (successfulResults.length / modelResults.length) * 100;
    const avgScore = modelResults.reduce((sum, r) => sum + (r.score?.totalScore || 0), 0) / modelResults.length;
    const avgResponseTime = modelResults.reduce((sum, r) => sum + (r.score?.timing?.responseTime || 0), 0) / modelResults.length;
    
    const bestLanguage = modelResults
      .filter(r => r.score?.totalScore)
      .sort((a, b) => (b.score?.totalScore || 0) - (a.score?.totalScore || 0))[0];
    
    report += `| ${model.name} | ${avgSuccessRate.toFixed(1)}% | ${avgScore.toFixed(3)} | ${bestLanguage?.language || 'N/A'} | ${avgResponseTime.toFixed(0)}ms |\n`;
  }
  
  // Detailed breakdown by language
  for (const languageResult of results) {
    report += `\n## ${languageResult.language.toUpperCase()} Results\n\n`;
    
    const successfulModels = languageResult.modelResults.filter(r => r.score?.dockerTestSuccess);
    const failedModels = languageResult.modelResults.filter(r => !r.score?.dockerTestSuccess);
    
    report += `**Success Rate:** ${successfulModels.length}/${languageResult.modelResults.length} (${((successfulModels.length / languageResult.modelResults.length) * 100).toFixed(1)}%)\n\n`;
    
    if (successfulModels.length > 0) {
      report += `### Successful Models\n\n`;
      for (const result of successfulModels) {
        report += `#### ${result.modelName}\n`;
        report += `- **Code Length:** ${result.score?.codeLength} characters\n`;
        report += `- **Output Length:** ${result.score?.outputLength} characters\n`;
        report += `- **Response Time:** ${result.score?.timing?.responseTime || 0}ms\n`;
        report += `- **AI Code Quality:** ${result.score?.aiCodeQualityScore || 0}/5\n`;
        report += `- **AI Summary:** ${result.score?.aiCodeQualitySummary || 'No AI evaluation'}\n`;
        report += `- **Total Score:** ${result.score?.totalScore || 0}\n\n`;
      }
    }
    
    if (failedModels.length > 0) {
      report += `### Failed Models\n\n`;
      for (const result of failedModels) {
        report += `#### ${result.modelName}\n`;
        report += `- **Has Response:** ${result.response ? '✅' : '❌'}\n`;
        report += `- **Has Extracted Code:** ${result.extractedCode ? '✅' : '❌'}\n`;
        report += `- **Response Time:** ${result.score?.timing?.responseTime || 0}ms\n`;
        report += `- **AI Code Quality:** ${result.score?.aiCodeQualityScore || 0}/5\n`;
        report += `- **AI Summary:** ${result.score?.aiCodeQualitySummary || 'No AI evaluation'}\n`;
        report += `- **Total Score:** ${result.score?.totalScore || 0}\n`;
        if (result.score?.error) {
          // Limit error output to first 20 lines
          const errorLines = result.score.error.split('\n');
          const limitedError = errorLines.length > 20 
            ? errorLines.slice(0, 20).join('\n') + `\n... (${errorLines.length - 20} more lines)`
            : result.score.error;
          report += `- **Error:** ${limitedError}\n`;
        }
        report += `\n`;
      }
    }
  }
  
  return report;
}

/**
 * Get file extension for a language
 */
function getFileExtension(language: string): string {
  const extensions: Record<string, string> = {
    typescript: 'ts',
    javascript: 'js',
    python: 'py',
    ruby: 'rb',
    perl: 'pl',
    bash: 'sh',
    php: 'php',
    java: 'java',
    rust: 'rs',
    go: 'go',
    swift: 'swift'
  };
  return extensions[language] || 'txt';
}

/**
 * Print cross-language summary
 */
function printCrossLanguageSummary(results: LanguageResult[], overallStartTime: number) {
  console.log('🎉 Multi-Language Evaluation Pipeline Complete!');
  console.log('='.repeat(60));
  
  const totalEvaluations = results.reduce((sum, lr) => sum + lr.modelResults.length, 0);
  const totalSuccessful = results.reduce((sum, lr) => sum + lr.modelResults.filter(r => r.score?.dockerTestSuccess).length, 0);
  
  console.log('📊 Final Summary:');
  console.log(`   - Total evaluations: ${totalEvaluations}`);
  console.log(`   - Successful Docker tests: ${totalSuccessful}`);
  console.log(`   - Failed Docker tests: ${totalEvaluations - totalSuccessful}`);
  console.log(`   - Overall success rate: ${((totalSuccessful / totalEvaluations) * 100).toFixed(1)}%`);
  
  console.log('\n📁 Results Location:');
  console.log(`   - Responses: ${path.join(WORKDIR, 'responses')}`);
  console.log(`   - Extracted Code: ${path.join(WORKDIR, 'extracted-code')}`);
  console.log(`   - Scores: ${path.join(WORKDIR, 'scores')}`);
  console.log(`   - Analysis: ${path.join(WORKDIR, 'analysis')}`);
  
  // Show top performers by language
  console.log('\n🏆 Top Performers by Language:');
  for (const languageResult of results) {
    const topPerformer = languageResult.modelResults
      .filter(r => r.score?.totalScore)
      .sort((a, b) => (b.score?.totalScore || 0) - (a.score?.totalScore || 0))[0];
    
    if (topPerformer) {
      console.log(`   ${languageResult.language}: ${topPerformer.modelName} (Score: ${topPerformer.score?.totalScore?.toFixed(3)})`);
    }
  }
  
  // Show timing summary
  const totalTime = Date.now() - overallStartTime;
  console.log(`\n⏱️  Total Evaluation Time: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);
}

// Run the main function
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
