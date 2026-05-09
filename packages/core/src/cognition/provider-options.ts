import { ReasoningEffort } from "./types.js";

/**
 * Build provider-specific reasoning/thinking options from a unified ReasoningEffort level.
 * Returns providerOptions to merge into generateText/streamText/generateObject/streamObject calls.
 */
export function buildReasoningProviderOptions(
  provider: string,
  effort?: ReasoningEffort,
): Record<string, any> | undefined {
  // Default: enable thinking for Google (backward compat), skip for others
  if (provider === "google") {
    if (effort === "none") {
      return {
        google: {
          thinkingConfig: {
            includeThoughts: false,
          },
        },
      };
    }
    const budgetMap: Record<string, number> = {
      low: 1024,
      medium: 8192,
      high: 24576,
    };
    return {
      google: {
        thinkingConfig: {
          includeThoughts: true,
          ...(effort && budgetMap[effort]
            ? { thinkingBudget: budgetMap[effort] }
            : {}),
        },
      },
    };
  }

  if (!effort || effort === "none") return undefined;

  if (provider === "openrouter") {
    return {
      openrouter: {
        reasoning: { effort },
      },
    };
  }

  if (provider === "anthropic") {
    const budgetMap: Record<string, number> = {
      low: 2048,
      medium: 8192,
      high: 32768,
    };
    return {
      anthropic: {
        thinking: {
          type: "enabled",
          budget_tokens: budgetMap[effort] ?? 8192,
        },
      },
    };
  }

  // DeepInfra and Together AI use OpenAI-compatible reasoning_effort
  if (provider === "deepinfra" || provider === "togetherai") {
    return {
      [provider]: {
        reasoning_effort: effort,
      },
    };
  }

  return undefined;
}

/**
 * Build provider-specific user tracking options from an Interaction's userId.
 * Returns providerOptions to deep-merge into generateText/streamText/etc calls,
 * or undefined if the provider doesn't support user tracking or userId is unset.
 */
export function buildUserProviderOptions(
  provider: string,
  userId?: string,
): Record<string, any> | undefined {
  if (!userId || userId === "default") return undefined;

  if (provider === "openrouter") {
    return { openrouter: { user: userId } };
  }

  if (provider === "anthropic") {
    return { anthropic: { metadata: { userId } } };
  }

  return undefined;
}

/**
 * Deep-merge two providerOptions objects (one level deep per provider key).
 */
export function mergeProviderOptions(
  existing: Record<string, any> | undefined,
  incoming: Record<string, any>,
): Record<string, any> {
  if (!existing) return { ...incoming };
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === "object" && value !== null && typeof merged[key] === "object" && merged[key] !== null) {
      merged[key] = { ...merged[key], ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
