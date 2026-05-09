import { ModelDetails } from "./types.js";
import { calculateCost } from "../costs/costs.js";

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
