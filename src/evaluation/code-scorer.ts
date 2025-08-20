import { EvaluationScorer } from './scorer.js';
import { ModelResponse, ScoreResponse } from '../cognition/types.js';
import { extractTypeScriptCode } from './typescript-code-extractor.js';
import { DockerRunner } from './docker-runner.js';
import { BaseModelRunner } from '../cognition/runner.js';
import { Interaction } from '../interaction/interaction.js';
import fs from 'fs';
import path from 'path';

export interface CodeEvaluationResult {
  modelName: string;
  generationTimeMs: number;
  codeExtractionSuccess: boolean;
  codeLength: number;
  dockerBuildSuccess: boolean;
  dockerExecutionSuccess: boolean;
  aiCodeQualityScore: number; // 1-5 rating from AI
  aiCodeQualitySummary: string; // One sentence summary from AI
  totalScore: number; // 0-1 overall score
  errors: string[];
  output?: string;
  aiEvaluationResponse?: string;
}

export class CodeScorer extends EvaluationScorer {
  private evaluationDir: string;
  private aiEvaluatorModel: string;

  constructor(evaluationId: string, aiEvaluatorModel: string = 'gpt-oss:20b') {
    super(evaluationId);
    this.evaluationDir = path.join(process.cwd(), 'output', 'evaluations', evaluationId);
    this.aiEvaluatorModel = aiEvaluatorModel;
  }

  /**
   * Scores a code generation response using AI evaluation
   */
  async scoreResponse(response: ModelResponse): Promise<ScoreResponse> {
    const modelName = response.metadata.model;
    const result: CodeEvaluationResult = {
      modelName,
      generationTimeMs: 0,
      codeExtractionSuccess: false,
      codeLength: 0,
      dockerBuildSuccess: false,
      dockerExecutionSuccess: false,
      aiCodeQualityScore: 0,
      aiCodeQualitySummary: '',
      totalScore: 0,
      errors: []
    };

    try {
      // 1. Calculate generation time
      const startTime = new Date(response.metadata.startTime);
      const endTime = new Date(response.metadata.endTime);
      result.generationTimeMs = endTime.getTime() - startTime.getTime();

      // 2. Extract code (supports TypeScript, but can be extended)
      const extractedCode = extractTypeScriptCode(response.content);
      if (!extractedCode) {
        result.errors.push('No code found in response');
        return this.createScoreResponse(result);
      }

      result.codeExtractionSuccess = true;
      result.codeLength = extractedCode.length;

      // 3. Run code in Docker container to test functionality
      const dockerResult = await DockerRunner.runCode({
        code: extractedCode,
        language: 'typescript',
        timeout: 30,
        modelName: result.modelName
      });
      
      result.dockerBuildSuccess = dockerResult.success;
      result.dockerExecutionSuccess = dockerResult.success;
      result.output = dockerResult.output;

      if (!dockerResult.success) {
        result.errors.push(`Docker execution failed: ${dockerResult.error}`);
      }

      // 4. Use AI to evaluate code quality
      const aiEvaluation = await this.evaluateCodeWithAI(extractedCode, result.modelName);
      result.aiCodeQualityScore = aiEvaluation.score;
      result.aiCodeQualitySummary = aiEvaluation.summary;
      result.aiEvaluationResponse = aiEvaluation.fullResponse;

      // 5. Calculate total score
      result.totalScore = this.calculateTotalScore(result);

      // 6. Save detailed analysis
      await this.saveDetailedAnalysis(result, extractedCode);

    } catch (error) {
      result.errors.push(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    }

    return this.createScoreResponse(result);
  }

  /**
   * Uses AI to evaluate code quality
   */
  private async evaluateCodeWithAI(code: string, originalModelName: string): Promise<{
    score: number;
    summary: string;
    fullResponse: string;
  }> {
    const prompt = `Please evaluate this code on how clean it is and return a one sentence summary and a rating from 1 to 5 where 5 is best.

Code to evaluate:
\`\`\`typescript
${code}
\`\`\`

Please respond in this exact format:
Summary: [one sentence summary]
Rating: [number 1-5]

Example:
Summary: This code is well-structured with clear variable names and good separation of concerns.
Rating: 4`;

    try {
      const modelRunner = new BaseModelRunner();
      const interaction = new Interaction(
        { name: this.aiEvaluatorModel, provider: 'ollama' },
        'You are a code quality expert. Evaluate code based on cleanliness, readability, structure, and best practices.'
      );
      interaction.addMessage({ role: 'user', content: prompt });
      
      const aiResponse = await modelRunner.streamText(interaction);
      const responseContent = aiResponse.content;

      // Parse the AI response to extract score and summary
      const parsed = this.parseAIResponse(responseContent);
      
      return {
        score: parsed.score,
        summary: parsed.summary,
        fullResponse: responseContent
      };

    } catch (error) {
      console.warn(`AI evaluation failed for ${originalModelName}:`, error);
      return {
        score: 1, // Default low score if AI evaluation fails
        summary: 'AI evaluation failed',
        fullResponse: 'Error: Could not evaluate code quality'
      };
    }
  }

  /**
   * Parses AI response to extract score and summary
   */
  private parseAIResponse(response: string): { score: number; summary: string } {
    let score = 1; // Default score
    let summary = 'Unable to parse AI evaluation';

    try {
      // Look for "Rating: X" pattern
      const ratingMatch = response.match(/Rating:\s*(\d+)/i);
      if (ratingMatch) {
        const parsedScore = parseInt(ratingMatch[1]);
        if (parsedScore >= 1 && parsedScore <= 5) {
          score = parsedScore;
        }
      }

      // Look for "Summary: ..." pattern
      const summaryMatch = response.match(/Summary:\s*(.+?)(?:\n|$)/i);
      if (summaryMatch) {
        summary = summaryMatch[1].trim();
      } else {
        // Fallback: try to extract a sentence from the response
        const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 10);
        if (sentences.length > 0) {
          summary = sentences[0].trim();
        }
      }
    } catch (error) {
      console.warn('Failed to parse AI response:', error);
    }

    return { score, summary };
  }

