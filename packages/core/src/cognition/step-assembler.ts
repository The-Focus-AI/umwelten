import { type CoreMessage } from "ai";
import type { Interaction } from "../interaction/core/interaction.js";

interface ToolCallEntry {
  toolCallId?: string;
  id?: string;
  toolName?: string;
  name?: string;
  input?: Record<string, unknown>;
  args?: Record<string, unknown>;
}

interface ToolResultEntry {
  toolCallId?: string;
  id?: string;
  toolName?: string;
  result?: unknown;
  output?: unknown;
  isError?: boolean;
}

interface StepEntry {
  text?: string | unknown;
  toolCalls?: ToolCallEntry[];
  toolResults?: ToolResultEntry[];
}

interface ResponseShape {
  toolCalls?: ToolCallEntry[] | Promise<ToolCallEntry[]>;
  steps?: StepEntry[] | Promise<StepEntry[]>;
  toolResults?: ToolResultEntry[] | Promise<ToolResultEntry[]>;
}

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

function normalizeToolCall(tc: ToolCallEntry): {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
} {
  return {
    type: "tool-call",
    toolCallId: String(tc.toolCallId ?? tc.id ?? ""),
    toolName: String(tc.toolName ?? tc.name ?? ""),
    input: (tc.input ?? tc.args ?? {}) as Record<string, unknown>,
  };
}

function addToolResultMessages(
  interaction: Interaction,
  calls: ToolCallEntry[],
  results: ToolResultEntry[],
): void {
  const resultMap = new Map(
    results.map((tr) => [tr.toolCallId ?? tr.id, tr]),
  );
  for (const tc of calls) {
    const id = String(tc.toolCallId ?? tc.id ?? "");
    const tr = resultMap.get(id);
    if (tr != null) {
      const out = tr.result ?? tr.output;
      interaction.addMessage({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: id,
            toolName: String(tr.toolName ?? tc.toolName ?? ""),
            output: toToolResultOutput(out, tr.isError ?? false),
          },
        ],
      } as unknown as CoreMessage);
      interaction.notifyTranscriptUpdate?.();
    }
  }
}

export interface AssembleStepsInput {
  response: ResponseShape;
  contentString: string;
  interaction: Interaction;
}

export interface AssembleStepsResult {
  toolCalls: ToolCallEntry[];
  toolResults: ToolResultEntry[];
}

export async function assembleSteps(
  input: AssembleStepsInput,
): Promise<AssembleStepsResult> {
  const { response, contentString, interaction } = input;

  // Resolve tool calls and results (they might be promises)
  let toolCalls: ToolCallEntry[] = [];
  let toolResults: ToolResultEntry[] = [];
  let steps: StepEntry[] = [];

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
                ...stepCalls.map(normalizeToolCall),
              ]
            : stepCalls.map(normalizeToolCall),
        });
        interaction.notifyTranscriptUpdate?.();
      } else if (stepText) {
        interaction.addMessage({ role: "assistant", content: stepText });
        interaction.notifyTranscriptUpdate?.();
      }
      if (stepResults.length > 0) {
        addToolResultMessages(interaction, stepCalls, stepResults);
      }
    }
    // Final assistant text only if last step had no text
    const lastStep = steps[steps.length - 1];
    const lastStepText = lastStep?.text != null ? String(lastStep.text) : "";
    if (contentString && lastStepText !== contentString) {
      interaction.addMessage({ role: "assistant", content: contentString });
      interaction.notifyTranscriptUpdate?.();
    }
  } else if (toolCalls.length > 0) {
    interaction.addMessage({
      role: "assistant",
      content: toolCalls.map(normalizeToolCall),
    } as unknown as CoreMessage);
    interaction.notifyTranscriptUpdate?.();
    addToolResultMessages(interaction, toolCalls, toolResults);
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

  return { toolCalls, toolResults };
}
