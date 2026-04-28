/**
 * StreamObserver implementations for common consumers.
 *
 * The runner emits stream events; observers decide what to do with them
 * (print to stdout, write to SSE, queue for a UI, etc.).
 */

import type { StreamObserver } from "./types.js";

/**
 * Observer that mirrors the pre-observer behavior of BaseModelRunner:
 * writes text deltas to stdout, reasoning deltas in cyan, tool calls and
 * results to stdout. Use this in CLI callers that want the old inline
 * streaming output.
 */
export function cliStdoutObserver(): StreamObserver {
  return {
    onTextDelta(delta) {
      process.stdout.write(delta);
    },
    onReasoningDelta(delta) {
      // Cyan for reasoning, to distinguish from the actual assistant text.
      process.stdout.write(`\x1b[36m${delta}\x1b[0m`);
    },
    onToolCall({ toolName, input }) {
      process.stdout.write(
        `\n[TOOL CALL] ${toolName} called with: ${safeStringify(input)}\n`,
      );
    },
    onToolResult({ toolName, output, isError }) {
      const label = isError ? "[TOOL ERROR]" : "[TOOL RESULT]";
      process.stdout.write(
        `\n${label} ${toolName}: ${safeStringify(output)}\n`,
      );
    },
  };
}

function safeStringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
