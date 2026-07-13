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

// ANSI helpers (no chalk dependency in this module)
const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[39m`;
const green = (s: string) => `\x1b[32m${s}\x1b[39m`;
const red = (s: string) => `\x1b[31m${s}\x1b[39m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[39m`;
const gray = (s: string) => `\x1b[90m${s}\x1b[39m`;

/**
 * Format tool call arguments as a compact, readable string.
 * { path: "tools", agentId: "foo" } → path="tools" agentId="foo"
 */
function formatArgs(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => {
      const val = typeof v === "string" ? v : JSON.stringify(v);
      // Truncate long values
      const display = val.length > 80 ? val.slice(0, 77) + "..." : val;
      return `${dim(k + "=")}${yellow(`"${display}"`)}`;
    })
    .join(" ");
}

/**
 * Format tool result output as a concise summary.
 */
function formatResult(output: unknown): string {
  if (typeof output === "string") {
    // Try to parse as JSON for prettier display
    try {
      const parsed = JSON.parse(output);
      return formatResultObject(parsed);
    } catch {
      return truncate(output, 200);
    }
  }
  if (typeof output === "object" && output !== null) {
    return formatResultObject(output as Record<string, unknown>);
  }
  return String(output);
}

function formatResultObject(obj: Record<string, unknown>): string {
  // Handle tool wrapper: { tool, success, data } — unwrap data
  if ("data" in obj && typeof obj.data === "string") {
    try {
      const inner = JSON.parse(obj.data);
      return formatResultObject(inner);
    } catch {
      return truncate(obj.data as string, 200);
    }
  }

  // Error case
  if ("error" in obj) {
    const msg = (obj.message as string) || (obj.error as string) || "";
    return red(`error: ${truncate(msg, 150)}`);
  }

  // Directory listing
  if ("entries" in obj && Array.isArray(obj.entries)) {
    const entries = obj.entries as Array<{ name: string; isDir?: boolean }>;
    if (entries.length === 0) return dim("(empty directory)");
    const names = entries
      .slice(0, 8)
      .map((e) => (e.isDir ? e.name + "/" : e.name));
    const suffix = entries.length > 8 ? ` (+${entries.length - 8} more)` : "";
    return names.join(", ") + suffix;
  }

  // File content
  if ("content" in obj && typeof obj.content === "string") {
    const content = obj.content as string;
    const lines = content.split("\n").length;
    const preview = truncate(content.split("\n")[0], 80);
    return lines > 1 ? `${preview} ${dim(`(${lines} lines)`)}` : preview;
  }

  // File saved
  if ("filePath" in obj) {
    return `saved to ${obj.filePath}`;
  }

  // Generic: show key summary
  const keys = Object.keys(obj);
  if (keys.length <= 4) {
    return keys
      .map((k) => {
        const v = obj[k];
        if (v === null || v === undefined) return `${k}: null`;
        if (typeof v === "string") return `${k}: ${truncate(v, 60)}`;
        if (typeof v === "number" || typeof v === "boolean") return `${k}: ${v}`;
        if (Array.isArray(v)) return `${k}: [${v.length} items]`;
        return `${k}: {...}`;
      })
      .join(dim(" | "));
  }
  return dim(`{${keys.join(", ")}}`);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

/**
 * Clean, readable observer for MCP chat and similar interactive CLI tools.
 * Tool calls shown as compact one-liners; results summarized.
 * Text streams directly; reasoning in italics.
 */
export function cleanChatObserver(): StreamObserver {
  return {
    onTextDelta(delta) {
      process.stdout.write(delta);
    },
    onReasoningDelta(delta) {
      process.stdout.write(cyan(delta));
    },
    onToolCall({ toolName, input }) {
      const args = formatArgs(input);
      process.stdout.write(`\n  ${dim("⚡")} ${bold(toolName)}${args ? " " + args : ""}\n`);
    },
    onToolResult({ toolName, output, isError }) {
      const icon = isError ? red("✗") : green("✓");
      const summary = formatResult(output);
      process.stdout.write(`  ${icon} ${summary}\n`);
    },
  };
}

/**
 * Markdown-rendering observer for interactive CLI chat.
 * Streams text through a MarkdownStream for proper formatting (headings,
 * code blocks, tables, etc.). Tool calls/results same as cleanChatObserver.
 *
 * Must be created with `await createMarkdownChatObserver()` since the
 * streammark import is async (ESM).
 * Call `.end()` after the turn completes to flush buffered markdown.
 */
export async function createMarkdownChatObserver(): Promise<StreamObserver & { end(): void }> {
  let MarkdownStreamClass: any = null;
  try {
    const streammarkPkg = "streammark"; // non-literal: optional untyped dep
    const mod = await import(streammarkPkg);
    MarkdownStreamClass = mod.MarkdownStream;
  } catch {
    // streammark not available — fall through to raw output
  }

  let md: any = null;
  const getMd = () => {
    if (!md) {
      if (MarkdownStreamClass) {
        md = new MarkdownStreamClass({ theme: "dark" });
      } else {
        md = { write: (s: string) => process.stdout.write(s), end: () => {} };
      }
    }
    return md;
  };

  return {
    onTextDelta(delta) {
      getMd().write(delta);
    },
    onReasoningDelta(delta) {
      process.stdout.write(cyan(delta));
    },
    onToolCall({ toolName, input }) {
      // Flush markdown before tool output
      if (md) { md.end(); md = null; }
      const args = formatArgs(input);
      process.stdout.write(`\n  ${dim("⚡")} ${bold(toolName)}${args ? " " + args : ""}\n`);
    },
    onToolResult({ toolName, output, isError }) {
      const icon = isError ? red("✗") : green("✓");
      const summary = formatResult(output);
      process.stdout.write(`  ${icon} ${summary}\n`);
    },
    end() {
      if (md) { md.end(); md = null; }
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
