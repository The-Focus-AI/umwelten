import { EvaluationStrategy, EvaluationResult, EvaluationMetadata } from '../types/evaluation-types.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import { ModelDetails, ModelResponse } from '../../cognition/types.js';
import { EvaluationCache } from '../caching/cache-service.js';
import { Interaction } from '../../interaction/interaction.js';
import { extractTypeScriptCode, fixCommonTypeScriptErrors, ensureConsoleOutput } from '../typescript-code-extractor.js';
import { DockerRunner } from '../docker-runner.js';
import { CodeScorer } from '../code-scorer.js';
import path from 'path';

export interface CodeGenerationConfig {
  extractCode?: boolean;
  runDocker?: boolean;
  aiScoring?: boolean;
  fixCommonErrors?: boolean;
  ensureConsoleOutput?: boolean;
  dockerTimeout?: number;
  maxConcurrent?: number;
}

export interface CodeGenerationResult extends EvaluationResult {
  extractedCode?: string;
  dockerResult?: any;
  codeScore?: any;
  timing?: {
    responseTime: number;
    extractionTime: number;
    dockerTime: number;
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
      runDocker: true,
      aiScoring: true,
      fixCommonErrors: true,
      ensureConsoleOutput: true,
      dockerTimeout: 30000,
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
    let dockerResult: any;
    let codeScore: any;
    let timing = {
      responseTime: 0,
      extractionTime: 0,
      dockerTime: 0,
      scoringTime: 0,
      totalTime: 0
    };

    try {
      // Step 1: Generate model response
      const responseStartTime = Date.now();
      const response = await this.cache.getCachedModelResponse(
        model,
        this.stimulus.id,
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
        extractedCode = await this.cache.getCachedFile(
          `extracted-code/${this.getModelKey(model)}`,
          async () => {
            let code = extractTypeScriptCode(response.content);
            
            if (this.config.fixCommonErrors) {
              code = fixCommonTypeScriptErrors(code);
            }
            
            if (this.config.ensureConsoleOutput) {
              code = ensureConsoleOutput(code);
            }
            
            return code;
          }
        );
        timing.extractionTime = Date.now() - extractionStartTime;
      }

      // Step 3: Run Docker (if enabled and code extracted)
      if (this.config.runDocker && extractedCode) {
        const dockerStartTime = Date.now();
        dockerResult = await this.cache.getCachedFile(
          `docker-results/${this.getModelKey(model)}`,
          async () => {
            const dockerRunner = new DockerRunner({
              timeout: this.config.dockerTimeout,
              workdir: this.cache.getWorkdir()
            });
            
            return await dockerRunner.runCode(extractedCode!, {
              language: 'typescript',
              model: model.name,
              evaluationId: this.cache.getWorkdir().split(path.sep).pop() || 'unknown'
            });
          }
        );
        timing.dockerTime = Date.now() - dockerStartTime;
      }

      // Step 4: AI Scoring (if enabled)
      if (this.config.aiScoring) {
        const scoringStartTime = Date.now();
        codeScore = await this.cache.getCachedScore(
          model,
          this.stimulus.id,
          'code-quality',
          async () => {
            const scorer = new CodeScorer();
            return await scorer.scoreCode({
              code: extractedCode || response.content,
              prompt: this.prompt,
              dockerResult: dockerResult,
              model: model.name
            });
          }
        );
        timing.scoringTime = Date.now() - scoringStartTime;
      }

      timing.totalTime = Date.now() - modelStartTime;

      const metadata: EvaluationMetadata = {
        stimulusId: this.stimulus.id,
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
        dockerResult,
        codeScore,
        timing
      };

    } catch (error) {
      console.error(`Error evaluating model ${model.name}:`, error);
      
      const metadata: EvaluationMetadata = {
        stimulusId: this.stimulus.id,
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
            cost: { total: 0, prompt: 0, completion: 0 }
          }
        },
        metadata,
        timing: {
          responseTime: 0,
          extractionTime: 0,
          dockerTime: 0,
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
