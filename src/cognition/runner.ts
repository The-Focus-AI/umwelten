import {
  ModelDetails,
  ModelOptions,
  ModelResponse,
  ModelRunner,
} from "./types.js";
import { buildRequestOptions } from "./request-options.js";
import { RateLimitConfig } from "../rate-limit/rate-limit.js";
import {
  shouldAllowRequest,
  getRateLimitState,
  updateRateLimitState,
  clearRateLimitState,
} from "../rate-limit/rate-limit.js";
import {
  type CoreMessage,
  LanguageModel,
  generateText,
  generateObject,
  streamObject,
  streamText,
  wrapLanguageModel,
  extractReasoningMiddleware,
} from "ai";
import { getModel, validateModel } from "../providers/index.js";
import { normalizeTokenUsage, calculateCostBreakdown } from "./usage-extractor.js";

import { Interaction } from "../interaction/core/interaction.js";
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
    },
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
    action: string,
  ): never {
    updateRateLimitState(
      modelIdString,
      false,
      error,
      error.response?.headers,
      this.config.rateLimitConfig,
    );

    if (error instanceof Error) {
      console.error(
        `Error during model ${action} for ${modelIdString}:`,
        error,
      );
      throw new Error(`Model ${action} failed: ${error.message}`);
    }
    console.error(
      `Unknown error during model ${action} for ${modelIdString}:`,
      error,
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
        `Invalid model details: ${JSON.stringify(params.interaction.modelDetails)}`,
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

    // Wrap the model with reasoning middleware to extract reasoning tokens.
    // Skip for Google models — they handle reasoning natively via thinkingConfig/includeThoughts.
    // The extractReasoningMiddleware looks for <think> XML tags which interferes with native reasoning.
    let model: any;
    if (params.interaction.modelDetails.provider === "google") {
      model = baseModel;
    } else {
      model = wrapLanguageModel({
        model: baseModel as any,
        middleware: extractReasoningMiddleware({ tagName: "think" }),
      });
    }

    return { model, modelIdString };
  }

  async generateText(interaction: Interaction): Promise<ModelResponse> {
    const { startTime, model, modelIdString } = await this.startUp(interaction);

    const generateOptions = buildRequestOptions({
      interaction,
      model,
      config: this.config,
      label: "generateText",
      streaming: false,
    });

    const response = await generateText(
      generateOptions as Parameters<typeof generateText>[0],
    );

    const usage = await Promise.resolve(response.usage);

    return this.makeResult({
      response,
      content: await response.text,
      usage,
      interaction,
      startTime,
      modelIdString,
    });
  }

  async makeStreamOptions(
    interaction: Interaction,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const { model } = await this.startUp(interaction);

    return buildRequestOptions({
      interaction,
      model,
      config: this.config,
      label: "streamText",
      streaming: true,
      abortSignal: signal,
    });
  }

  async streamText(
    interaction: Interaction,
    signal?: AbortSignal,
  ): Promise<ModelResponse> {
    const { startTime, modelIdString } = await this.startUp(interaction);

    try {
      const streamOptions = await this.makeStreamOptions(interaction, signal);

      const response = await streamText(
        streamOptions as Parameters<typeof streamText>[0],
      );

      let fullText = "";
      let reasoningText = "";
      let reasoningDetails: any[] = [];
      const pendingToolCalls: any[] = [];

      if (response.fullStream) {
        for await (const event of response.fullStream) {
          const ev = event as any;
          // Debug: Log all event types (including text-delta for reasoning debug)
          if (process.env.DEBUG === "1") {
            console.log(`[DEBUG] Event type: ${ev.type}`, ev);
          }
          switch (ev.type) {
            case "text-delta":
              const textDelta = ev.textDelta || ev.text;
              if (textDelta !== undefined && textDelta !== null) {
                process.stdout.write(textDelta);
                fullText += textDelta;
              }
              break;
            case "reasoning-start":
              console.log("\n🧠 [REASONING START]");
              break;
            case "reasoning-delta":
              const reasoningDelta = ev.delta ?? ev.textDelta ?? ev.text;
              if (
                reasoningDelta !== undefined &&
                reasoningDelta !== null &&
                reasoningDelta !== "" &&
                typeof reasoningDelta === "string"
              ) {
                // Only write printable ASCII characters to avoid garbled output
                const cleanDelta = reasoningDelta.replace(
                  /[^\x20-\x7E\s]/g,
                  "",
                );
                if (cleanDelta) {
                  process.stdout.write(`\x1b[36m${cleanDelta}\x1b[0m`); // Cyan color for reasoning
                  reasoningText += cleanDelta;
                }
              }
              break;
            case "reasoning-end":
              console.log("\n🧠 [REASONING END]");
              break;
            case "reasoning":
              const reasoningChunk = ev.text;
              if (reasoningChunk !== undefined && reasoningChunk !== null) {
                console.log("\n🧠 [REASONING]:", reasoningChunk);
                reasoningText += reasoningChunk;
              }
              break;
            case "tool-call":
              console.log(
                `\n[TOOL CALL] ${ev.toolName} called with:`,
                ev.input,
              );
              // Capture provider metadata (e.g. Google thought_signature) so we can send it back next turn
              const providerMeta =
                ev.experimental_providerMetadata ??
                ev.providerMetadata ??
                undefined;
              pendingToolCalls.push({
                toolCallId: ev.toolCallId ?? ev.id,
                toolName: ev.toolName ?? ev.name,
                input: ev.input ?? ev.args ?? {},
                experimental_providerMetadata: providerMeta,
              });
              break;
            case "tool-result":
              console.log(`\n[TOOL RESULT] ${ev.toolName} result:`, ev.output);
              if (pendingToolCalls.length > 0) {
                interaction.addMessage({
                  role: "assistant",
                  content: pendingToolCalls.map((tc: any) => {
                    const part: Record<string, unknown> = {
                      type: "tool-call",
                      toolCallId: tc.toolCallId ?? tc.id,
                      toolName: tc.toolName ?? tc.name,
                      input: tc.input ?? tc.args ?? {},
                    };
                    // providerOptions is the ModelMessage schema field (e.g. for Gemini thought_signature)
                    if (tc.experimental_providerMetadata != null) {
                      part.providerOptions = tc.experimental_providerMetadata;
                    }
                    return part;
                  }),
                } as unknown as CoreMessage);
                pendingToolCalls.length = 0;
                interaction.notifyTranscriptUpdate?.();
              }
              const out = ev.result ?? ev.output;
              const output =
                ev.isError === true
                  ? {
                      type: "error-text" as const,
                      value:
                        typeof out === "string"
                          ? out
                          : JSON.stringify(out ?? ""),
                    }
                  : typeof out === "string"
                    ? { type: "text" as const, value: out }
                    : { type: "json" as const, value: out };
              interaction.addMessage({
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: ev.toolCallId ?? ev.id,
                    toolName: ev.toolName ?? ev.name ?? "",
                    output,
                  },
                ],
              } as unknown as CoreMessage);
              interaction.notifyTranscriptUpdate?.();
              break;
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
      if (!fullText && response.text) {
        fullText = await response.text;

        // If we found text, display it
        if (fullText) {
          console.log("\n[MODEL RESPONSE]:");
          console.log(fullText);
        }
      }

      // Get reasoning from response if available (handle as promise)
      if (response.reasoning) {
        const reasoningResult = await response.reasoning;
        reasoningText =
          typeof reasoningResult === "string"
            ? reasoningResult
            : JSON.stringify(reasoningResult);
      }

      // Resolve usage (streamText can return usage as a Promise)
      let usage = await Promise.resolve(response.usage);

      // Debug: Log the response structure for debugging
      if (process.env.DEBUG === "1") {
        console.log(
          `[DEBUG] ${interaction.modelDetails.provider} response structure:`,
          JSON.stringify(response, null, 2),
        );
        console.log(
          `[DEBUG] Usage object before extraction:`,
          JSON.stringify(usage, null, 2),
        );
      }
      if (interaction.modelDetails.provider === "ollama") {
        // For streaming responses, usage is in _totalUsage.status.value
        const responseAny = response as any;
        if (
          responseAny._totalUsage &&
          responseAny._totalUsage.status &&
          responseAny._totalUsage.status.value
        ) {
          usage = responseAny._totalUsage.status.value;
        }
        // For non-streaming responses, usage might be in steps[0].usage
        else if (response.steps) {
          const steps = Array.isArray(response.steps)
            ? response.steps
            : await response.steps;
          if (steps && steps[0] && steps[0].usage) {
            usage = steps[0].usage;
          }
        }
      }

      // For OpenRouter, MiniMax, and Google, usage is in _totalUsage (may be Promise) or steps[0].usage
      if (
        interaction.modelDetails.provider === "openrouter" ||
        interaction.modelDetails.provider === "minimax" ||
        interaction.modelDetails.provider === "google"
      ) {
        const responseAny = response as any;
        const totalUsage = responseAny._totalUsage;
        if (totalUsage != null) {
          const resolvedTotal = await Promise.resolve(totalUsage);
          if (resolvedTotal?.status?.value != null) {
            const val = resolvedTotal.status.value;
            if (typeof val === "object" && val !== null && Object.keys(val).length > 0) {
              usage = val;
            }
          }
        }
        if (
          !usage ||
          (typeof usage === "object" && JSON.stringify(usage) === "{}")
        ) {
          const stepsVal = responseAny._steps;
          if (stepsVal != null) {
            const steps = await Promise.resolve(
              stepsVal?.status?.value ?? stepsVal
            );
            const arr = Array.isArray(steps) ? steps : undefined;
            if (arr?.[0]?.usage != null) {
              usage = arr[0].usage;
            }
          }
        }
        // Force getter-backed usage into a plain object (spread invokes getters)
        if (usage && typeof usage === "object" && Object.keys(usage).length > 0) {
          try {
            const spread = { ...usage };
            if (Object.keys(spread).length > 0 && JSON.stringify(spread) !== "{}") {
              usage = spread;
            }
          } catch {
            // ignore
          }
        }
      }

      // For GitHub models, usage might be in different locations
      if (interaction.modelDetails.provider === "github-models") {
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
        else if (
          responseAny._totalUsage &&
          responseAny._totalUsage.status &&
          responseAny._totalUsage.status.value
        ) {
          usage = responseAny._totalUsage.status.value;
        }
        // Check if usage is in steps[0].usage
        else if (
          responseAny._steps &&
          responseAny._steps.status &&
          responseAny._steps.status.value
        ) {
          const steps = responseAny._steps.status.value;
          if (Array.isArray(steps) && steps[0] && steps[0].usage) {
            usage = steps[0].usage;
          }
        }
        // Try to extract from response headers if available
        else if (
          responseAny._steps &&
          responseAny._steps.status &&
          responseAny._steps.status.value
        ) {
          const steps = responseAny._steps.status.value;
          if (
            Array.isArray(steps) &&
            steps[0] &&
            steps[0].response &&
            steps[0].response.headers
          ) {
            const headers = steps[0].response.headers;
            // Try to extract token usage from headers
            const inputTokens =
              headers["x-usage-input-tokens"] ||
              headers["x-usage-prompt-tokens"] ||
              headers["x-ratelimit-used-prompt-tokens"];
            const outputTokens =
              headers["x-usage-output-tokens"] ||
              headers["x-usage-completion-tokens"] ||
              headers["x-ratelimit-used-completion-tokens"];
            const totalTokens =
              headers["x-usage-total-tokens"] ||
              headers["x-ratelimit-used-total-tokens"];

            if (inputTokens || outputTokens || totalTokens) {
              usage = {
                inputTokens: parseInt(inputTokens) || 0,
                outputTokens: parseInt(outputTokens) || 0,
                totalTokens:
                  parseInt(totalTokens) ||
                  (parseInt(inputTokens) || 0) + (parseInt(outputTokens) || 0),
              } as any;
            }
          }
        }
      }

      // If extraction didn't find usage, use resolved response.usage (streaming may only set it here)
      if (
        (!usage || typeof usage !== "object" || (usage && Object.keys(usage).length === 0)) &&
        response.usage != null
      ) {
        const resolved = await Promise.resolve(response.usage);
        if (resolved && typeof resolved === "object" && Object.keys(resolved).length > 0) {
          usage = resolved;
        }
      }

      const debugUsage = process.env.DEBUG_USAGE === "1" || process.env.DEBUG === "1";
      if (debugUsage) {
        const responseAny = response as any;
        console.error("[DEBUG_USAGE] streamText usage source:", {
          hasUsage: !!usage,
          usageKeys: usage ? Object.keys(usage) : [],
          usageSnapshot:
            usage && typeof usage === "object"
              ? JSON.stringify(usage, null, 2)
              : String(usage),
          hasTotalUsage: !!responseAny._totalUsage?.status?.value,
          hasSteps: !!responseAny._steps?.status?.value,
        });
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
    schema: z.ZodSchema,
  ): Promise<ModelResponse> {
    const { startTime, model, modelIdString } = await this.startUp(interaction);
    try {
      const generateOptions = buildRequestOptions({
        interaction,
        model,
        config: this.config,
        label: "generateObject",
        streaming: false,
        schema,
      });

      const response = await generateObject(
        generateOptions as Parameters<typeof generateObject>[0],
      );

      const usage = await Promise.resolve(response.usage);

      return this.makeResult({
        response,
        content: response.object,
        usage,
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
    schema: z.ZodSchema,
  ): Promise<ModelResponse> {
    const { startTime, model, modelIdString } = await this.startUp(interaction);
    try {
      const streamOptions = buildRequestOptions({
        interaction,
        model,
        config: this.config,
        label: "streamObject",
        streaming: true,
        schema,
      });

      // streamObject returns immediately in AI SDK 4.0+
      const result = streamObject(
        streamOptions as Parameters<typeof streamObject>[0],
      );

      // Use partialObjectStream instead of awaiting result.object (which hangs)
      let finalObject: Record<string, any> = {};
      let partialCount = 0;

      for await (const partialObject of result.partialObjectStream) {
        partialCount++;
        // Merge partial objects to build the final object
        if (partialObject && typeof partialObject === "object") {
          finalObject = { ...finalObject, ...partialObject };
        }

        // Optional: Log progress for debugging
        if (process.env.DEBUG === "1") {
          console.log(
            `[DEBUG] Partial object ${partialCount}:`,
            partialObject ? Object.keys(partialObject) : "null/undefined",
          );
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

  async startUp(interaction: Interaction): Promise<{
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
    // Snapshot usage if it's a Proxy/getter object (has keys but JSON.stringify returns {})
    if (usage && typeof usage === "object") {
      const keys = Object.keys(usage);
      if (keys.length > 0 && JSON.stringify(usage) === "{}") {
        const known = [
          "inputTokens",
          "outputTokens",
          "totalTokens",
          "reasoningTokens",
          "cachedInputTokens",
          "promptTokens",
          "completionTokens",
          "prompt_tokens",
          "completion_tokens",
          "total_tokens",
        ];
        const snapshot: Record<string, unknown> = {};
        for (const k of known) {
          const v = (usage as Record<string, unknown>)[k];
          if (v !== undefined && v !== null) snapshot[k] = v;
        }
        for (const k of keys) {
          if (!(k in snapshot)) {
            const v = (usage as Record<string, unknown>)[k];
            if (v !== undefined && v !== null) snapshot[k] = v;
          }
        }
        usage = snapshot;
      }
    }

    updateRateLimitState(
      modelIdString,
      true,
      undefined,
      undefined,
      this.config.rateLimitConfig,
    );

    const costBreakdown = calculateCostBreakdown(usage, {
      modelDetails: interaction.modelDetails,
    });

    const normalizedUsage = normalizeTokenUsage(usage);

    const debugUsage = process.env.DEBUG_USAGE === "1" || process.env.DEBUG === "1";
    if (debugUsage) {
      console.error("[DEBUG_USAGE] makeResult usage:", {
        rawKeys: usage ? Object.keys(usage) : [],
        rawSnapshot:
          usage && typeof usage === "object"
            ? JSON.stringify(usage, null, 2)
            : String(usage),
        normalized: normalizedUsage
          ? {
              promptTokens: normalizedUsage.promptTokens,
              completionTokens: normalizedUsage.completionTokens,
              total: normalizedUsage.total,
            }
          : null,
      });
    }

    if (!normalizedUsage) {
      console.warn(
        `Warning: Usage statistics (prompt/completion tokens) not available for model ${modelIdString}. Cost cannot be calculated.`,
      );
      console.warn(`Available usage fields:`, Object.keys(usage || {}));
      if (debugUsage && usage && typeof usage === "object") {
        console.warn(`Usage values:`, JSON.stringify(usage, null, 2));
      }
    }

    // For generateObject, content is the actual object, not a string
    const contentString =
      typeof content === "string" ? content : JSON.stringify(content);

    // SDK ToolResultPart expects output: { type: 'text'|'json'|'error-text', value }
    function toToolResultOutput(
      result: unknown,
      isError?: boolean,
    ): { type: "text" | "json" | "error-text"; value: string | unknown } {
      if (isError) {
        return {
          type: "error-text",
          value:
            typeof result === "string" ? result : JSON.stringify(result ?? ""),
        };
      }
      return typeof result === "string"
        ? { type: "text", value: result }
        : { type: "json", value: result };
    }

    // Resolve tool calls and results (they might be promises)
    let toolCalls: any[] = [];
    let toolResults: any[] = [];
    let steps: any[] = [];

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
    if (response.steps) {
      const resolvedSteps = await response.steps;
      if (Array.isArray(resolvedSteps)) {
        steps = resolvedSteps;
        if (toolCalls.length === 0) {
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
    }

    // If we already added tool messages during streamText (streaming), only add final assistant text
    const messages = interaction.getMessages();
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    const afterLastUser = messages.slice(lastUserIdx + 1);
    const alreadyHasToolMessages = afterLastUser.some((m) => m.role === "tool");

    if (alreadyHasToolMessages) {
      if (contentString) {
        interaction.addMessage({ role: "assistant", content: contentString });
        interaction.notifyTranscriptUpdate?.();
      }
    } else if (steps.length > 0) {
      // Append full conversation to interaction.messages (Claude Code style: user, assistant+tool_use, tool results, ..., final assistant)
      for (const step of steps) {
        const stepCalls =
          step.toolCalls && Array.isArray(step.toolCalls) ? step.toolCalls : [];
        const stepResults =
          step.toolResults && Array.isArray(step.toolResults)
            ? step.toolResults
            : [];
        const stepText =
          step.text != null
            ? typeof step.text === "string"
              ? step.text
              : String(step.text)
            : "";
        if (stepCalls.length > 0) {
          interaction.addMessage({
            role: "assistant",
            content: stepText
              ? [
                  { type: "text", text: stepText },
                  ...stepCalls.map((tc: any) => ({
                    type: "tool-call",
                    toolCallId: tc.toolCallId ?? tc.id,
                    toolName: tc.toolName ?? tc.name,
                    input: tc.input ?? tc.args ?? {},
                  })),
                ]
              : stepCalls.map((tc: any) => ({
                  type: "tool-call",
                  toolCallId: tc.toolCallId ?? tc.id,
                  toolName: tc.toolName ?? tc.name,
                  input: tc.input ?? tc.args ?? {},
                })),
          });
          interaction.notifyTranscriptUpdate?.();
        } else if (stepText) {
          interaction.addMessage({ role: "assistant", content: stepText });
          interaction.notifyTranscriptUpdate?.();
        }
        if (stepResults.length > 0) {
          const resultMap = new Map(
            stepResults.map((tr: any) => [tr.toolCallId ?? tr.id, tr]),
          );
          for (const tc of stepCalls) {
            const id = tc.toolCallId ?? tc.id;
            const tr = resultMap.get(id) as any;
            if (tr != null) {
              const out = tr.result ?? tr.output;
              interaction.addMessage({
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: id,
                    toolName: tr.toolName ?? tc.toolName ?? "",
                    output: toToolResultOutput(out, tr.isError ?? false),
                  },
                ],
              } as unknown as CoreMessage);
              interaction.notifyTranscriptUpdate?.();
            }
          }
        }
      }
      // Final assistant text only if last step had no text (e.g. last step was tool-only)
      const lastStep = steps[steps.length - 1];
      const lastStepText = lastStep?.text != null ? String(lastStep.text) : "";
      if (contentString && lastStepText !== contentString) {
        interaction.addMessage({ role: "assistant", content: contentString });
        interaction.notifyTranscriptUpdate?.();
      }
    } else if (toolCalls.length > 0) {
      interaction.addMessage({
        role: "assistant",
        content: toolCalls.map((tc: any) => ({
          type: "tool-call",
          toolCallId: tc.toolCallId ?? tc.id,
          toolName: tc.toolName ?? tc.name,
          input: tc.input ?? tc.args ?? {},
        })),
      } as unknown as CoreMessage);
      interaction.notifyTranscriptUpdate?.();
      const resultMap = new Map(
        (toolResults as any[]).map((tr: any) => [tr.toolCallId ?? tr.id, tr]),
      );
      for (const tc of toolCalls) {
        const id = tc.toolCallId ?? tc.id;
        const tr = resultMap.get(id) as any;
        if (tr != null) {
          const out = tr.result ?? tr.output;
          interaction.addMessage({
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: id,
                toolName: (tr as any).toolName ?? (tc as any).toolName ?? "",
                output: toToolResultOutput(out, tr.isError ?? false),
              },
            ],
          } as unknown as CoreMessage);
          interaction.notifyTranscriptUpdate?.();
        }
      }
      if (contentString) {
        interaction.addMessage({ role: "assistant", content: contentString });
        interaction.notifyTranscriptUpdate?.();
      }
    } else {
      interaction.addMessage({
        role: "assistant",
        content: contentString,
      });
      interaction.notifyTranscriptUpdate?.();
    }

    const modelResponse: ModelResponse = {
      content: contentString,
      metadata: {
        startTime,
        endTime: new Date(),
        tokenUsage: {
          promptTokens: normalizedUsage?.promptTokens ?? 0,
          completionTokens: normalizedUsage?.completionTokens ?? 0,
          total: normalizedUsage?.total ?? 0,
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

      const costBreakdown = calculateCostBreakdown(usage, { modelDetails: interaction.modelDetails });

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
