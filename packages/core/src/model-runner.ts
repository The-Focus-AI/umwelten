import { ModelOptions, ModelResponse, ModelRunner } from './models/models.js'
import { RateLimitConfig } from './rate-limit.js'
import { shouldAllowRequest, updateRateLimitState } from './rate-limit.js'
import { LanguageModelV1, generateText } from 'ai'

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
    model: LanguageModelV1;
    options?: ModelOptions;
  }): Promise<ModelResponse> {
    const startTime = new Date();
    
    try {
      // Log all relevant parameters
      console.log('Executing model with the following parameters:');
      console.log('Model ID:', params.model.toString());
      console.log('Prompt:', params.prompt);
      console.log('Options:', params.options);
      console.log('Max Tokens:', params.options?.maxTokens);

      // Check rate limits before making request
      if (!shouldAllowRequest(params.model.toString(), this.config.rateLimitConfig)) {
        throw new Error('Rate limit exceeded - backoff in progress');
      }

      // Use the AI SDK to execute the model
      const response = await generateText({
        model: params.model,
        prompt: params.prompt,
        ...params.options
      });
      
      // Update rate limit state with success
      updateRateLimitState(params.model.toString(), true, undefined, this.config.rateLimitConfig);

      // Format the response to match our ModelResponse interface
      const modelResponse: ModelResponse = {
        content: response.text,
        metadata: {
          startTime,
          endTime: new Date(),
          tokenUsage: {
            promptTokens: response.usage?.promptTokens || 0,
            completionTokens: response.usage?.completionTokens || 0,
            total: response.usage?.totalTokens || 0
          },
          cost: 0, // Cost calculation should be handled separately
          provider: params.model.provider || 'unknown', // Use the provider property
          model: params.model.toString()
        }
      };
      
      return modelResponse;
    } catch (error) {
      // Update rate limit state with failure
      updateRateLimitState(params.model.toString(), false, undefined, this.config.rateLimitConfig);

      // Throw the original error without retrying
      if (error instanceof Error) {
        throw new Error(`Model execution failed: ${error.message}`);
      }
      throw new Error('Model execution failed with unknown error');
    }
  }
} 