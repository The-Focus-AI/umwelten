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
  wrapLanguageModel,
  extractReasoningMiddleware,
  stepCountIs,
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

    const baseModel = await getModel(params.interaction.modelDetails);
    if (!baseModel) {
      throw new Error(`Failed to get LanguageModel for ${modelIdString}`);
    }

    if (!shouldAllowRequest(modelIdString, this.config.rateLimitConfig)) {
      throw new Error("Rate limit exceeded - backoff in progress");
    }

    // Wrap the model with reasoning middleware to extract reasoning tokens
    const model = wrapLanguageModel({
      model: baseModel as any, // Type assertion to handle LanguageModelV1/V2 compatibility
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    });

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
        generateOptions.stopWhen = stepCountIs(interaction.maxSteps);
      }
      if (process.env.DEBUG === '1') {
        console.log("[DEBUG] Passing tools to model (generateText):", Object.keys(interaction.getVercelTools() || {}));
        console.log("[DEBUG] Using stopWhen with maxSteps:", interaction.maxSteps);
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

  async makeStreamOptions(interaction: Interaction): Promise<any> {
    const { startTime, model, modelIdString } = 
      await this.startUp(interaction);
    
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
        onFinish: (event: any) => {
          // console.log(`[onFinish] streamText:`, JSON.stringify(event, null, 2));
        },
      };

      // Enable usage accounting for OpenRouter, GitHub models, and Google
      if (interaction.modelDetails.provider === "openrouter" || interaction.modelDetails.provider === "github-models" || interaction.modelDetails.provider === "google") {
        streamOptions.usage = { include: true };
      }

      if (interaction.hasTools()) {
        streamOptions.tools = interaction.getVercelTools();
        if (interaction.maxSteps) {
          streamOptions.stopWhen = stepCountIs(interaction.maxSteps);
        }
        streamOptions.experimental_toolCallStreaming = true;
        if (process.env.DEBUG === '1') {
          console.log("[DEBUG] Passing tools to model (streamText):", Object.keys(interaction.getVercelTools() || {}));
          console.log("[DEBUG] Using stopWhen with maxSteps:", interaction.maxSteps);
        }
      }
    
    return streamOptions;
  }

  async streamText(interaction: Interaction): Promise<ModelResponse> {
    const { startTime, modelIdString } = 
      await this.startUp(interaction);

    try {

      const streamOptions = await this.makeStreamOptions(interaction);

      const response = await streamText(streamOptions);

      let fullText = '';
      let reasoningText = '';
      let reasoningDetails: any[] = [];
      
      if (response.fullStream) {
        for await (const event of response.fullStream) {
          switch ((event as any).type) {
            case 'text-delta':
              const textDelta = (event as any).textDelta || (event as any).text;
              if (textDelta !== undefined && textDelta !== null) {
                process.stdout.write(textDelta);
                fullText += textDelta;
              }
              break;
            case 'reasoning-start':
              console.log('\n🧠 [REASONING START]');
              break;
            case 'reasoning-delta':
              const reasoningDelta = (event as any).delta;
              if (reasoningDelta !== undefined && reasoningDelta !== null) {
                process.stdout.write(`\x1b[36m${reasoningDelta}\x1b[0m`); // Cyan color for reasoning
                reasoningText += reasoningDelta;
              }
              break;
            case 'reasoning-end':
              console.log('\n🧠 [REASONING END]');
              break;
            case 'reasoning':
              // Handle single reasoning chunk (AI SDK 4.0 style)
              const reasoningChunk = (event as any).text;
              if (reasoningChunk !== undefined && reasoningChunk !== null) {
                console.log('\n🧠 [REASONING]:', reasoningChunk);
                reasoningText += reasoningChunk;
              }
              break;
            case 'tool-call':
              console.log(`\n[TOOL CALL] ${(event as any).toolName} called with:`, (event as any).input);
              break;
            case 'tool-result':
              console.log(`\n[TOOL RESULT] ${(event as any).toolName} result:`, (event as any).output);
              break;
            // Ignore other event types (error, finish, etc.)
            default:
              // console.log(`[DEBUG] Unknown event type: ${(event as any).type}`, event as any);
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
        // console.log(`[DEBUG] Text stream complete1`,fullText);
      } else {
        // fallback: await the full text if streaming is not available
        fullText = await response.text;
        if (fullText !== undefined && fullText !== null) {
          process.stdout.write(fullText);
        }
        // console.log(`[DEBUG] Text stream complete2`,fullText);
      }

      // If no text was captured from streaming, try to get it from the response object
      if (!fullText) {
        // Try different possible locations for the text content
        if (response.text) {
          fullText = await response.text;
        } else if (response.content && Array.isArray(response.content)) {
          // Handle content array (might contain text parts)
          fullText = response.content.map((part: any) => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object' && part.text) return part.text;
            return '';
          }).join('');
        } else if (response.content && typeof response.content === 'string') {
          fullText = response.content;
        }
        
        // If we found text, display it
        if (fullText) {
          console.log('\n[MODEL RESPONSE]:');
          console.log(fullText);
        }
      }

      // Get reasoning from response if available (handle as promise)
      if (response.reasoning) {
        const reasoningResult = await response.reasoning;
        reasoningText = typeof reasoningResult === 'string' ? reasoningResult : JSON.stringify(reasoningResult);
      }

      // For Ollama, usage might be in different locations depending on response type
      let usage = response.usage;
      
      // Debug: Log the response structure for debugging
      if (process.env.DEBUG === '1') {
        console.log(`[DEBUG] ${interaction.modelDetails.provider} response structure:`, JSON.stringify(response, null, 2));
        console.log(`[DEBUG] Usage object before extraction:`, JSON.stringify(usage, null, 2));
      }
      if (interaction.modelDetails.provider === 'ollama') {
        // For streaming responses, usage is in _totalUsage.status.value
        const responseAny = response as any;
        if (responseAny._totalUsage && responseAny._totalUsage.status && responseAny._totalUsage.status.value) {
          usage = responseAny._totalUsage.status.value;
        }
        // For non-streaming responses, usage might be in steps[0].usage
        else if (response.steps) {
          const steps = Array.isArray(response.steps) ? response.steps : await response.steps;
          if (steps && steps[0] && steps[0].usage) {
            usage = steps[0].usage;
          }
        }
      }
      
      // For OpenRouter and Google, usage is in _totalUsage.status.value or steps[0].usage
      if (interaction.modelDetails.provider === 'openrouter' || interaction.modelDetails.provider === 'google') {
        const responseAny = response as any;
        // Check if usage is in _totalUsage.status.value
        if (responseAny._totalUsage && responseAny._totalUsage.status && responseAny._totalUsage.status.value) {
          usage = responseAny._totalUsage.status.value;
        }
        // Check if usage is in steps[0].usage
        else if (responseAny._steps && responseAny._steps.status && responseAny._steps.status.value) {
          const steps = responseAny._steps.status.value;
          if (Array.isArray(steps) && steps[0] && steps[0].usage) {
            usage = steps[0].usage;
          }
        }
      }
      
      // For GitHub models, usage might be in different locations
      if (interaction.modelDetails.provider === 'github-models') {
        const responseAny = response as any;
        // Check if usage is in the response object directly
        if (responseAny.usage) {
          usage = responseAny.usage;
        }
        // Check if usage is in a different property
        else if (responseAny.usage_stats) {
          usage = responseAny.usage_stats;
        }
        // Check if usage is in the response metadata
        else if (responseAny.metadata && responseAny.metadata.usage) {
          usage = responseAny.metadata.usage;
        }
        // Check if usage is in _totalUsage.status.value
        else if (responseAny._totalUsage && responseAny._totalUsage.status && responseAny._totalUsage.status.value) {
          usage = responseAny._totalUsage.status.value;
        }
        // Check if usage is in steps[0].usage
        else if (responseAny._steps && responseAny._steps.status && responseAny._steps.status.value) {
          const steps = responseAny._steps.status.value;
          if (Array.isArray(steps) && steps[0] && steps[0].usage) {
            usage = steps[0].usage;
          }
        }
        // Try to extract from response headers if available
        else if (responseAny._steps && responseAny._steps.status && responseAny._steps.status.value) {
          const steps = responseAny._steps.status.value;
          if (Array.isArray(steps) && steps[0] && steps[0].response && steps[0].response.headers) {
            const headers = steps[0].response.headers;
            // Try to extract token usage from headers
            const inputTokens = headers['x-usage-input-tokens'] || headers['x-usage-prompt-tokens'] || headers['x-ratelimit-used-prompt-tokens'];
            const outputTokens = headers['x-usage-output-tokens'] || headers['x-usage-completion-tokens'] || headers['x-ratelimit-used-completion-tokens'];
            const totalTokens = headers['x-usage-total-tokens'] || headers['x-ratelimit-used-total-tokens'];
            
            if (inputTokens || outputTokens || totalTokens) {
              usage = {
                inputTokens: parseInt(inputTokens) || 0,
                outputTokens: parseInt(outputTokens) || 0,
                totalTokens: parseInt(totalTokens) || (parseInt(inputTokens) || 0) + (parseInt(outputTokens) || 0)
              } as any;
            }
          }
        }
      }
      
      // Debug: Log the final usage object after extraction
      if (process.env.DEBUG === '1') {
        console.log(`[DEBUG] Usage object after extraction:`, JSON.stringify(usage, null, 2));
      }
      
      return this.makeResult({
        response,
        content: fullText,
        reasoning: reasoningText,
        usage: usage,
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
          generateOptions.stopWhen = stepCountIs(interaction.maxSteps);
        }
        if (process.env.DEBUG === '1') {
          console.log("[DEBUG] Passing tools to model (generateObject):", Object.keys(interaction.getVercelTools() || {}));
          console.log("[DEBUG] Using stopWhen with maxSteps:", interaction.maxSteps);
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

      // Enable usage accounting for OpenRouter, GitHub models, and Google
      if (interaction.modelDetails.provider === "openrouter" || interaction.modelDetails.provider === "github-models" || interaction.modelDetails.provider === "google") {
        streamOptions.usage = { include: true };
      }

      if (interaction.hasTools()) {
        streamOptions.tools = interaction.getVercelTools();
        if (interaction.maxSteps) {
          streamOptions.stopWhen = stepCountIs(interaction.maxSteps);
        }
        if (process.env.DEBUG === '1') {
          console.log("[DEBUG] Passing tools to model (streamObject):", Object.keys(interaction.getVercelTools() || {}));
          console.log("[DEBUG] Using stopWhen with maxSteps:", interaction.maxSteps);
        }
      }

      // streamObject returns immediately in AI SDK 4.0+
      const result = streamObject(streamOptions);
      
      // Use partialObjectStream instead of awaiting result.object (which hangs)
      let finalObject: Record<string, any> = {};
      let partialCount = 0;
      
      for await (const partialObject of result.partialObjectStream) {
        partialCount++;
        // Merge partial objects to build the final object
        if (partialObject && typeof partialObject === 'object') {
          finalObject = { ...finalObject, ...partialObject };
        }
        
        // Optional: Log progress for debugging
        if (process.env.DEBUG === '1') {
          console.log(`[DEBUG] Partial object ${partialCount}:`, partialObject ? Object.keys(partialObject) : 'null/undefined');
        }
      }
      
      const objectContent = JSON.stringify(finalObject);
      
      // Print the result for visibility
      process.stdout.write("Streamed object result: " + objectContent + "\n");

      const modelResponse = this.makeResult({
        response: result,
        content: objectContent,
        usage: await result.usage,
        interaction,
        startTime,
        modelIdString,
      });
      
      return modelResponse;
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
      prompt: interaction.stimulus.getPrompt(),
    });

    return { startTime, model, modelIdString };
  }

  async makeResult({
    response,
    content,
    reasoning,
    usage,
    interaction,
    startTime,
    modelIdString,
  }: {
    response: any;
    content: string | unknown;
    reasoning?: string;
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

    // Handle different token usage formats (Vercel AI SDK uses inputTokens/outputTokens, Ollama uses inputTokens/outputTokens)
    const promptTokens = usage?.promptTokens || usage?.inputTokens || usage?.prompt_tokens || usage?.input_tokens;
    const completionTokens = usage?.completionTokens || usage?.outputTokens || usage?.completion_tokens || usage?.output_tokens;
    
    if (
      !usage ||
      promptTokens === undefined ||
      completionTokens === undefined
    ) {
      console.warn(
        `Warning: Usage statistics (prompt/completion tokens) not available for model ${modelIdString}. Cost cannot be calculated.`
      );
      console.warn(`Available usage fields:`, Object.keys(usage || {}));
    }

    // For generateObject, content is the actual object, not a string
    const contentString = typeof content === 'string' ? content : JSON.stringify(content);
    
    interaction.addMessage({
      role: "assistant",
      content: contentString,
    });

    // Handle tool calls and results (they might be promises)
    // For streaming responses, tool calls are in response.steps rather than response.toolCalls
    let toolCalls: any[] = [];
    let toolResults: any[] = [];

    // Try to get tool calls from response.toolCalls first (non-streaming)
    if (response.toolCalls) {
      const resolvedCalls = await response.toolCalls;
      if (Array.isArray(resolvedCalls) && resolvedCalls.length > 0) {
        toolCalls = resolvedCalls;
      }
    }
    if (response.toolResults) {
      const resolvedResults = await response.toolResults;
      if (Array.isArray(resolvedResults) && resolvedResults.length > 0) {
        toolResults = resolvedResults;
      }
    }

    // For streaming responses, extract from steps (Vercel AI SDK pattern)
    if (toolCalls.length === 0 && response.steps) {
      const steps = await response.steps;
      if (Array.isArray(steps)) {
        for (const step of steps) {
          if (step.toolCalls && Array.isArray(step.toolCalls)) {
            toolCalls.push(...step.toolCalls);
          }
          if (step.toolResults && Array.isArray(step.toolResults)) {
            toolResults.push(...step.toolResults);
          }
        }
      }
    }

    const modelResponse: ModelResponse = {
      content: contentString,
      metadata: {
        startTime,
        endTime: new Date(),
        tokenUsage: {
          promptTokens: promptTokens || 0,
          completionTokens: completionTokens || 0,
          total:
            usage?.totalTokens ||
            (promptTokens || 0) + (completionTokens || 0),
        },
        cost: costBreakdown || undefined,
        // costInfo: costBreakdown ? formatCostBreakdown(costBreakdown) : undefined,
        provider: interaction.modelDetails.provider,
        model: interaction.modelDetails.name,
        // Include tool call information if available
        ...(toolCalls.length > 0 && { toolCalls }),
        ...(toolResults.length > 0 && { toolResults }),
      },
      ...(reasoning && { reasoning }),
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
