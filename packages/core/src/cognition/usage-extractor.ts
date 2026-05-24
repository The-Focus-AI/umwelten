import { ModelDetails } from "./types.js";
import { calculateCost } from "../costs/costs.js";

/**
 * Extract per-provider usage from a streamText / generateText result.
 *
 * The AI SDK's streaming results expose token usage in different places
 * depending on the provider — some attach it to `response.usage`, others
 * tuck it behind proxy/getter shapes like `_totalUsage.status.value` or
 * inside the first element of `_steps`. This helper performs the
 * provider-keyed dig so the calling code doesn't carry that fan-out
 * inline in the streamText event loop.
 *
 * Input: the raw streamText / generateText response, the initial usage
 * value already resolved from `response.usage` (which may be empty for
 * streaming responses), and the provider name.
 *
 * Behavior: provider-specific extraction is preserved verbatim from the
 * pre-extraction implementation in runner.ts:402-551 (commit a6bd4c2).
 * Returns the most-populated usage object found; falls back to the
 * resolved `response.usage` if no provider-specific path succeeded.
 */
export async function extractStreamUsage(
  response: any,
  initialUsage: any,
  provider: string,
): Promise<any> {
  let usage = initialUsage;

  if (provider === "ollama") {
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
    provider === "openrouter" ||
    provider === "minimax" ||
    provider === "google"
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
          stepsVal?.status?.value ?? stepsVal,
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
  if (provider === "github-models") {
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

  return usage;
}

export function normalizeTokenUsage(
  usage: any,
): { promptTokens: number; completionTokens: number; total?: number } | null {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const toNum = (v: unknown): number | undefined => {
    if (v === undefined || v === null) return undefined;
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : undefined;
    return n !== undefined && !Number.isNaN(n) && n >= 0 ? n : undefined;
  };

  let promptTokens =
    toNum(usage.promptTokens) ??
    toNum(usage.inputTokens) ??
    toNum(usage.prompt_tokens) ??
    toNum(usage.input_tokens);
  let completionTokens =
    toNum(usage.completionTokens) ??
    toNum(usage.outputTokens) ??
    toNum(usage.completion_tokens) ??
    toNum(usage.output_tokens);

  const total =
    toNum(usage.totalTokens) ??
    toNum(usage.total) ??
    toNum(usage.total_tokens) ??
    (promptTokens !== undefined && completionTokens !== undefined
      ? promptTokens + completionTokens
      : undefined);

  const reasoning = toNum(usage.reasoningTokens) ?? toNum(usage.reasoning_tokens);

  // MiniMax and some providers return totalTokens/reasoningTokens but omit or zero inputTokens/outputTokens
  if (promptTokens === undefined || completionTokens === undefined) {
    if (typeof total === "number" && total >= 0) {
      const r = reasoning ?? 0;
      promptTokens = promptTokens ?? r;
      completionTokens = completionTokens ?? Math.max(0, total - (promptTokens ?? 0));
    } else if (reasoning !== undefined && reasoning >= 0) {
      promptTokens = promptTokens ?? reasoning;
      completionTokens = completionTokens ?? toNum(usage.outputTokens) ?? 0;
    } else {
      promptTokens = promptTokens ?? 0;
      completionTokens = completionTokens ?? 0;
    }
  }

  const p = Number(promptTokens);
  const c = Number(completionTokens);
  if (Number.isNaN(p) || Number.isNaN(c) || p < 0 || c < 0) {
    return null;
  }

  return {
    promptTokens: p,
    completionTokens: c,
    total: total ?? p + c,
  };
}

export function calculateCostBreakdown(
  usage: any,
  params: { modelDetails: ModelDetails },
): any {
  const normalizedUsage = normalizeTokenUsage(usage);

  return normalizedUsage
    ? calculateCost(params.modelDetails, normalizedUsage)
    : null;
}
