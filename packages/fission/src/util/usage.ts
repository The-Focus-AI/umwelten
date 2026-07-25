/**
 * Pull usage and cost off a ModelResponse without every call site knowing the
 * metadata shape.
 */

import type { ModelResponse } from "@umwelten/core/cognition/types.js";
import type { TurnUsage } from "../types.js";

export function usageFrom(response: ModelResponse | undefined): TurnUsage | undefined {
  if (!response?.metadata) return undefined;
  const usage = response.metadata.tokenUsage;
  const cost = response.metadata.cost;
  return {
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
    totalTokens:
      usage?.total ?? (usage ? usage.promptTokens + usage.completionTokens : undefined),
    costUsd: cost?.totalCost,
  };
}

export function costOf(response: ModelResponse | undefined): number {
  return response?.metadata?.cost?.totalCost ?? 0;
}

/** Model output is a JSON string for generateObject; parse defensively. */
export function parseObject<T>(content: string): T | undefined {
  const trimmed = content.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Some providers wrap the object in a fenced block despite the schema.
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]) as T;
      } catch {
        return undefined;
      }
    }
    const braced = trimmed.match(/\{[\s\S]*\}/);
    if (braced) {
      try {
        return JSON.parse(braced[0]) as T;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
