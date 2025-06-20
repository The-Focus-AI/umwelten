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
import { Conversation } from "../conversation/conversation.js";
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
    conversation: Conversation;
    options?: ModelOptions;
  }): Promise<{ model: LanguageModelV1; modelIdString: string }> {
    const modelIdString = `${params.conversation.modelDetails.provider}/${params.conversation.modelDetails.name}`;

    const validatedModel = await validateModel(params.conversation.modelDetails);
    if (!validatedModel) {
      throw new Error(
        `Invalid model details: ${JSON.stringify(params.conversation.modelDetails)}`
      );
    }
    if (params.conversation.modelDetails.numCtx) {
      validatedModel.numCtx = params.conversation.modelDetails.numCtx;
    }
    if (params.conversation.modelDetails.temperature) {
      validatedModel.temperature = params.conversation.modelDetails.temperature;
    }
    if (params.conversation.modelDetails.topP) {
      validatedModel.topP = params.conversation.modelDetails.topP;
    } 
    if (params.conversation.modelDetails.topK) {
      validatedModel.topK = params.conversation.modelDetails.topK;
    }
    
    params.conversation.modelDetails = validatedModel;

    // this.logModelDetails(modelIdString, {
    //   prompt: params.prompt,
    //   modelDetails: params.conversation.modelDetails,
    //   options: params.conversation.options,
    // });

    const model = await getModel(params.conversation.modelDetails);
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

  async generateText(conversation: Conversation): Promise<ModelResponse> {
    const { startTime, model, modelIdString } =
      await this.startUp(conversation);

    const mergedOptions = {
      maxTokens: this.config.maxTokens,
      ...conversation.options,
    };

    const response = await generateText({
      model: model,
      messages: conversation.getMessages(),
      temperature: conversation.modelDetails.temperature,
      topP: conversation.modelDetails.topP,
      topK: conversation.modelDetails.topK,
      ...mergedOptions,
    });

    return this.makeResult({
      response,
      content: response.text,
      usage: response.usage,
      conversation,
      startTime,
      modelIdString,
    });
  }

  async streamText(conversation: Conversation): Promise<ModelResponse> {
    const { startTime, model, modelIdString } =
      await this.startUp(conversation);
    try {
      const mergedOptions = {
        maxTokens: this.config.maxTokens,
        ...conversation.options,
      };

      const response = await streamText({
        model: model,
        messages: conversation.getMessages(),
        ...mergedOptions,
        temperature: conversation.modelDetails.temperature,
        topP: conversation.modelDetails.topP,
        topK: conversation.modelDetails.topK,  
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
        conversation,
        startTime,
        modelIdString,
      });
    } catch (error) {
      this.handleError(error, modelIdString, "execution");
    }
  }

  async generateObject(
    conversation: Conversation,
    schema: z.ZodSchema
  ): Promise<ModelResponse> {
    const { startTime, model, modelIdString } =
      await this.startUp(conversation);

    const mergedOptions = {
      maxTokens: this.config.maxTokens,
      ...conversation.options,
    };

    const response = await generateObject({
      model: model,
      messages: conversation.getMessages(),
      ...mergedOptions,
      temperature: conversation.modelDetails.temperature,
      topP: conversation.modelDetails.topP,
      topK: conversation.modelDetails.topK,
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
      conversation,
      startTime,
      modelIdString,
    });
  }

  async streamObject(
    conversation: Conversation,
    schema: z.ZodSchema
  ): Promise<ModelResponse> {
    const { startTime, model, modelIdString } =
      await this.startUp(conversation);
    try {
      const mergedOptions = {
        maxTokens: this.config.maxTokens,
        ...conversation.options,
      };

      const response = await streamObject({
        model: model,
        messages: conversation.getMessages(),
        temperature: conversation.modelDetails.temperature,
        topP: conversation.modelDetails.topP,
        topK: conversation.modelDetails.topK,  
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
        conversation,
        startTime,
        modelIdString,
      });
    } catch (error) {
      this.handleError(error, modelIdString, "execution");
    }
  }

  async startUp(
    conversation: Conversation
  ): Promise<{
    startTime: Date;
    model: LanguageModelV1;
    modelIdString: string;
  }> {
    const startTime = new Date();
    const { model, modelIdString } = await this.validateAndPrepareModel({
      conversation: conversation,
      prompt: conversation.prompt,
    });

    return { startTime, model, modelIdString };
  }

  async makeResult({
    response,
    content,
    usage,
    conversation,
    startTime,
    modelIdString,
  }: {
    response: any;
    content: string;
    usage: any;
    conversation: Conversation;
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
      modelDetails: conversation.modelDetails,
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

    conversation.addMessage({
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
        provider: conversation.modelDetails.provider,
        model: conversation.modelDetails.name,
      },
    };

    // console.log("Response object:", response);

    return modelResponse;
  }

  /*
  async stream(conversation: Conversation): Promise<ModelResponse> {
    const startTime = new Date();
    const { model, modelIdString } = await this.validateAndPrepareModel({
      prompt: conversation.prompt,
      modelDetails: conversation.modelDetails,
      options: conversation.options
    });

    try {
      console.log('Streaming messages:')
      

      const responseStream = await streamText({
        model: model,
        messages: conversation.getMessages(),
        ...conversation.options,
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

      const costBreakdown = this.calculateCostBreakdown(usage, { modelDetails: conversation.modelDetails });

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
          provider: conversation.modelDetails.provider,
          model: conversation.modelDetails.name
        }
      };

      return modelResponse;
    } catch (error) {
      this.handleError(error, modelIdString, 'streaming');
    }
  }
*/
}
