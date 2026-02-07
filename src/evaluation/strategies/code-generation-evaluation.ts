import { EvaluationStrategy, EvaluationResult, EvaluationMetadata } from '../types/evaluation-types.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import { ModelDetails, ModelResponse } from '../../cognition/types.js';
import { EvaluationCache } from '../caching/cache-service.js';
import { Interaction } from '../../interaction/core/interaction.js';
import { extractTypeScriptCode, fixCommonTypeScriptErrors, ensureConsoleOutput } from '../typescript-code-extractor.js';
import { DaggerRunner } from '../dagger-runner.js';
import { CodeScorer } from '../code-scorer.js';
import path from 'path';

export interface CodeGenerationConfig {
  extractCode?: boolean;
  runDagger?: boolean;
  aiScoring?: boolean;
  fixCommonErrors?: boolean;
  ensureConsoleOutput?: boolean;
  daggerTimeout?: number;
  maxConcurrent?: number;
  evaluatorModel?: ModelDetails;  // Model to use for AI evaluation (defaults to gpt-oss:latest on ollama)
}

export interface CodeGenerationResult extends EvaluationResult {
  extractedCode?: string;
  daggerResult?: any;
  codeScore?: any;
  timing?: {
    responseTime: number;
    extractionTime: number;
    daggerTime: number;
    scoringTime: number;
    totalTime: number;
  };
}

export class CodeGenerationEvaluation implements EvaluationStrategy {
  constructor(
    public stimulus: Stimulus,
    public models: ModelDetails[],
    public prompt: string,
    private cache: EvaluationCache,
    private config: CodeGenerationConfig = {}
  ) {
    // Set defaults
    this.config = {
      extractCode: true,
      runDagger: true,
      aiScoring: true,
      fixCommonErrors: true,
      ensureConsoleOutput: true,
      daggerTimeout: 30000,
      maxConcurrent: 3,
      ...config
    };
  }

  async run(): Promise<CodeGenerationResult[]> {
    const results: CodeGenerationResult[] = [];
    const startTime = Date.now();

    // Process models in batches to respect concurrency limits
    const batches = this.createBatches(this.models, this.config.maxConcurrent!);
    
    for (const batch of batches) {
      const batchPromises = batch.map(model => this.evaluateModel(model, startTime));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  private async evaluateModel(model: ModelDetails, startTime: number): Promise<CodeGenerationResult> {
    const modelStartTime = Date.now();
    let extractedCode: string | undefined;
    let daggerResult: any;
    let codeScore: any;
    let timing = {
      responseTime: 0,
      extractionTime: 0,
      daggerTime: 0,
      scoringTime: 0,
      totalTime: 0
    };

    try {
      // Step 1: Generate model response
      const responseStartTime = Date.now();
      const response = await this.cache.getCachedModelResponse(
        model,
        this.stimulus.id || 'code-generation',
        async () => {
          const interaction = new Interaction(model, this.stimulus);
          interaction.addMessage({ role: 'user', content: this.prompt });
          return await interaction.generateText();
        }
      );
      timing.responseTime = Date.now() - responseStartTime;

      // Step 2: Extract code (if enabled)
      if (this.config.extractCode) {
        const extractionStartTime = Date.now();
        const cachedCode = await this.cache.getCachedFile(
          `extracted-code/${this.getModelKey(model)}`,
          async () => {
            let code: string | null = extractTypeScriptCode(response.content);

            if (code && this.config.fixCommonErrors) {
              code = fixCommonTypeScriptErrors(code);
            }

            if (code && this.config.ensureConsoleOutput) {
              code = ensureConsoleOutput(code);
            }

            return code || '';
          }
        );
        extractedCode = cachedCode || undefined;
        timing.extractionTime = Date.now() - extractionStartTime;
      }

      // Step 3: Run Dagger (if enabled and code extracted)
      if (this.config.runDagger && extractedCode) {
        const daggerStartTime = Date.now();
        daggerResult = await this.cache.getCachedFile(
          `dagger-results/${this.getModelKey(model)}`,
          async () => {
            return await DaggerRunner.runCode({
              code: extractedCode!,
              language: 'typescript',
              timeout: this.config.daggerTimeout ? this.config.daggerTimeout / 1000 : 30,
              modelName: model.name
            });
          }
        );
        timing.daggerTime = Date.now() - daggerStartTime;
      }

      // Step 4: AI Scoring (if enabled)
      if (this.config.aiScoring) {
        const scoringStartTime = Date.now();
        const evaluationId = this.cache.getWorkdir().split(path.sep).pop() || 'unknown';
        codeScore = await this.cache.getCachedScore(
          model,
          this.stimulus.id || 'code-generation',
          'code-quality',
          async () => {
            const scorer = new CodeScorer(evaluationId, this.config.evaluatorModel);
            // Pass original response so code can be re-extracted
            return await scorer.scoreResponse(response);
          }
        );
        timing.scoringTime = Date.now() - scoringStartTime;
      }

      timing.totalTime = Date.now() - modelStartTime;

      const metadata: EvaluationMetadata = {
        stimulusId: this.stimulus.id || 'code-generation',
        evaluationId: this.cache.getWorkdir().split(path.sep).pop() || 'unknown',
        timestamp: new Date(),
        duration: timing.totalTime,
        cached: false // We're not caching the full result, just components
      };

      return {
        model,
        response,
        metadata,
        extractedCode,
        daggerResult,
        codeScore,
        timing
      };

    } catch (error) {
      console.error(`Error evaluating model ${model.name}:`, error);
      
      const metadata: EvaluationMetadata = {
        stimulusId: this.stimulus.id || 'code-generation',
        evaluationId: this.cache.getWorkdir().split(path.sep).pop() || 'unknown',
        timestamp: new Date(),
        duration: Date.now() - modelStartTime,
        cached: false,
        error: error instanceof Error ? error.message : String(error)
      };

      return {
        model,
        response: {
          content: '',
          metadata: {
            startTime: new Date(),
            endTime: new Date(),
            tokenUsage: { promptTokens: 0, completionTokens: 0 },
            provider: model.provider,
            model: model.name,
            cost: { promptCost: 0, completionCost: 0, totalCost: 0, usage: { promptTokens: 0, completionTokens: 0 } }
          }
        },
        metadata,
        timing: {
          responseTime: 0,
          extractionTime: 0,
          daggerTime: 0,
          scoringTime: 0,
          totalTime: Date.now() - modelStartTime
        }
      };
    }
  }

  private getModelKey(model: ModelDetails): string {
    return `${model.name.replace(/\//g, '-')}-${model.provider}`;
  }
}
