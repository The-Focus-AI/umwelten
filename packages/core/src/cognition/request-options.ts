import {
  type CoreMessage,
  type LanguageModel,
  type ToolSet,
  type JSONValue,
  stepCountIs,
} from "ai";
import type { z } from "zod";
import type { Interaction } from "../interaction/core/interaction.js";
import {
  buildReasoningProviderOptions,
  buildUserProviderOptions,
  mergeProviderOptions,
} from "./provider-options.js";
import {
  normalizeToModelMessages,
  ensureGoogleThoughtSignatures,
} from "./message-normalizer.js";

interface RequestOptionsInput {
  interaction: Interaction;
  model: LanguageModel;
  /**
   * Reserved for future per-request config (retries, etc). Intentionally
   * does NOT include `maxTokens`/`maxOutputTokens` — see
   * buildRequestOptions() below and CLAUDE.md "Token limits" rule.
   */
  config: object;
  label: string;
  streaming: boolean;
  abortSignal?: AbortSignal;
  schema?: z.ZodSchema;
}

type ProviderOptions = Record<string, Record<string, JSONValue>>;

const GENERATE_USAGE_PROVIDERS = new Set(["openrouter", "minimax"]);
const STREAM_USAGE_PROVIDERS = new Set([
  "openrouter",
  "github-models",
  "google",
  "minimax",
]);

export function buildRequestOptions(input: RequestOptionsInput): Record<string, unknown> {
  const { interaction, model, config, label, streaming, abortSignal, schema } =
    input;
  const provider = interaction.modelDetails.provider;

  let messages = interaction.getMessages();
  messages = normalizeToModelMessages(messages);
  if (provider === "google") {
    messages = ensureGoogleThoughtSignatures(messages);
  }

  // DO NOT cap output tokens here. This runner powers benchmarks that
  // measure model quality — truncating generation silently invalidates
  // scores (especially for thinking-on models that need room to reason).
  // If a specific caller wants a cap, it must set it on the Stimulus.
  // See CLAUDE.md for the rule and cognition/request-options.test.ts for
  // the regression guard.
  const options: Record<string, unknown> = {
    model,
    messages,
    temperature: interaction.modelDetails.temperature,
    topP: interaction.modelDetails.topP,
    topK: interaction.modelDetails.topK,
    ...interaction.options,
    onError: (err: unknown) => {
      console.error(`[onError] ${label}:`, err);
    },
  };

  if (abortSignal) {
    options.abortSignal = abortSignal;
  }

  if (schema) {
    options.schema = schema;
  }

  // Enable usage accounting — streaming methods include more providers
  const usageProviders = streaming
    ? STREAM_USAGE_PROVIDERS
    : GENERATE_USAGE_PROVIDERS;
  if (usageProviders.has(provider)) {
    options.usage = { include: true };
  }

  // Build providerOptions (reasoning + user tracking)
  let providerOptions: ProviderOptions | undefined;

  const reasoningOpts = buildReasoningProviderOptions(
    provider,
    interaction.modelDetails.reasoningEffort,
  );
  if (reasoningOpts) {
    providerOptions = reasoningOpts as ProviderOptions;
  }

  const userOpts = buildUserProviderOptions(provider, interaction.userId);
  if (userOpts) {
    providerOptions = mergeProviderOptions(providerOptions, userOpts) as ProviderOptions;
  }

  if (providerOptions) {
    options.providerOptions = providerOptions;
  }

  // Add tools if available
  if (interaction.hasTools()) {
    options.tools = interaction.getVercelTools();
    if (interaction.maxSteps) {
      options.stopWhen = stepCountIs(interaction.maxSteps);
    }
    if (streaming) {
      options.experimental_toolCallStreaming = true;
    }
    if (process.env.DEBUG === "1") {
      console.log(
        `[DEBUG] Passing tools to model (${label}):`,
        Object.keys(interaction.getVercelTools() || {}),
      );
      console.log(
        "[DEBUG] Using stopWhen with maxSteps:",
        interaction.maxSteps,
      );
    }
  }

  return options;
}
