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
  LanguageModel,
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
  }): Promise<{ model: LanguageModel; modelIdString: string }> {
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
      throw new Error(`Failed to get LanguageModel for ${modelIdString}`);
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
      await this.startUp(interaction);

    const mergedOptions = {
      maxTokens: this.config.maxTokens,
      ...interaction.options,
    };

    const generateOptions: any = {
      model: model,
      messages: interaction.getMessages(),
      temperature: interaction.modelDetails.temperature,
      topP: interaction.modelDetails.topP,
      topK: interaction.modelDetails.topK,
      ...mergedOptions,
      onError: (err: any) => {
        console.error(`[onError] generateText:`, err);
      },
    };

    // Enable usage accounting for OpenRouter
    if (interaction.modelDetails.provider === "openrouter") {
      generateOptions.usage = { include: true };
    }

    // Add tools if available
    if (interaction.hasTools()) {
      generateOptions.tools = interaction.getVercelTools();
      if (interaction.maxSteps) {
        generateOptions.maxSteps = interaction.maxSteps;
      }
      if (process.env.DEBUG === '1') {
        console.log("[DEBUG] Passing tools to model (generateText):", Object.keys(interaction.getVercelTools() || {}));
      }
    }

    const response = await generateText(generateOptions);

    return this.makeResult({
      response,
      content: await response.text,
      usage: response.usage,
      interaction,
      startTime,
      modelIdString,
    });
  }

  async streamText(interaction: Interaction): Promise<ModelResponse> {
    const { startTime, model, modelIdString } =
      await this.startUp(interaction);
    try {
      const mergedOptions = {
        maxTokens: this.config.maxTokens,
        ...interaction.options,
      };

      const streamOptions: any = {
        model: model,
        messages: interaction.getMessages(),
        temperature: interaction.modelDetails.temperature,
        topP: interaction.modelDetails.topP,
        topK: interaction.modelDetails.topK,
        ...mergedOptions,
        onError: (err: any) => {
          console.error(`[onError] streamText:`, err);
        },
      };

      // Enable usage accounting for OpenRouter
      if (interaction.modelDetails.provider === "openrouter") {
        streamOptions.usage = { include: true };
      }

      if (interaction.hasTools()) {
        streamOptions.tools = interaction.getVercelTools();
        if (interaction.maxSteps) {
          streamOptions.maxSteps = interaction.maxSteps;
        }
        if (process.env.DEBUG === '1') {
          console.log("[DEBUG] Passing tools to model (streamText):", Object.keys(interaction.getVercelTools() || {}));
        }
      }

      const response = await streamText(streamOptions);
      let fullText = '';
      if (response.fullStream) {
        for await (const event of response.fullStream) {
          switch ((event as any).type) {
            case 'text-delta':
              const textDelta = (event as any).textDelta;
              if (textDelta !== undefined && textDelta !== null) {
                process.stdout.write(textDelta);
                fullText += textDelta;
              }
              break;
            case 'tool-call':
              console.log(`\n[TOOL CALL] ${(event as any).toolName} called with:`, (event as any).args);
              break;
            case 'tool-result':
              console.log(`\n[TOOL RESULT] ${(event as any).toolName} result:`, (event as any).result);
              break;
            // Ignore other event types (reasoning, error, finish, etc.)
            default:
              break;
          }
        }
      } else if (response.textStream) {
        for await (const textPart of response.textStream) {
          if (textPart !== undefined && textPart !== null) {
            process.stdout.write(textPart);
            fullText += textPart;
          }
        }
      } else {
        // fallback: await the full text if streaming is not available
        fullText = await response.text;
        if (fullText !== undefined && fullText !== null) {
          process.stdout.write(fullText);
        }
      }

      return this.makeResult({
        response,
        content: fullText,
        usage: response.usage,
        interaction,
        startTime,
        modelIdString,
      });
    } catch (err) {
      this.handleError(err, modelIdString, "streamText");
    }
  }

  async generateObject(
    interaction: Interaction,
    schema: z.ZodSchema
  ): Promise<ModelResponse> {
    const { startTime, model, modelIdString } =
      await this.startUp(interaction);
    try {
      const mergedOptions = {
        maxTokens: this.config.maxTokens,
        ...interaction.options,
      };

      const generateOptions: any = {
        model: model,
        messages: interaction.getMessages(),
        schema,
        temperature: interaction.modelDetails.temperature,
        topP: interaction.modelDetails.topP,
        topK: interaction.modelDetails.topK,
        ...mergedOptions,
        onError: (err: any) => {
          console.error(`[onError] generateObject:`, err);
        },
      };

      // Enable usage accounting for OpenRouter
      if (interaction.modelDetails.provider === "openrouter") {
        generateOptions.usage = { include: true };
      }

      if (interaction.hasTools()) {
        generateOptions.tools = interaction.getVercelTools();
        if (interaction.maxSteps) {
          generateOptions.maxSteps = interaction.maxSteps;
        }
        if (process.env.DEBUG === '1') {
          console.log("[DEBUG] Passing tools to model (generateObject):", Object.keys(interaction.getVercelTools() || {}));
        }
      }

      const response = await generateObject(generateOptions);

      return this.makeResult({
        response,
        content: response.object,
        usage: response.usage,
        interaction,
        startTime,
        modelIdString,
      });
    } catch (err) {
      this.handleError(err, modelIdString, "generateObject");
    }
  }

  async streamObject(
    interaction: Interaction,
    schema: z.ZodSchema
  ): Promise<ModelResponse> {
    const { startTime, model, modelIdString } =
      await this.startUp(interaction);
    try {
      const mergedOptions = {
        maxTokens: this.config.maxTokens,
        ...interaction.options,
      };

      const streamOptions: any = {
        model: model,
        messages: interaction.getMessages(),
        schema,
        temperature: interaction.modelDetails.temperature,
        topP: interaction.modelDetails.topP,
        topK: interaction.modelDetails.topK,
        ...mergedOptions,
        onError: (err: any) => {
          console.error(`[onError] streamObject:`, err);
        },
      };

      // Enable usage accounting for OpenRouter
      if (interaction.modelDetails.provider === "openrouter") {
        streamOptions.usage = { include: true };
      }

      if (interaction.hasTools()) {
        streamOptions.tools = interaction.getVercelTools();
        if (interaction.maxSteps) {
          streamOptions.maxSteps = interaction.maxSteps;
        }
        if (process.env.DEBUG === '1') {
          console.log("[DEBUG] Passing tools to model (streamObject):", Object.keys(interaction.getVercelTools() || {}));
        }
      }

      const response = await streamObject(streamOptions);

      return this.makeResult({
        response,
        content: String(await response.object),
        usage: response.usage,
        interaction,
        startTime,
        modelIdString,
      });
    } catch (err) {
      this.handleError(err, modelIdString, "streamObject");
    }
  }

  async startUp(
    interaction: Interaction
  ): Promise<{
    startTime: Date;
    model: LanguageModel;
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
    content: string | unknown;
    usage: any;
    interaction: Interaction;
    startTime: Date;
    modelIdString: string;
  }) {
    updateRateLimitState(
      modelIdString,
      true,
      undefined,
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

    // For generateObject, content is the actual object, not a string
    const contentString = typeof content === 'string' ? content : JSON.stringify(content);
    
    interaction.addMessage({
      role: "assistant",
      content: contentString,
    });

    const modelResponse: ModelResponse = {
      content: contentString,
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