  /**
   * Calculates overall score based on all criteria
   */
  private calculateTotalScore(result: CodeEvaluationResult): number {
    let score = 0;
    const weights = {
      generationTime: 0.1,      // 10% - faster is better
      codeExtraction: 0.15,     // 15% - must extract code
      dockerBuild: 0.2,         // 20% - must build successfully
      dockerExecution: 0.2,     // 20% - must execute successfully
      aiCodeQuality: 0.35       // 35% - AI evaluation of code quality
    };

    // Generation time score (inverse - faster is better)
    const timeScore = Math.max(0, 1 - (result.generationTimeMs / 30000)); // 30s baseline
    score += timeScore * weights.generationTime;

    // Code extraction score
    score += (result.codeExtractionSuccess ? 1 : 0) * weights.codeExtraction;

    // Docker build score
    score += (result.dockerBuildSuccess ? 1 : 0) * weights.dockerBuild;

    // Docker execution score
    score += (result.dockerExecutionSuccess ? 1 : 0) * weights.dockerExecution;

    // AI code quality score (normalize 1-5 to 0-1)
    const aiQualityScore = (result.aiCodeQualityScore - 1) / 4; // Convert 1-5 to 0-1
    score += aiQualityScore * weights.aiCodeQuality;

    return Math.min(score, 1.0);
  }

