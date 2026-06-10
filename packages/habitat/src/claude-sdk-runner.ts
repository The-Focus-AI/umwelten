/**
 * Claude Agent SDK Runner
 *
 * Wraps @anthropic-ai/claude-agent-sdk's query() to run Claude Code
 * as an agentic subprocess. Used by agent_ask_claude to delegate
 * coding tasks to Claude's full toolset (Read, Edit, Bash, Grep, etc.).
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKResultMessage,
  SDKAssistantMessage,
  Options,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  BridgeEventHandlers,
  RuntimeContext,
  RuntimeResult,
  RuntimeRunner,
} from "./bridge/types.js";

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
  /**
   * Injectable query function for tests (defaults to the real SDK's
   * query). Lets unit tests drive the message loop — init session-id
   * extraction, result handling — with the subprocess layer stubbed.
   */
  queryFn?: typeof query;
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
  /**
   * The SDK's native session id, extracted from the stream's init
   * message (#118). Links the habitat session envelope to the full
   * Claude Code JSONL trace on disk.
   */
  sessionId?: string;
}

// ── Native session location (#118) ───────────────────────────────────

/**
 * Claude Code's project-directory encoding: every non-alphanumeric
 * character of the cwd becomes a dash (lossy by design — see #109; the
 * read side prefers the JSONL's own `cwd` field for decoding).
 */
export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * Where Claude Code wrote the native JSONL for a run: under
 * `$CLAUDE_CONFIG_DIR/projects/<encoded-cwd>/<sessionId>.jsonl`, falling
 * back to `~/.claude` when the override is unset. The container image
 * sets CLAUDE_CONFIG_DIR beneath the data volume (PRD #113 session
 * co-location); this helper only reads the environment — runners never
 * invent paths.
 */
export function claudeNativeSessionPath(
  cwd: string,
  sessionId: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
  return join(configDir, "projects", claudeProjectDirName(cwd), `${sessionId}.jsonl`);
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
  let nativeSessionId: string | undefined;
  const queryFn = options.queryFn ?? query;

  for await (const message of queryFn({ prompt, options: queryOptions })) {
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
        const sysMsg = message as { subtype?: string; session_id?: string };
        // The init message carries the SDK's session id — the link from
        // the habitat session envelope to the native JSONL trace (#118).
        if (sysMsg.subtype === "init" && sysMsg.session_id) {
          nativeSessionId = sysMsg.session_id;
        }
        if (options.onProgress) {
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
      sessionId: nativeSessionId,
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
    sessionId: nativeSessionId,
  };
}

// ── RuntimeRunner adapter (#118) ──────────────────────────────────────

/**
 * Adapt the SDK runner to the bridge's RuntimeRunner contract. Streams
 * progress into the bridge event handlers and, when the SDK reported a
 * session id, returns the nativeSessionRef pointing at the JSONL trace.
 *
 * `runFn` is injectable for tests; production uses runClaudeSDK.
 */
export function createClaudeSdkRuntimeRunner(
  runFn: typeof runClaudeSDK = runClaudeSDK,
): RuntimeRunner {
  return {
    async run(
      prompt: string,
      ctx: RuntimeContext,
      events: BridgeEventHandlers,
    ): Promise<RuntimeResult> {
      const result = await runFn(prompt, {
        cwd: ctx.agent.projectPath,
        apiKey: process.env.ANTHROPIC_API_KEY,
        maxTurns: 25,
        onProgress: (update) => {
          if (update.type === "text") {
            events.onText?.(update.content);
          } else if (update.type === "tool_use" && update.toolName) {
            events.onToolCall?.(update.toolName, undefined);
          }
        },
      });

      return {
        content: result.content,
        success: result.success,
        errors: result.errors,
        nativeSessionRef: result.sessionId
          ? {
              runtime: "claude-sdk",
              nativeSessionId: result.sessionId,
              nativeSessionPath: claudeNativeSessionPath(
                ctx.agent.projectPath,
                result.sessionId,
              ),
            }
          : undefined,
      };
    },
  };
}
