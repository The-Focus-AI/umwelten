/**
 * Serialize a slice of CoreMessage[] to text for compaction prompts.
 * Shortens or omits large tool outputs to keep the summarizer input bounded.
 */

import type { CoreMessage } from "ai";

const MAX_TOOL_RESULT_CHARS = 500;

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content);
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if ("text" in part && typeof part.text === "string") {
      parts.push(part.text);
    }
    if ("type" in part && part.type === "tool-invocation") {
      const p = part as { toolName?: string; args?: unknown };
      parts.push(`[Tool: ${p.toolName ?? "?"}]`);
      if (p.args != null) {
        const argStr = typeof p.args === "string" ? p.args : JSON.stringify(p.args);
        parts.push(argStr.length > 200 ? argStr.slice(0, 200) + "…" : argStr);
      }
    }
    if ("type" in part && part.type === "tool-result") {
      const p = part as { result?: unknown };
      let r = typeof p.result === "string" ? p.result : JSON.stringify(p.result ?? "");
      if (r.length > MAX_TOOL_RESULT_CHARS) {
        r = r.slice(0, MAX_TOOL_RESULT_CHARS) + "… [truncated]";
      }
      parts.push(`[Result]: ${r}`);
    }
  }
  return parts.join("\n");
}

export function serializeSegment(messages: CoreMessage[], start: number, end: number): string {
  const lines: string[] = [];
  for (let i = start; i <= end; i++) {
    const msg = messages[i] as { role?: string; content?: unknown; toolInvocations?: unknown[] };
    const role = msg.role ?? "unknown";
    const content = stringifyContent(msg.content ?? "");
    lines.push(`--- ${role} ---`);
    lines.push(content);
    if (Array.isArray(msg.toolInvocations) && msg.toolInvocations.length > 0) {
      for (const t of msg.toolInvocations) {
        const t2 = t as { toolName?: string };
        lines.push(`[Tool call: ${t2.toolName ?? "?"}]`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}
