/** Serialize modern SDK content without silently dropping tool evidence.
 * Binary payloads are omitted; URLs, filenames, media types and text survive.
 * Text/tool output is not size-capped: callers must bound the source segment.
 */
import type { ModelMessage } from "ai";

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof ArrayBuffer || ArrayBuffer.isView(item))
      return "[binary data omitted]";
    // Buffer.toJSON runs before the replacer.
    if (
      item &&
      typeof item === "object" &&
      "type" in item &&
      item.type === "Buffer"
    )
      return "[binary data omitted]";
    if (typeof item === "string" && item.startsWith("data:"))
      return `${item.slice(0, item.indexOf(",") + 1)}[data omitted]`;
    return item;
  });
}

export function serializeSegment(
  messages: ModelMessage[],
  start: number,
  end: number,
): string {
  return messages
    .slice(start, end + 1)
    .map(
      (message, i) =>
        `--- ${message.role} (message ${start + i}) ---\n${typeof message.content === "string" ? message.content : serialize(message.content)}`,
    )
    .join("\n\n");
}
