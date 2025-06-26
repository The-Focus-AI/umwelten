import {
  ModelDetails,
  ModelOptions,
  ModelResponse,
  ModelRunner,
} from "./types.js";
import { RateLimitConfig } from "../rate-limit/rate-limit.js";
import {
  shouldAllowRequest,
  getRateLimitState,
  updateRateLimitState,
  clearRateLimitState,
} from "../rate-limit/rate-limit.js";
import {
  LanguageModelV1,
  generateText,
  generateObject,
  streamObject,
  streamText,
} from "ai";
import { calculateCost, formatCostBreakdown } from "../costs/costs.js";
import { getModel, validateModel } from "../providers/index.js";
import { Interaction } from "../interaction/interaction.js";
import { z } from "zod";

export interface ModelRunnerConfig {
  rateLimitConfig?: RateLimitConfig;
  maxRetries?: number;
  maxTokens?: number;
}

const DEFAULT_CONFIG: ModelRunnerConfig = {
  maxRetries: 3,
  maxTokens: 4096, // Default safeguard
};

export class BaseModelRunner implements ModelRunner {
  private config: ModelRunnerConfig;

  constructor(config: Partial<ModelRunnerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private logModelDetails(
    modelIdString: string,
    params: {
      prompt: string;
      modelDetails: ModelDetails;
      options?: ModelOptions;
    }
  ) {
    console.log("Model ID:", modelIdString);
    console.log("Provider:", params.modelDetails.provider);
    console.log("Model Name:", params.modelDetails.name);
    console.log("Prompt:", params.prompt);
    console.log("Options:", params.options);
    console.log("Max Tokens:", params.options?.maxTokens);
    console.log("Costs:", JSON.stringify(params.modelDetails.costs, null, 2));
  }

  private handleError(
    error: any,
    modelIdString: string,
    action: string
  ): never {
    updateRateLimitState(
      modelIdString,
      false,
      error,
      error.response?.headers,
      this.config.rateLimitConfig
    );

    if (error instanceof Error) {
      console.error(
        `Error during model ${action} for ${modelIdString}:`,
        error
      );
      throw new Error(`Model ${action} failed: ${error.message}`);
    }
    console.error(
      `Unknown error during model ${action} for ${modelIdString}:`,
      error
    );
    throw new Error(`Model ${action} failed with unknown error`);
  }

  private async validateAndPrepareModel(params: {
    prompt: string;
    interaction: Interaction;
    options?: ModelOptions;
  }): Promise<{ model: LanguageModelV1; modelIdString: string }> {
    const modelIdString = `${params.interaction.modelDetails.provider}/${params.interaction.modelDetails.name}`;

    const validatedModel = await validateModel(params.interaction.modelDetails);
    if (!validatedModel) {
      throw new Error(
        `Invalid model details: ${JSON.stringify(params.interaction.modelDetails)}`
      );
    }
    if (params.interaction.modelDetails.numCtx) {
      validatedModel.numCtx = params.interaction.modelDetails.numCtx;
    }
    if (params.interaction.modelDetails.temperature) {
      validatedModel.temperature = params.interaction.modelDetails.temperature;
    }
    if (params.interaction.modelDetails.topP) {
      validatedModel.topP = params.interaction.modelDetails.topP;
    } 
    if (params.interaction.modelDetails.topK) {
      validatedModel.topK = params.interaction.modelDetails.topK;
    }
    
    params.interaction.modelDetails = validatedModel;

    // this.logModelDetails(modelIdString, {
    //   prompt: params.prompt,
    //   modelDetails: params.interaction.modelDetails,
    //   options: params.interaction.options,
    // });

    const model = await getModel(params.interaction.modelDetails);
    if (!model) {
      throw new Error(`Failed to get LanguageModelV1 for ${modelIdString}`);
    }

    if (!shouldAllowRequest(modelIdString, this.config.rateLimitConfig)) {
      throw new Error("Rate limit exceeded - backoff in progress");
    }

    return { model, modelIdString };
  }

  private calculateCostBreakdown(
    usage: any,
    params: { modelDetails: ModelDetails }
  ): any {
    return usage &&
      usage.promptTokens !== undefined &&
      usage.completionTokens !== undefined
      ? calculateCost(params.modelDetails, {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          total:
            usage.totalTokens || usage.promptTokens + usage.completionTokens,
        })
      : null;
  }

  async generateText(interaction: Interaction): Promise<ModelResponse> {
    const { startTime, model, modelIdString } =
      await this.startUp(conversation);

    const mergedOptions = {
      maxTokens: this.config.maxTokens,
      ...interaction.options,
    };

    const response = await generateText({
      model: model,
      messages: interaction.getMessages(),
      temperature: interaction.modelDetails.temperature,
      topP: interaction.modelDetails.topP,
      topK: interaction.modelDetails.topK,
      ...mergedOptions,
    });

    return this.makeResult({
      response,
      content: response.text,
      usage: response.usage,
      interaction,
      startTime,
      modelIdString,
    });
  }

  async streamText(interaction: Interaction): Promise<ModelResponse> {
    const { startTime, model, modelIdString } =
      await this.startUp(conversation);
    try {
      const mergedOptions = {
        maxTokens: this.config.maxTokens,
        ...interaction.options,
      };

      const response = await streamText({
        model: model,
        messages: interaction.getMessages(),
        ...mergedOptions,
        temperature: interaction.modelDetails.temperature,
        topP: interaction.modelDetails.topP,
        topK: interaction.modelDetails.topK,  
        onFinish: (event) => {
          console.log("Finish Reason:", event.finishReason);
        },
      });

      for await (const textPart of response.textStream) {
        process.stdout.write(textPart);
      }

      const usage = await response.usage;

      return this.makeResult({
        response,
        content: await response.text,
        usage,
        interaction,
        startTime,
        modelIdString,
      });
    } catch (error) {
      this.handleError(error, modelIdString, "execution");
    }
  }

  async generateObject(
    interaction: Interaction,
    schema: z.ZodSchema
  ): Promise<ModelResponse> {
    const { startTime, model, modelIdString } =
      await this.startUp(conversation);

    const mergedOptions = {
      maxTokens: this.config.maxTokens,
      ...interaction.options,
    };

    const response = await generateObject({
      model: model,
      messages: interaction.getMessages(),
      ...mergedOptions,
      temperature: interaction.modelDetails.temperature,
      topP: interaction.modelDetails.topP,
      topK: interaction.modelDetails.topK,
      schema: schema,
      experimental_repairText: async (options: {  text: string, error: any}) => {
        console.log("Repairing text:", options.text);
        console.log("Options:", options);
        return options.text.replace(/^```json\n/, '').replace(/\n```$/, '');
      }
    });

    return this.makeResult({
      response,
      content: response.object as string,
      usage: response.usage,
      interaction,
      startTime,
      modelIdString,
    });
  }

  async streamObject(
    interaction: Interaction,
    schema: z.ZodSchema
  ): Promise<ModelResponse> {
    const { startTime, model, modelIdString } =
      await this.startUp(conversation);
    try {
      const mergedOptions = {
        maxTokens: this.config.maxTokens,
        ...interaction.options,
      };

      const response = await streamObject({
        model: model,
        messages: interaction.getMessages(),
        temperature: interaction.modelDetails.temperature,
        topP: interaction.modelDetails.topP,
        topK: interaction.modelDetails.topK,  
        ...mergedOptions,
        schema: schema,
      });

      for await (const textPart of response.textStream) {
        process.stdout.write(textPart);
      }

      const usage = await response.usage;

      return this.makeResult({
        response,
        content: (await response.object) as string,
        usage,
        interaction,
        startTime,
        modelIdString,
      });
    } catch (error) {
      this.handleError(error, modelIdString, "execution");
    }
  }

  async startUp(
    interaction: Interaction
  ): Promise<{
    startTime: Date;
    model: LanguageModelV1;
    modelIdString: string;
  }> {
    const startTime = new Date();
    const { model, modelIdString } = await this.validateAndPrepareModel({
      interaction: interaction,
      prompt: interaction.prompt,
    });

    return { startTime, model, modelIdString };
  }

  async makeResult({
    response,
    content,
    usage,
    interaction,
    startTime,
    modelIdString,
  }: {
    response: any;
    content: string;
    usage: any;
    interaction: Interaction;
    startTime: Date;
    modelIdString: string;
  }) {
    updateRateLimitState(
      modelIdString,
      true,
      undefined,
      this.config.rateLimitConfig
    );

    // console.log('usage', usage);

    const costBreakdown = this.calculateCostBreakdown(usage, {
      modelDetails: interaction.modelDetails,
    });

    // console.log('cost breakdown', costBreakdown);

    if (
      !usage ||
      usage.promptTokens === undefined ||
      usage.completionTokens === undefined
    ) {
      console.warn(
        `Warning: Usage statistics (prompt/completion tokens) not available for model ${modelIdString}. Cost cannot be calculated.`
      );
    }

    interaction.addMessage({
      role: "assistant",
      content: content,
    });

    const modelResponse: ModelResponse = {
      content: content,
      metadata: {
        startTime,
        endTime: new Date(),
        tokenUsage: {
          promptTokens: usage?.promptTokens || 0,
          completionTokens: usage?.completionTokens || 0,
          total:
            usage?.totalTokens ||
            (usage?.promptTokens || 0) + (usage?.completionTokens || 0),
        },
        cost: costBreakdown || undefined,
        // costInfo: costBreakdown ? formatCostBreakdown(costBreakdown) : undefined,
        provider: interaction.modelDetails.provider,
        model: interaction.modelDetails.name,
      },
    };

    // console.log("Response object:", response);

    return modelResponse;
  }

  /*
  async stream(interaction: Interaction): Promise<ModelResponse> {
    const startTime = new Date();
    const { model, modelIdString } = await this.validateAndPrepareModel({
      prompt: interaction.prompt,
      modelDetails: interaction.modelDetails,
      options: interaction.options
    });

    try {
      console.log('Streaming messages:')
      

      const responseStream = await streamText({
        model: model,
        messages: interaction.getMessages(),
        ...interaction.options,
        onFinish: (event) => {
          console.log('Finish Reason:', event.finishReason);
        },
        onError: (error) => {
          console.error('Error:', error);
        },
        
      });

      for await (const textPart of responseStream.textStream) {
        process.stdout.write(textPart);
      }


      const usage = await responseStream.usage;
      const final = await responseStream.text;
      const finishReason = await responseStream.finishReason;

      const costBreakdown = this.calculateCostBreakdown(usage, { modelDetails: interaction.modelDetails });

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
          provider: interaction.modelDetails.provider,
          model: interaction.modelDetails.name
        }
      };

      return modelResponse;
    } catch (error) {
      this.handleError(error, modelIdString, 'streaming');
    }
  }
*/
}
