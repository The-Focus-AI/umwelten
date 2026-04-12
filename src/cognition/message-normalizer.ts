import { type CoreMessage } from "ai";

/**
 * Clean provider options to remove nested structures that cause AI SDK v5 Zod validation to fail.
 * Specifically removes reasoning_details arrays which have complex nested types.
 * Returns { cleaned: cleanedOptions, reasoning: extractedReasoning }
 */
export function cleanProviderOptions(providerOptions: any): {
  cleaned: any;
  reasoning?: string;
} {
  if (!providerOptions || typeof providerOptions !== "object") {
    return { cleaned: providerOptions };
  }

  let reasoningText: string | undefined;

  // Create a clean copy without reasoning_details
  const cleaned: any = {};
  for (const [key, value] of Object.entries(providerOptions)) {
    if (key === "reasoning_details") {
      // Extract reasoning text before removing
      if (Array.isArray(value)) {
        const reasoningParts = value
          .filter((r: any) => r && typeof r.text === "string")
          .map((r: any) => r.text);
        if (reasoningParts.length > 0) {
          reasoningText = reasoningParts.join("\n");
        }
      }
      // Skip reasoning_details - it has complex nested structures that Zod rejects
      continue;
    }
    if (key === "openrouter" && typeof value === "object" && value !== null) {
      // Clean nested openrouter object too, and check for reasoning there
      const nested = cleanProviderOptions(value);
      cleaned[key] = nested.cleaned;
      if (nested.reasoning && !reasoningText) {
        reasoningText = nested.reasoning;
      }
    } else {
      cleaned[key] = value;
    }
  }
  return { cleaned, reasoning: reasoningText };
}

/**
 * Normalize messages to AI SDK ModelMessage shape so they pass standardizePrompt validation.
 * Converts legacy/UI-style fields: args→input, experimental_providerMetadata→providerOptions.
 * Outputs only schema-allowed keys for tool-call and tool-result parts to avoid strict validation failures.
 */
export function normalizeToModelMessages(
  messages: CoreMessage[],
): CoreMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "assistant" && msg.role !== "tool") return msg;
    if (!Array.isArray(msg.content)) return msg;
    const content = msg.content as unknown as Array<Record<string, unknown>>;
    const newContent = content.map((part) => {
      if (part?.type === "tool-call") {
        const input = part.input ?? part.args ?? {};
        const rawProviderOptions =
          part.providerOptions ?? part.experimental_providerMetadata;
        // Clean provider options to remove nested structures that Zod rejects
        // Also extract any reasoning text from provider metadata
        let providerOptions: any;
        let extractedReasoning: string | undefined;
        if (rawProviderOptions != null) {
          const cleaned = cleanProviderOptions(rawProviderOptions);
          providerOptions = cleaned.cleaned;
          extractedReasoning = cleaned.reasoning;
        }

        // If we found reasoning in provider options, log it
        if (extractedReasoning) {
          console.log("\n🧠 [REASONING FROM MODEL]:");
          console.log(`\x1b[36m${extractedReasoning}\x1b[0m`);
        }

        return {
          type: "tool-call" as const,
          toolCallId: String(part.toolCallId ?? ""),
          toolName: String(part.toolName ?? ""),
          input,
          ...(providerOptions != null && { providerOptions }),
          ...(typeof part.providerExecuted === "boolean" && {
            providerExecuted: part.providerExecuted,
          }),
        };
      }
      if (part?.type === "tool-result") {
        const rawProvOpts =
          part.providerOptions ?? part.experimental_providerMetadata;
        // Clean provider options to remove nested structures that Zod rejects
        let provOpts: any;
        if (rawProvOpts != null) {
          const cleaned = cleanProviderOptions(rawProvOpts);
          provOpts = cleaned.cleaned;
          // Note: reasoning from tool-results is less common, but could be logged here too
        }
        // Normalize output to { type, value } format expected by AI SDK.
        // The SDK's Zod schema rejects `undefined` anywhere in the JsonValue tree,
        // so we JSON round-trip the value to strip undefineds.
        let output = part.output;
        if (output == null) {
          output = { type: "text" as const, value: "" };
        } else if (typeof output === "string") {
          output = { type: "text" as const, value: output };
        } else if (
          typeof output === "object" &&
          (!("type" in (output as any)) || !("value" in (output as any)))
        ) {
          output = {
            type: "json" as const,
            value: JSON.parse(JSON.stringify(output)),
          };
        } else if (typeof output === "object" && "value" in (output as any)) {
          // Already has { type, value } shape — strip undefineds from value
          const o = output as { type: string; value: unknown };
          output = {
            ...o,
            value:
              o.value != null && typeof o.value === "object"
                ? JSON.parse(JSON.stringify(o.value))
                : o.value,
          };
        }
        return {
          type: "tool-result" as const,
          toolCallId: String(part.toolCallId ?? ""),
          toolName: String(part.toolName ?? ""),
          output,
          ...(provOpts != null && { providerOptions: provOpts }),
        };
      }
      return part;
    });
    return { ...msg, content: newContent } as unknown as CoreMessage;
  });
}

/**
 * Ensure assistant messages with tool-call parts have thought_signature on the first
 * tool-call when using Google (Gemini 3). Uses dummy signature when missing so the API
 * accepts the request. See https://ai.google.dev/gemini-api/docs/thought-signatures
 */
export function ensureGoogleThoughtSignatures(
  messages: CoreMessage[],
): CoreMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) return msg;
    const content = msg.content as unknown as Array<Record<string, unknown>>;
    const hasToolCall = content.some((p) => p?.type === "tool-call");
    if (!hasToolCall) return msg;
    let firstToolCallInStep = true;
    const newContent = content.map((part) => {
      if (part?.type !== "tool-call") return part;
      const meta = (part.providerOptions ??
        part.experimental_providerMetadata) as
        | Record<string, unknown>
        | undefined;
      const existing = meta?.["google"] as
        | Record<string, unknown>
        | undefined;
      const hasSignature =
        existing &&
        typeof existing.thought_signature === "string" &&
        existing.thought_signature.length > 0;
      if (hasSignature || !firstToolCallInStep) {
        firstToolCallInStep = false;
        return part;
      }
      firstToolCallInStep = false;
      return {
        ...part,
        providerOptions: {
          ...(meta ?? {}),
          google: {
            ...((existing ?? {}) as object),
            thought_signature:
              (existing?.thought_signature as string) ??
              "skip_thought_signature_validator",
          },
        },
      };
    });
    return { ...msg, content: newContent } as unknown as CoreMessage;
  });
}
