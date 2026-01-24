import { EvaluationStrategy, EvaluationResult, EvaluationMetadata } from '../types/evaluation-types.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import { ModelDetails, ModelResponse } from '../../cognition/types.js';
import { EvaluationCache } from '../caching/cache-service.js';
import { Interaction } from '../../interaction/interaction.js';
import path from 'path';

export interface MatrixDimension {
  name: string;
  values: string[];
}

export interface MatrixConfig {
  dimensions: MatrixDimension[];
  maxConcurrent?: number;
  progressCallback?: (progress: MatrixProgress) => void;
}

export interface MatrixProgress {
  completed: number;
  total: number;
  currentModel: string;
  currentCombination: Record<string, string>;
  percentage: number;
}

export interface MatrixResult extends EvaluationResult {
  combination: Record<string, string>;
  matrixIndex: number;
}

export class MatrixEvaluation implements EvaluationStrategy {
  private combinations: Record<string, string>[] = [];
  private totalCombinations: number = 0;

  constructor(
    public stimulus: Stimulus,
    public models: ModelDetails[],
    public prompt: string,
    private cache: EvaluationCache,
    private config: MatrixConfig
  ) {
    this.generateCombinations();
  }

  private generateCombinations(): void {
    this.combinations = this.generateCartesianProduct(this.config.dimensions);
    this.totalCombinations = this.combinations.length * this.models.length;
  }

  private generateCartesianProduct(dimensions: MatrixDimension[]): Record<string, string>[] {
    if (dimensions.length === 0) return [{}];
    
    const result: Record<string, string>[] = [];
    const firstDimension = dimensions[0];
    const restDimensions = dimensions.slice(1);
    const restCombinations = this.generateCartesianProduct(restDimensions);

    for (const value of firstDimension.values) {
      for (const restCombination of restCombinations) {
        result.push({
          [firstDimension.name]: value,
          ...restCombination
        });
      }
    }

    return result;
  }

  async run(): Promise<MatrixResult[]> {
    const results: MatrixResult[] = [];
    let completed = 0;

    for (const combination of this.combinations) {
      for (const model of this.models) {
        const result = await this.evaluateCombination(model, combination, completed);
        results.push(result);
        completed++;

        // Update progress
        if (this.config.progressCallback) {
          this.config.progressCallback({
            completed,
            total: this.totalCombinations,
            currentModel: model.name,
            currentCombination: combination,
            percentage: (completed / this.totalCombinations) * 100
          });
        }
      }
    }

    return results;
  }

  private async evaluateCombination(
    model: ModelDetails, 
    combination: Record<string, string>,
    matrixIndex: number
  ): Promise<MatrixResult> {
    const startTime = Date.now();

    try {
      // Create a modified prompt based on the combination
      const modifiedPrompt = this.applyCombinationToPrompt(this.prompt, combination);
      
      // Create a unique cache key that includes the combination
      const combinationKey = this.createCombinationKey(combination);
      
      // Generate a better cache key using stimulus role and objective
      const stimulusKey = this.stimulus.id || 
        `${this.stimulus.options.role || 'assistant'}-${this.stimulus.options.objective || 'task'}`.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
      
      const response = await this.cache.getCachedModelResponse(
        model,
        `${stimulusKey}-${combinationKey}`,
        async () => {
          const interaction = new Interaction(model, this.stimulus);
          interaction.addMessage({ role: 'user', content: modifiedPrompt });
          return await interaction.generateText();
        }
      );

      const duration = Date.now() - startTime;

      const metadata: EvaluationMetadata = {
        stimulusId: stimulusKey,
        evaluationId: this.cache.getWorkdir()?.split(path.sep).pop() || 'unknown',
        timestamp: new Date(),
        duration,
        cached: false
      };

      return {
        model,
        response,
        metadata,
        combination,
        matrixIndex
      };

    } catch (error) {
      console.error(`Error evaluating combination ${JSON.stringify(combination)} with model ${model.name}:`, error);
      
      const stimulusKey = this.stimulus.id || 
        `${this.stimulus.options.role || 'assistant'}-${this.stimulus.options.objective || 'task'}`.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
      
      const metadata: EvaluationMetadata = {
        stimulusId: stimulusKey,
        evaluationId: this.cache.getWorkdir()?.split(path.sep).pop() || 'unknown',
        timestamp: new Date(),
        duration: Date.now() - startTime,
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
        combination,
        matrixIndex
      };
    }
  }

  private applyCombinationToPrompt(prompt: string, combination: Record<string, string>): string {
    let modifiedPrompt = prompt;
    
    for (const [dimension, value] of Object.entries(combination)) {
      // Replace placeholders in the prompt with combination values
      const placeholder = `{${dimension}}`;
      modifiedPrompt = modifiedPrompt.replace(new RegExp(placeholder, 'g'), value);
    }
    
    return modifiedPrompt;
  }

  private createCombinationKey(combination: Record<string, string>): string {
    return Object.entries(combination)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
  }

  getCombinations(): Record<string, string>[] {
    return this.combinations;
  }

  getTotalCombinations(): number {
    return this.totalCombinations;
  }
}
