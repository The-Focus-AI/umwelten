/**
 * Claude Agent SDK Runner
 *
 * Wraps @anthropic-ai/claude-agent-sdk's query() to run Claude Code
 * as an agentic subprocess. Used by agent_ask_claude to delegate
 * coding tasks to Claude's full toolset (Read, Edit, Bash, Grep, etc.).
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKResultMessage,
  SDKAssistantMessage,
  Options,
} from "@anthropic-ai/claude-agent-sdk";

export interface ClaudeSDKRunnerOptions {
  /** Working directory for Claude Code (typically agent's projectPath) */
  cwd: string;
  /** ANTHROPIC_API_KEY — if not set, falls back to process.env */
  apiKey?: string;
  /** Model to use (default: claude-sonnet-4-6) */
  model?: string;
  /** Tools to allow (default: all Claude Code tools) */
  allowedTools?: string[];
  /** Tools to disallow */
  disallowedTools?: string[];
  /** Max turns before stopping */
  maxTurns?: number;
  /** System prompt to prepend */
  systemPrompt?: string;
  /** Callback for streaming progress updates */
  onProgress?: (update: ClaudeSDKProgress) => void;
  /** Abort controller for cancellation */
  abortController?: AbortController;
  /** Permission mode (default: auto for full autonomy) */
  permissionMode?: "default" | "plan" | "auto";
  /** Additional env vars to pass */
  env?: Record<string, string | undefined>;
}

export interface ClaudeSDKProgress {
  type: "text" | "tool_use" | "tool_result" | "status" | "error";
  content: string;
  toolName?: string;
}

export interface ClaudeSDKResult {
  /** Final text response */
  content: string;
  /** Whether the run succeeded */
  success: boolean;
  /** Number of turns taken */
  numTurns: number;
  /** Duration in ms */
  durationMs: number;
  /** All assistant messages collected */
  messages: SDKAssistantMessage[];
  /** Errors if any */
  errors: string[];
}

/**
 * Extract text content from an SDKAssistantMessage.
 */
function extractTextFromAssistant(msg: SDKAssistantMessage): string {
  if (!msg.message?.content) return "";
  const parts: string[] = [];
  for (const block of msg.message.content) {
    if (block.type === "text") {
      parts.push((block as { type: "text"; text: string }).text);
    }
  }
  return parts.join("\n");
}

/**
 * Run a prompt through the Claude Agent SDK.
 * Returns the final result with all collected text.
 */
export async function runClaudeSDK(
  prompt: string,
  options: ClaudeSDKRunnerOptions,
): Promise<ClaudeSDKResult> {
  const assistantMessages: SDKAssistantMessage[] = [];
  const errors: string[] = [];

  const env: Record<string, string | undefined> = {
    ...process.env,
    ...options.env,
  };
  if (options.apiKey) {
    env.ANTHROPIC_API_KEY = options.apiKey;
  }

  const queryOptions: Options = {
    cwd: options.cwd,
    env,
    maxTurns: options.maxTurns ?? 20,
    abortController: options.abortController,
    permissionMode: options.permissionMode ?? "auto",
  };

  if (options.model) {
    queryOptions.model = options.model;
  }

  if (options.allowedTools) {
    queryOptions.allowedTools = options.allowedTools;
  }

  if (options.disallowedTools) {
    queryOptions.disallowedTools = options.disallowedTools;
  }

  if (options.systemPrompt) {
    queryOptions.systemPrompt = options.systemPrompt;
  }

  let resultMessage: SDKResultMessage | undefined;

  for await (const message of query({ prompt, options: queryOptions })) {
    switch (message.type) {
      case "assistant": {
        const assistantMsg = message as SDKAssistantMessage;
        assistantMessages.push(assistantMsg);

        const text = extractTextFromAssistant(assistantMsg);
        if (text && options.onProgress) {
          options.onProgress({ type: "text", content: text });
        }

        // Report tool use
        if (assistantMsg.message?.content) {
          for (const block of assistantMsg.message.content) {
            if (block.type === "tool_use" && options.onProgress) {
              options.onProgress({
                type: "tool_use",
                content: `Using ${block.name}`,
                toolName: block.name,
              });
            }
          }
        }

        if (assistantMsg.error) {
          errors.push(assistantMsg.error);
        }
        break;
      }

      case "result": {
        resultMessage = message as SDKResultMessage;
        break;
      }

      case "system": {
        if (options.onProgress) {
          const sysMsg = message as { subtype?: string };
          options.onProgress({
            type: "status",
            content: `system: ${sysMsg.subtype ?? "unknown"}`,
          });
        }
        break;
      }
    }
  }

  // Build final result
  if (resultMessage && resultMessage.subtype === "success") {
    return {
      content: resultMessage.result ?? "",
      success: true,
      numTurns: resultMessage.num_turns ?? 0,
      durationMs: resultMessage.duration_ms ?? 0,
      messages: assistantMessages,
      errors,
    };
  }

  // Error result
  const errorResult = resultMessage as {
    subtype?: string;
    error?: string;
    duration_ms?: number;
    num_turns?: number;
  };
  const errorText =
    errorResult?.error ?? errors.join("; ") ?? "Unknown error";
  return {
    content: errorText,
    success: false,
    numTurns: errorResult?.num_turns ?? 0,
    durationMs: errorResult?.duration_ms ?? 0,
    messages: assistantMessages,
    errors: [...errors, errorText],
  };
}
