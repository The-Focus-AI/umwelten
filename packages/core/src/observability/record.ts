import { randomUUID } from "node:crypto";
import type { CostBreakdown, TokenUsage } from "../costs/costs.js";
import type {
  CompletionCost,
  CompletionOutcome,
  CompletionRecord,
  CompletionTokens,
} from "./types.js";

/** The subset of an Interaction the record needs; kept structural so tests don't build a real one. */
export interface CompletionSubject {
  id: string;
  userId?: string;
  sessionId?: string;
  app?: string;
  tags?: string[];
  modelDetails: { provider: string; name: string; reasoningEffort?: string };
}

export interface BuildCompletionRecordInput {
  interaction: CompletionSubject;
  operation: CompletionRecord["operation"];
  startTime: Date;
  endTime?: Date;
  usage: TokenUsage | null;
  cost: CostBreakdown | null;
  outcome: CompletionOutcome;
  finishReason?: string;
  toolCallCount?: number;
  steps?: number;
  error?: string;
  providerRequestId?: string;
  usageRaw?: unknown;
}

export function completionTokensFrom(usage: TokenUsage | null): CompletionTokens {
  if (!usage) return { prompt: 0, completion: 0, total: 0 };
  return {
    prompt: usage.promptTokens,
    completion: usage.completionTokens,
    total: usage.total ?? usage.promptTokens + usage.completionTokens,
    ...(usage.cacheReadTokens !== undefined && { cacheRead: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens !== undefined && { cacheWrite: usage.cacheWriteTokens }),
    ...(usage.reasoningTokens !== undefined && { reasoning: usage.reasoningTokens }),
  };
}

export function completionCostFrom(cost: CostBreakdown | null): CompletionCost | undefined {
  if (!cost) return undefined;
  return {
    prompt: cost.promptCost,
    completion: cost.completionCost,
    total: cost.totalCost,
    ...(cost.cacheReadCost !== undefined && { cacheRead: cost.cacheReadCost }),
    ...(cost.cacheWriteCost !== undefined && { cacheWrite: cost.cacheWriteCost }),
    source: "pricing-table",
  };
}

export function buildCompletionRecord(input: BuildCompletionRecordInput): CompletionRecord {
  const endTime = input.endTime ?? new Date();
  const { interaction } = input;
  const usageRaw =
    input.usageRaw && typeof input.usageRaw === "object"
      ? (input.usageRaw as Record<string, unknown>)
      : undefined;

  return {
    id: randomUUID(),
    traceId: interaction.id,
    ...(interaction.sessionId && { sessionId: interaction.sessionId }),
    ...(interaction.userId && interaction.userId !== "default" && { userId: interaction.userId }),
    ...(interaction.app && { app: interaction.app }),
    tags: interaction.tags ?? [],
    kind: "llm",
    operation: input.operation,
    provider: interaction.modelDetails.provider,
    model: interaction.modelDetails.name,
    ...(interaction.modelDetails.reasoningEffort && {
      reasoningEffort: interaction.modelDetails.reasoningEffort,
    }),
    startedAt: input.startTime.toISOString(),
    endedAt: endTime.toISOString(),
    durationMs: Math.max(0, endTime.getTime() - input.startTime.getTime()),
    tokens: completionTokensFrom(input.usage),
    ...(input.cost && { cost: completionCostFrom(input.cost) }),
    outcome: input.outcome,
    ...(input.finishReason && { finishReason: input.finishReason }),
    toolCallCount: input.toolCallCount ?? 0,
    steps: input.steps ?? 1,
    ...(input.error && { error: input.error }),
    ...(input.providerRequestId && { providerRequestId: input.providerRequestId }),
    ...(usageRaw && { usageRaw }),
  };
}
