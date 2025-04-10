import { ModelDetails, ModelOptions, ModelResponse, ModelRunner } from './models/types.js'
import { RateLimitConfig } from './rate-limit.js'
import { shouldAllowRequest, updateRateLimitState } from './rate-limit.js'
import { LanguageModelV1, generateText } from 'ai'
import { calculateCost } from './costs/costs.js'
import { getModel, validateModel } from './providers/index.js'

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
    modelDetails: ModelDetails;
    options?: ModelOptions;
  }): Promise<ModelResponse> {
    const startTime = new Date();
    const modelIdString = `${params.modelDetails.provider}/${params.modelDetails.name}`;

    try {

      const validatedModel = await validateModel(params.modelDetails);
      if (!validatedModel) {
        throw new Error(`Invalid model details: ${JSON.stringify(params.modelDetails)}`);
      }
      params.modelDetails = validatedModel;
      
      // Log all relevant parameters using modelDetails
      console.log('Executing model with the following parameters:');
      console.log('Model ID:', modelIdString);
      console.log('Provider:', params.modelDetails.provider);
      console.log('Model Name:', params.modelDetails.name);
      console.log('Prompt:', params.prompt);
      console.log('Options:', params.options);
      console.log('Max Tokens:', params.options?.maxTokens);
      console.log('Costs:', JSON.stringify(params.modelDetails.costs, null, 2)); 

      // Fetch the LanguageModelV1 instance using getModel
      const model = await getModel(params.modelDetails);
      if (!model) {
        throw new Error(`Failed to get LanguageModelV1 for ${modelIdString}`);
      }


      // Check rate limits before making request using modelIdString
      if (!shouldAllowRequest(modelIdString, this.config.rateLimitConfig)) {
        throw new Error('Rate limit exceeded - backoff in progress');
      }

      // Use the AI SDK to execute the model
      const response = await generateText({
        model: model,
        prompt: params.prompt,
        ...params.options
      });
      
      
      // Update rate limit state with success using modelIdString
      updateRateLimitState(modelIdString, true, undefined, this.config.rateLimitConfig);

      // Calculate cost using the passed modelDetails and response usage, handling potential undefined usage
      const costBreakdown = (response.usage && response.usage.promptTokens !== undefined && response.usage.completionTokens !== undefined) 
        ? calculateCost(params.modelDetails, {
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            total: response.usage.totalTokens || (response.usage.promptTokens + response.usage.completionTokens) // Calculate total if missing
          })
        : null;

      if (!response.usage || response.usage.promptTokens === undefined || response.usage.completionTokens === undefined) {
        console.warn(`Warning: Usage statistics (prompt/completion tokens) not available for model ${modelIdString}. Cost cannot be calculated.`);
      }

      const modelResponse: ModelResponse = {
        content: response.text,
        metadata: {
          startTime,
          endTime: new Date(),
          tokenUsage: {
            promptTokens: response.usage?.promptTokens || 0,
            completionTokens: response.usage?.completionTokens || 0,
            total: response.usage?.totalTokens || (response.usage?.promptTokens || 0) + (response.usage?.completionTokens || 0) // Ensure total is calculated
          },
          cost: costBreakdown || undefined,
          provider: params.modelDetails.provider, // Use provider from modelDetails
          model: params.modelDetails.name // Use name from modelDetails
        }
      };
      
      console.log('Response object:', response);
      
      return modelResponse;
    } catch (error) {
      // Update rate limit state with failure using modelIdString
      updateRateLimitState(modelIdString, false, undefined, this.config.rateLimitConfig);

      // Throw the original error without retrying
      if (error instanceof Error) {
        console.error(`Error during model execution for ${modelIdString}:`, error);
        throw new Error(`Model execution failed: ${error.message}`);
      }
      console.error(`Unknown error during model execution for ${modelIdString}:`, error);
      throw new Error('Model execution failed with unknown error');
    }
  }
} 