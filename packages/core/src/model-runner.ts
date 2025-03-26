import { ModelOptions, ModelProvider, ModelResponse, ModelRunner } from './types.js';
import { shouldAllowRequest, updateRateLimitState, RateLimitConfig } from './rate-limit.js';

export interface ModelRunnerConfig {
  rateLimitConfig?: RateLimitConfig;
  maxRetries?: number;
}

const DEFAULT_CONFIG: ModelRunnerConfig = {
  maxRetries: 3
};

export class BaseModelRunner implements ModelRunner {
  private config: ModelRunnerConfig;

  constructor(config: Partial<ModelRunnerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async execute(params: {
    prompt: string;
    model: ModelProvider;
    options?: ModelOptions;
  }): Promise<ModelResponse> {
    const startTime = new Date();
    let retryCount = 0;
    
    // Ensure maxRetries has a default value
    const maxRetries = this.config.maxRetries !== undefined ? this.config.maxRetries : DEFAULT_CONFIG.maxRetries!;
    
    while (true) {
      try {
        // Check rate limits before making request
        if (!shouldAllowRequest(params.model.id, this.config.rateLimitConfig)) {
          throw new Error('Rate limit exceeded - backoff in progress');
        }

        const response = await params.model.execute(params.prompt, params.options);
        
        // Update rate limit state with success
        updateRateLimitState(params.model.id, true, undefined, this.config.rateLimitConfig);

        // Ensure the response has the correct timing metadata
        response.metadata.startTime = startTime;
        response.metadata.endTime = new Date();
        
        return response;
      } catch (error) {
        // Update rate limit state with failure
        updateRateLimitState(params.model.id, false, undefined, this.config.rateLimitConfig);

        // Handle retries
        if (retryCount < maxRetries) {
          retryCount++;
          continue;
        }

        // Add proper error handling
        if (error instanceof Error) {
          throw new Error(`Model execution failed after ${retryCount} retries: ${error.message}`);
        }
        throw new Error(`Model execution failed after ${retryCount} retries with unknown error`);
      }
    }
  }
} 