  /**
   * Creates a ScoreResponse from the evaluation result
   */
  private createScoreResponse(result: CodeEvaluationResult): ScoreResponse {
    const evals = [
      {
        key: 'generation_time_ms',
        value: result.generationTimeMs.toString(),
        score: Math.max(0, 1 - (result.generationTimeMs / 30000))
      },
      {
        key: 'code_extraction_success',
        value: String(result.codeExtractionSuccess || false),
        score: result.codeExtractionSuccess ? 1 : 0
      },
      {
        key: 'code_length',
        value: String(result.codeLength || 0),
        score: (result.codeLength || 0) > 500 ? 1 : 0
      },
      {
        key: 'docker_build_success',
        value: String(result.dockerBuildSuccess || false),
        score: result.dockerBuildSuccess ? 1 : 0
      },
      {
        key: 'docker_execution_success',
        value: String(result.dockerExecutionSuccess || false),
        score: result.dockerExecutionSuccess ? 1 : 0
      },
      {
        key: 'ai_code_quality_score',
        value: result.aiCodeQualityScore.toString(),
        score: (result.aiCodeQualityScore - 1) / 4 // Convert 1-5 to 0-1
      },
      {
        key: 'ai_code_quality_summary',
        value: result.aiCodeQualitySummary,
        score: (result.aiCodeQualityScore - 1) / 4 // Same as score
      },
      {
        key: 'total_score',
        value: result.totalScore.toFixed(3),
        score: result.totalScore
      }
    ];

    // Add error information if any
    if (result.errors && result.errors.length > 0) {
      evals.push({
        key: 'errors',
        value: result.errors.join('; '),
        score: 0
      });
    }

    return {
      evals,
      metadata: {
        startTime: new Date(),
        endTime: new Date(),
        tokenUsage: { promptTokens: 0, completionTokens: 0 },
        provider: 'evaluation',
        model: result.modelName,
        cost: { promptCost: 0, completionCost: 0, totalCost: 0, usage: { promptTokens: 0, completionTokens: 0 } }
      }
    };
  }

  /**
   * Saves detailed analysis to files
   */
  private async saveDetailedAnalysis(result: CodeEvaluationResult, code: string): Promise<void> {
    // Save AI evaluation details
    const analysisDir = path.join(this.evaluationDir, 'analysis', 'ai-evaluations');
    if (!fs.existsSync(analysisDir)) {
      fs.mkdirSync(analysisDir, { recursive: true });
    }
    
    const analysisFile = path.join(analysisDir, `${result.modelName.replace(/[^a-zA-Z0-9]/g, '-')}-ai-evaluation.json`);
    const analysis = {
      modelName: result.modelName,
      aiEvaluatorModel: this.aiEvaluatorModel,
      codeQualityScore: result.aiCodeQualityScore,
      codeQualitySummary: result.aiCodeQualitySummary,
      fullAIResponse: result.aiEvaluationResponse,
      evaluationTimestamp: new Date().toISOString()
    };
    
    fs.writeFileSync(analysisFile, JSON.stringify(analysis, null, 2));
    
    // Save Docker output if available
    if (result.output) {
      const outputDir = path.join(this.evaluationDir, 'analysis', 'docker-outputs');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const outputFile = path.join(outputDir, `${result.modelName.replace(/[^a-zA-Z0-9]/g, '-')}-output.txt`);
      fs.writeFileSync(outputFile, result.output);
    }

    // Save the evaluated code
    const codeDir = path.join(this.evaluationDir, 'analysis', 'evaluated-code');
    if (!fs.existsSync(codeDir)) {
      fs.mkdirSync(codeDir, { recursive: true });
    }
    
    const codeFile = path.join(codeDir, `${result.modelName.replace(/[^a-zA-Z0-9]/g, '-')}-code.ts`);
    fs.writeFileSync(codeFile, code);
  }

  /**
   * Generates a comprehensive evaluation report
   */
  async generateEvaluationReport(): Promise<string> {
    const responses = await this.getModelResponses();
    const results: CodeEvaluationResult[] = [];

    for (const response of responses) {
      const scoreFile = this.getScoreFile(response);
      if (fs.existsSync(scoreFile)) {
        const scoreData = JSON.parse(fs.readFileSync(scoreFile, 'utf8'));
        const result = this.scoreResponseToResult(scoreData, response.metadata.model);
        results.push(result);
      }
    }

    return this.formatReport(results);
  }

