/**
 * Estimate context size (message count, characters, tokens).
 * Uses character-based token estimate (chars/4); tiktoken can be added later for accuracy.
 */

import type { CoreMessage } from "ai";
import type { ContextSizeEstimate } from "./types.js";

const CHARS_PER_TOKEN_ESTIMATE = 4;

function messageToText(msg: CoreMessage): string {
  const parts: string[] = [];
  parts.push(`role:${(msg as { role?: string }).role ?? "unknown"}`);
  const content = (msg as { content?: unknown }).content;
  if (typeof content === "string") {
    parts.push(content);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === "object") {
        if ("text" in part && typeof part.text === "string") parts.push(part.text);
        if ("type" in part && part.type === "tool-invocation" && "toolInvocationId" in part) {
          parts.push(`[tool:${(part as { toolName?: string }).toolName ?? "?"}]`);
        }
      }
    }
  }
  const toolInvocations = (msg as { toolInvocations?: unknown[] }).toolInvocations;
  if (Array.isArray(toolInvocations)) {
    for (const t of toolInvocations) {
      if (t && typeof t === "object" && "toolName" in t) {
        parts.push(`[tool:${(t as { toolName: string }).toolName}]`);
      }
    }
  }
  return parts.join("\n");
}

/**
 * Estimate context size from messages.
 * Uses character count and chars/4 for estimated tokens (tiktoken can be integrated later for accuracy).
 */
export function estimateContextSize(messages: CoreMessage[]): ContextSizeEstimate {
  const messageCount = messages.length;
  let characterCount = 0;
  for (const msg of messages) {
    characterCount += messageToText(msg).length;
  }
  const estimatedTokens = Math.ceil(characterCount / CHARS_PER_TOKEN_ESTIMATE);
  return {
    messageCount,
    characterCount,
    estimatedTokens,
  };
}
