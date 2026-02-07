import { ModelDetails, ModelResponse } from '../../cognition/types.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import { Interaction } from '../../interaction/core/interaction.js';
import { EvaluationCache } from '../caching/cache-service.js';
import { 
  EvaluationStrategy, 
  EvaluationResult, 
  EvaluationMetadata,
  EvaluationConfig,
  ProgressCallback 
} from '../types/evaluation-types.js';

/**
 * Simple evaluation strategy for basic text generation tasks
 * 
 * This strategy evaluates models by:
 * 1. Creating an Interaction with the provided Stimulus
 * 2. Adding a user message with the prompt
 * 3. Executing the interaction to get a model response
 * 4. Caching the response for future use
 * 
 * This is the most basic evaluation strategy and serves as the foundation
 * for more complex strategies.
 */
export class SimpleEvaluation implements EvaluationStrategy {
  private stimulus: Stimulus;
  private models: ModelDetails[];
  private prompt: string;
  private cache: EvaluationCache;
  private config: EvaluationConfig;
  private progressCallback?: ProgressCallback;

  constructor(
    stimulus: Stimulus,
    models: ModelDetails[],
    prompt: string,
    cache: EvaluationCache,
    config: EvaluationConfig = {},
    progressCallback?: ProgressCallback
  ) {
    this.stimulus = stimulus;
    this.models = models;
    this.prompt = prompt;
    this.cache = cache;
    this.config = {
      useCache: true,
      concurrent: false,
      maxConcurrency: 3,
      resume: true,
      showProgress: true,
      ...config,
      evaluationId: config.evaluationId || `simple-eval-${Date.now()}`
    };
    this.progressCallback = progressCallback;
  }

  /**
   * Run the evaluation for all models
   */
  async run(): Promise<EvaluationResult[]> {
    const results: EvaluationResult[] = [];
    
    if (this.config.concurrent) {
      // Run evaluations concurrently in batches
      const batches = this.createBatches(this.models, this.config.maxConcurrency!);
      
      for (const batch of batches) {
        const batchPromises = batch.map(model => this.evaluateModel(model));
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      }
    } else {
      // Run evaluations sequentially
      for (const model of this.models) {
        const result = await this.evaluateModel(model);
        results.push(result);
      }
    }
    
    return results;
  }

  /**
   * Evaluate a single model
   */
  private async evaluateModel(model: ModelDetails): Promise<EvaluationResult> {
    const startTime = Date.now();
    
    try {
      // Notify progress: starting
      this.notifyProgress({
        modelName: `${model.provider}:${model.name}`,
        status: 'starting'
      });

      // Get or create model response
      const response = await this.getModelResponse(model);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Notify progress: completed
      this.notifyProgress({
        modelName: `${model.provider}:${model.name}`,
        status: 'completed',
        content: response.content,
        metadata: response.metadata
      });

      // Create evaluation metadata
      const metadata: EvaluationMetadata = {
        stimulusId: this.getStimulusId(),
        evaluationId: this.config.evaluationId || `simple-eval-${Date.now()}`,
        timestamp: new Date(),
        duration,
        cached: false, // This will be set by the cache service
        strategy: 'SimpleEvaluation'
      };

      return {
        model,
        response,
        metadata
      };

    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Notify progress: error
      this.notifyProgress({
        modelName: `${model.provider}:${model.name}`,
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      });

      // Create error result
      const metadata: EvaluationMetadata = {
        stimulusId: this.getStimulusId(),
        evaluationId: this.config.evaluationId || `simple-eval-${Date.now()}`,
        timestamp: new Date(),
        duration,
        cached: false,
        strategy: 'SimpleEvaluation',
        error: error instanceof Error ? error.message : String(error)
      };

      // Create a dummy response for error cases
      const errorResponse: ModelResponse = {
        content: '',
        metadata: {
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          tokenUsage: { promptTokens: 0, completionTokens: 0 },
          provider: model.provider,
          model: model.name,
          cost: { promptCost: 0, completionCost: 0, totalCost: 0, usage: { promptTokens: 0, completionTokens: 0 } }
        }
      };

      return {
        model,
        response: errorResponse,
        metadata
      };
    }
  }

  /**
   * Get model response with caching
   */
  private async getModelResponse(model: ModelDetails): Promise<ModelResponse> {
    if (!this.config.useCache) {
      return this.generateModelResponse(model);
    }

    return this.cache.getCachedModelResponse(
      model,
      this.getStimulusId(),
      () => this.generateModelResponse(model)
    );
  }

  /**
   * Generate a fresh model response
   */
  private async generateModelResponse(model: ModelDetails): Promise<ModelResponse> {
    // Create interaction with the stimulus
    const interaction = new Interaction(model, this.stimulus);
    
    // Add the user prompt
    interaction.addMessage({
      role: 'user',
      content: this.prompt
    });

    // Execute the interaction
    return await interaction.generateText();
  }

  /**
   * Get stimulus ID for caching
   */
  private getStimulusId(): string {
    // Use stimulus options to create a unique ID
    const role = this.stimulus.options.role || 'assistant';
    const objective = this.stimulus.options.objective || 'task';
    return `${role}-${objective}`.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  }

  /**
   * Create batches for concurrent execution
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Notify progress callback if available
   */
  private notifyProgress(progress: Parameters<ProgressCallback>[0]): void {
    if (this.progressCallback && this.config.showProgress) {
      this.progressCallback(progress);
    }
  }
}