  /**
   * Converts ScoreResponse back to CodeEvaluationResult
   */
  private scoreResponseToResult(scoreResponse: any, modelName: string): CodeEvaluationResult {
    const evals = scoreResponse.evals.reduce((acc: any, evalItem: any) => {
      acc[evalItem.key] = { value: evalItem.value, score: evalItem.score };
      return acc;
    }, {});

    return {
      modelName,
      generationTimeMs: parseInt(evals.generation_time_ms?.value || '0'),
      codeExtractionSuccess: evals.code_extraction_success?.value === 'true',
      codeLength: parseInt(evals.code_length?.value || '0'),
      dockerBuildSuccess: evals.docker_build_success?.value === 'true',
      dockerExecutionSuccess: evals.docker_execution_success?.value === 'true',
      aiCodeQualityScore: parseInt(evals.ai_code_quality_score?.value || '1'),
      aiCodeQualitySummary: evals.ai_code_quality_summary?.value || 'No evaluation',
      totalScore: parseFloat(evals.total_score?.value || '0'),
      errors: evals.errors?.value ? evals.errors.value.split('; ') : []
    };
  }

  /**
   * Formats the evaluation report
   */
  private formatReport(results: CodeEvaluationResult[]): string {
    const sortedResults = results.sort((a, b) => b.totalScore - a.totalScore);
    
    let report = `# AI-Powered Code Quality Evaluation Report\n\n`;
    report += `**AI Evaluator Model:** ${this.aiEvaluatorModel}\n\n`;
    report += `## Summary\n\n`;
    
    const totalModels = results.length;
    const successfulGenerations = results.filter(r => r.codeExtractionSuccess).length;
    const successfulBuilds = results.filter(r => r.dockerBuildSuccess).length;
    const successfulExecutions = results.filter(r => r.dockerExecutionSuccess).length;
    const averageScore = results.reduce((sum, r) => sum + r.totalScore, 0) / totalModels;
    const averageAIScore = results.reduce((sum, r) => sum + r.aiCodeQualityScore, 0) / totalModels;

    report += `- **Total Models**: ${totalModels}\n`;
    report += `- **Successful Code Extraction**: ${successfulGenerations}/${totalModels} (${(successfulGenerations/totalModels*100).toFixed(1)}%)\n`;
    report += `- **Successful Docker Builds**: ${successfulBuilds}/${totalModels} (${(successfulBuilds/totalModels*100).toFixed(1)}%)\n`;
    report += `- **Successful Docker Executions**: ${successfulExecutions}/${totalModels} (${(successfulExecutions/totalModels*100).toFixed(1)}%)\n`;
    report += `- **Average Total Score**: ${averageScore.toFixed(3)}\n`;
    report += `- **Average AI Quality Score**: ${averageAIScore.toFixed(2)}/5\n\n`;

    report += `## Detailed Results\n\n`;
    report += `| Model | Total Score | AI Quality | Gen Time | Code Len | Build | Execute | AI Summary |\n`;
    report += `|-------|-------------|------------|----------|----------|-------|---------|------------|\n`;

    for (const result of sortedResults) {
      const summary = result.aiCodeQualitySummary.length > 50 
        ? result.aiCodeQualitySummary.substring(0, 47) + '...'
        : result.aiCodeQualitySummary;
      
      report += `| ${result.modelName} | ${result.totalScore.toFixed(3)} | ${result.aiCodeQualityScore}/5 | ${result.generationTimeMs}ms | ${result.codeLength} | ${result.dockerBuildSuccess ? '✅' : '❌'} | ${result.dockerExecutionSuccess ? '✅' : '❌'} | ${summary} |\n`;
    }

    report += `\n## Top Performers\n\n`;
    const top3 = sortedResults.slice(0, 3);
    for (const result of top3) {
      report += `### ${result.modelName} (Total Score: ${result.totalScore.toFixed(3)})\n`;
      report += `- **AI Quality Score**: ${result.aiCodeQualityScore}/5\n`;
      report += `- **AI Summary**: ${result.aiCodeQualitySummary}\n`;
      report += `- **Generation Time**: ${result.generationTimeMs}ms\n`;
      report += `- **Code Length**: ${result.codeLength} characters\n`;
      report += `- **Docker Execution**: ${result.dockerExecutionSuccess ? '✅ Success' : '❌ Failed'}\n`;
      if (result.errors.length > 0) {
        report += `- **Errors**: ${result.errors.join(', ')}\n`;
      }
      report += `\n`;
    }

    return report;
  }
}
