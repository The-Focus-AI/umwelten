import {
  ModelDetails,
  ModelOptions,
  ModelResponse,
  ModelRunner,
  StreamObserver,
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
import {
  normalizeTokenUsage,
  calculateCostBreakdown,
  extractStreamUsage,
} from "./usage-extractor.js";
import { assembleSteps } from "./step-assembler.js";

import { Interaction } from "../interaction/core/interaction.js";
import { z } from "zod";

export interface ModelRunnerConfig {
  rateLimitConfig?: RateLimitConfig;
  maxRetries?: number;
  // Intentionally no `maxTokens`/`maxOutputTokens` field. This runner
  // powers benchmarks that measure model quality — truncating generation
  // silently invalidates scores (especially for thinking-on models that
  // need room to reason). If a caller needs a cap for a specific task,
  // set it on the Stimulus so it appears in request metadata and is
  // visible per-call. See CLAUDE.md "Token limits" rule.
}

const DEFAULT_CONFIG: ModelRunnerConfig = {
  maxRetries: 3,
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

  async generateText(
    interaction: Interaction,
    signal?: AbortSignal,
  ): Promise<ModelResponse> {
    const { startTime, model, modelIdString } = await this.startUp(interaction);

    const generateOptions = buildRequestOptions({
      interaction,
      model,
      config: this.config,
      label: "generateText",
      streaming: false,
      abortSignal: signal,
    });

    const response = await generateText(
      generateOptions as Parameters<typeof generateText>[0],
    );

    const usage = await Promise.resolve(response.usage);

    // AI SDK v5 exposes extracted reasoning on `reasoningText` when the
    // reasoning middleware fires (e.g. <think>…</think> from local
    // models). Preserve it so downstream consumers can inspect and score
    // the model's chain of thought.
    const reasoningText =
      typeof (response as any).reasoningText === "string"
        ? (response as any).reasoningText
        : undefined;

    return this.makeResult({
      response,
      content: await response.text,
      reasoning: reasoningText,
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
    observer?: StreamObserver,
  ): Promise<ModelResponse> {
    const { startTime, modelIdString } = await this.startUp(interaction);

    // Hoisted so the catch block can salvage partial content when the
    // stream is aborted mid-generation (e.g. by a watchdog timeout).
    // Without this, abort errors discard everything the model emitted
    // before the abort fired.
    let fullText = "";
    let reasoningText = "";
    let reasoningDetails: any[] = [];

    try {
      const streamOptions = await this.makeStreamOptions(interaction, signal);

      const response = await streamText(
        streamOptions as Parameters<typeof streamText>[0],
      );

      const pendingToolCalls: any[] = [];

      if (response.fullStream) {
        for await (const event of response.fullStream) {
          const ev = event as any;
          if (process.env.DEBUG === "1") {
            console.log(`[DEBUG] Event type: ${ev.type}`, ev);
          }
          switch (ev.type) {
            case "text-delta": {
              const textDelta = ev.textDelta || ev.text;
              if (textDelta !== undefined && textDelta !== null) {
                fullText += textDelta;
                observer?.onTextDelta?.(textDelta);
              }
              break;
            }
            case "reasoning-start":
              break;
            case "reasoning-delta": {
              const reasoningDelta = ev.delta ?? ev.textDelta ?? ev.text;
              if (
                reasoningDelta !== undefined &&
                reasoningDelta !== null &&
                reasoningDelta !== "" &&
                typeof reasoningDelta === "string"
              ) {
                reasoningText += reasoningDelta;
                observer?.onReasoningDelta?.(reasoningDelta);
              }
              break;
            }
            case "reasoning-end":
              break;
            case "reasoning": {
              const reasoningChunk = ev.text;
              if (reasoningChunk !== undefined && reasoningChunk !== null) {
                reasoningText += reasoningChunk;
                observer?.onReasoningDelta?.(reasoningChunk);
              }
              break;
            }
            case "tool-call": {
              const providerMeta =
                ev.experimental_providerMetadata ??
                ev.providerMetadata ??
                undefined;
              const toolCallId = ev.toolCallId ?? ev.id;
              const toolName = ev.toolName ?? ev.name;
              const input = ev.input ?? ev.args ?? {};
              pendingToolCalls.push({
                toolCallId,
                toolName,
                input,
                experimental_providerMetadata: providerMeta,
              });
              observer?.onToolCall?.({ toolCallId, toolName, input });
              break;
            }
            case "tool-result": {
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
              const isError = ev.isError === true;
              const output =
                isError
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
              const toolCallId = ev.toolCallId ?? ev.id;
              const toolName = ev.toolName ?? ev.name ?? "";
              interaction.addMessage({
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId,
                    toolName,
                    output,
                  },
                ],
              } as unknown as CoreMessage);
              interaction.notifyTranscriptUpdate?.();
              observer?.onToolResult?.({
                toolCallId,
                toolName,
                output: out,
                isError,
              });
              break;
            }
            default:
              break;
          }
        }
      } else if (response.textStream) {
        for await (const textPart of response.textStream) {
          if (textPart !== undefined && textPart !== null) {
            fullText += textPart;
            observer?.onTextDelta?.(textPart);
          }
        }
      } else {
        // fallback: await the full text if streaming is not available
        fullText = await response.text;
        if (fullText !== undefined && fullText !== null) {
          observer?.onTextDelta?.(fullText);
        }
      }

      // If no text was captured from streaming, try to get it from the response object
      if (!fullText && response.text) {
        fullText = await response.text;
        if (fullText) {
          observer?.onTextDelta?.(fullText);
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
      const initialUsage = await Promise.resolve(response.usage);

      // Debug: Log the response structure for debugging
      if (process.env.DEBUG === "1") {
        console.log(
          `[DEBUG] ${interaction.modelDetails.provider} response structure:`,
          JSON.stringify(response, null, 2),
        );
        console.log(
          `[DEBUG] Usage object before extraction:`,
          JSON.stringify(initialUsage, null, 2),
        );
      }

      // Provider-specific dig into AI-SDK proxy/getter shapes
      // (see extractStreamUsage docstring).
      let usage = await extractStreamUsage(
        response,
        initialUsage,
        interaction.modelDetails.provider,
      );

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
    } catch (err: any) {
      // If the caller aborted (watchdog timeout), salvage whatever was
      // accumulated before the abort fired — including reasoning-only
      // output, which is the typical pattern for Gemma stuck in <think>
      // loops with no final answer. Preserving an empty content + filled
      // reasoning is still useful: it tells the report "model burned N
      // tokens thinking but produced nothing."
      //
      // Heuristic for "aborted": explicit AbortError, our signal flagged,
      // or message text matches abort/timeout. AI SDK's exact error shape
      // varies by provider, so we fall through to all of them.
      const aborted =
        err?.name === "AbortError" ||
        signal?.aborted === true ||
        /aborted|AbortError|timeout/i.test(err?.message ?? "");
      if (aborted) {
        // Approximate completion tokens from accumulated text length.
        // Stream usage isn't queryable mid-stream, so this is the best
        // signal we have for "how much did the model produce before
        // the abort." ~4 chars/token is the standard heuristic.
        const approxCompletionTokens =
          Math.round((fullText.length + reasoningText.length) / 4);
        const partialResponse: ModelResponse = {
          content: fullText,
          metadata: {
            startTime,
            endTime: new Date(),
            tokenUsage: {
              promptTokens: 0,
              completionTokens: approxCompletionTokens,
              total: approxCompletionTokens,
            },
            cost: undefined as any,
            provider: interaction.modelDetails.provider,
            model: interaction.modelDetails.name,
            partial: true,
            partialReason: err?.message ?? "aborted",
            partialApproxTokens: approxCompletionTokens,
            partialReasoningChars: reasoningText.length,
            partialContentChars: fullText.length,
          } as any,
          ...(reasoningText && { reasoning: reasoningText }),
          // For partials the runner doesn't append a final assistant
          // message (no completion happened). Snapshot what we have —
          // system + user (+ any tool turns) — so 2-pass / replay can
          // construct a follow-up turn even from an aborted run.
          messages: interaction.getMessages().slice(),
        };
        return partialResponse;
      }
      this.handleError(err, modelIdString, "streamText");
    }
  }

  async generateObject(
    interaction: Interaction,
    schema: z.ZodSchema,
    signal?: AbortSignal,
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
        abortSignal: signal,
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
    signal?: AbortSignal,
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
        abortSignal: signal,
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

    const { toolCalls, toolResults } = await assembleSteps({
      response,
      contentString,
      interaction,
    });

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
        provider: interaction.modelDetails.provider,
        model: interaction.modelDetails.name,
        ...(toolCalls.length > 0 && { toolCalls }),
        ...(toolResults.length > 0 && { toolResults }),
      },
      ...(reasoning && { reasoning }),
      // Snapshot the conversation as it stands at end of generation.
      // step-assembler appends the final assistant message before this
      // returns, so getMessages() now contains system → user → assistant
      // (plus any tool turns). Slice to defensively copy — interaction
      // may keep mutating after this returns.
      messages: interaction.getMessages().slice(),
    };

    return modelResponse;
  }
}
