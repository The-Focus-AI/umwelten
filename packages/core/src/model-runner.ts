import { ModelDetails, ModelOptions, ModelResponse, ModelRunner } from './models/types.js'
import { RateLimitConfig } from './rate-limit.js'
import { shouldAllowRequest, updateRateLimitState } from './rate-limit.js'
import { LanguageModelV1, generateText, streamText } from 'ai'
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

  private logModelDetails(modelIdString: string, params: { prompt: string; modelDetails: ModelDetails; options?: ModelOptions }) {
    console.log('Model ID:', modelIdString);
    console.log('Provider:', params.modelDetails.provider);
    console.log('Model Name:', params.modelDetails.name);
    console.log('Prompt:', params.prompt);
    console.log('Options:', params.options);
    console.log('Max Tokens:', params.options?.maxTokens);
    console.log('Costs:', JSON.stringify(params.modelDetails.costs, null, 2));
  }

  private handleError(error: any, modelIdString: string, action: string): never {
    updateRateLimitState(modelIdString, false, undefined, this.config.rateLimitConfig);

    if (error instanceof Error) {
      console.error(`Error during model ${action} for ${modelIdString}:`, error);
      throw new Error(`Model ${action} failed: ${error.message}`);
    }
    console.error(`Unknown error during model ${action} for ${modelIdString}:`, error);
    throw new Error(`Model ${action} failed with unknown error`);
  }

  private async validateAndPrepareModel(params: {
    prompt: string;
    modelDetails: ModelDetails;
    options?: ModelOptions;
  }): Promise<{ model: LanguageModelV1; modelIdString: string }> {
    const modelIdString = `${params.modelDetails.provider}/${params.modelDetails.name}`;

    const validatedModel = await validateModel(params.modelDetails);
    if (!validatedModel) {
      throw new Error(`Invalid model details: ${JSON.stringify(params.modelDetails)}`);
    }
    params.modelDetails = validatedModel;

    this.logModelDetails(modelIdString, params);

    const model = await getModel(params.modelDetails);
    if (!model) {
      throw new Error(`Failed to get LanguageModelV1 for ${modelIdString}`);
    }

    if (!shouldAllowRequest(modelIdString, this.config.rateLimitConfig)) {
      throw new Error('Rate limit exceeded - backoff in progress');
    }

    return { model, modelIdString };
  }

  private calculateCostBreakdown(usage: any, params: { modelDetails: ModelDetails }): any {
    return (usage && usage.promptTokens !== undefined && usage.completionTokens !== undefined) 
      ? calculateCost(params.modelDetails, {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          total: usage.totalTokens || (usage.promptTokens + usage.completionTokens)
        })
      : null;
  }

  async execute(params: {
    prompt: string;
    modelDetails: ModelDetails;
    options?: ModelOptions;
  }): Promise<ModelResponse> {
    const startTime = new Date();
    const { model, modelIdString } = await this.validateAndPrepareModel(params);

    try {
      const response = await generateText({
        model: model,
        prompt: params.prompt,
        ...params.options
      });

      updateRateLimitState(modelIdString, true, undefined, this.config.rateLimitConfig);

      const costBreakdown = this.calculateCostBreakdown(response.usage, params);

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
            total: response.usage?.totalTokens || (response.usage?.promptTokens || 0) + (response.usage?.completionTokens || 0)
          },
          cost: costBreakdown || undefined,
          provider: params.modelDetails.provider,
          model: params.modelDetails.name
        }
      };

      console.log('Response object:', response);

      return modelResponse;
    } catch (error) {
      this.handleError(error, modelIdString, 'execution');
    }
  }

  async stream(params: {
    prompt: string;
    modelDetails: ModelDetails;
    options?: ModelOptions;
  }): Promise<ModelResponse> {
    const startTime = new Date();
    const { model, modelIdString } = await this.validateAndPrepareModel(params);

    try {
      const responseStream = await streamText({
        model: model,
        
        prompt: params.prompt,
        ...params.options
      });

      for await (const textPart of responseStream.textStream) {
        process.stdout.write(textPart);
      }

      const usage = await responseStream.usage;
      const final = await responseStream.text;

      const costBreakdown = this.calculateCostBreakdown(usage, params);

      if (!usage || usage.promptTokens === undefined || usage.completionTokens === undefined) {
        console.warn(`Warning: Usage statistics (prompt/completion tokens) not available for model ${modelIdString}. Cost cannot be calculated.`);
      }

      const modelResponse: ModelResponse = {
        content: final,
        metadata: {
          startTime,
          endTime: new Date(),
          tokenUsage: {
            promptTokens: usage?.promptTokens || 0,
            completionTokens: usage?.completionTokens || 0,
            total: usage?.totalTokens || (usage?.promptTokens || 0) + (usage?.completionTokens || 0)
          },
          cost: costBreakdown || undefined,
          provider: params.modelDetails.provider,
          model: params.modelDetails.name
        }
      };

      return modelResponse;
    } catch (error) {
      this.handleError(error, modelIdString, 'streaming');
    }
  }
} 