import { CoreMessage } from "ai";
import type {
  NormalizedSession,
  NormalizedMessage,
  SessionSource,
} from "../types/normalized-types.js";

interface InteractionMetadata {
  created: Date;
  updated: Date;
  source?: SessionSource;
  sourceId?: string;
}

/**
 * Convert an Interaction's messages to a NormalizedSession.
 */
export function interactionToNormalizedSession(
  id: string,
  messages: CoreMessage[],
  metadata: InteractionMetadata,
): NormalizedSession {
  const normalizedMessages: NormalizedMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const msgId = `${id}-${i}`;
    const timestamp = new Date().toISOString();

    if (msg.role === "system") {
      normalizedMessages.push({
        id: msgId,
        role: "system",
        content:
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content),
        timestamp,
      });
      continue;
    }

    if (msg.role === "user") {
      const contentStr =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .map((c) => {
                const part = c as unknown as Record<string, unknown>;
                if (part.type === "text") return part.text as string;
                if (part.type === "image") return "[Image]";
                if (part.type === "file") return "[File]";
                if (part.type === "tool-result") {
                  const resultOrOutput =
                    (part.result as unknown) ?? (part.output as unknown);
                  if (
                    resultOrOutput &&
                    typeof resultOrOutput === "object" &&
                    "type" in (resultOrOutput as Record<string, unknown>) &&
                    "value" in (resultOrOutput as Record<string, unknown>)
                  ) {
                    const o = resultOrOutput as {
                      type: string;
                      value: unknown;
                    };
                    return typeof o.value === "string"
                      ? o.value
                      : JSON.stringify(o.value ?? "");
                  }
                  return typeof resultOrOutput === "string"
                    ? resultOrOutput
                    : JSON.stringify(resultOrOutput ?? "");
                }
                return "";
              })
              .join("\n");

      normalizedMessages.push({
        id: msgId,
        role: "user",
        content: contentStr,
        timestamp,
      });
      continue;
    }

    if (msg.role === "assistant") {
      let contentStr = "";
      const toolCalls: Record<string, unknown>[] = [];

      if (typeof msg.content === "string") {
        contentStr = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content as unknown as Record<string, unknown>[]) {
          if (part.type === "text") {
            contentStr += part.text as string;
          } else if (part.type === "tool-call") {
            toolCalls.push(part);
          }
        }
      }

      if ((msg as Record<string, unknown>).toolInvocations) {
        toolCalls.push(
          ...((msg as Record<string, unknown>).toolInvocations as Record<
            string,
            unknown
          >[]),
        );
      }

      normalizedMessages.push({
        id: msgId,
        role: "assistant",
        content: contentStr,
        timestamp,
      });

      for (let j = 0; j < toolCalls.length; j++) {
        const tc = toolCalls[j];
        const toolId =
          (tc.toolCallId as string) || (tc.id as string) || `call-${j}`;
        const toolName =
          (tc.toolName as string) || (tc.name as string) || "unknown";
        const toolInput =
          (tc.args as Record<string, unknown>) ||
          (tc.input as Record<string, unknown>) ||
          {};

        normalizedMessages.push({
          id: toolId,
          role: "tool",
          content: `Tool: ${toolName}`,
          timestamp,
          tool: {
            name: toolName,
            input: toolInput,
          },
        });
      }
      continue;
    }

    if (msg.role === "tool") {
      let contentStr = "";
      if (typeof msg.content === "string") {
        contentStr = msg.content;
      } else {
        contentStr = msg.content
          .map((c) => {
            const part = c as unknown as Record<string, unknown>;
            if (part.type === "tool-result") {
              const resultOrOutput =
                (part.result as unknown) ?? (part.output as unknown);
              let valueStr: string;
              if (
                resultOrOutput &&
                typeof resultOrOutput === "object" &&
                "type" in (resultOrOutput as Record<string, unknown>) &&
                "value" in (resultOrOutput as Record<string, unknown>)
              ) {
                const o = resultOrOutput as { type: string; value: unknown };
                valueStr =
                  typeof o.value === "string"
                    ? o.value
                    : JSON.stringify(o.value ?? "");
              } else {
                valueStr =
                  typeof resultOrOutput === "string"
                    ? resultOrOutput
                    : JSON.stringify(resultOrOutput ?? "");
              }
              return `[Tool Result: ${(part.toolName as string) || "unknown"}]\n${valueStr}`;
            }
            return JSON.stringify(c);
          })
          .join("\n");
      }

      normalizedMessages.push({
        id: msgId,
        role: "user",
        content: contentStr,
        timestamp,
        sourceData: { type: "tool_result_message" },
      });
    }
  }

  const userMessages = normalizedMessages.filter(
    (m) => m.role === "user",
  ).length;
  const assistantMessages = normalizedMessages.filter(
    (m) => m.role === "assistant",
  ).length;
  const toolCallMessages = normalizedMessages.filter(
    (m) => m.role === "tool",
  ).length;

  const firstUserMsg = normalizedMessages.find((m) => m.role === "user");
  const firstPrompt = firstUserMsg
    ? firstUserMsg.content.slice(0, 100)
    : "(New Session)";

  return {
    id,
    source: metadata.source || "native",
    sourceId: metadata.sourceId || id,
    created: metadata.created.toISOString(),
    modified: metadata.updated.toISOString(),
    messages: normalizedMessages,
    messageCount: normalizedMessages.length,
    firstPrompt,
    metrics: {
      userMessages,
      assistantMessages,
      toolCalls: toolCallMessages,
    },
  };
}

/**
 * Build metadata + messages for reconstructing an Interaction from a NormalizedSession.
 * The actual Interaction construction stays in the static factory to avoid circular imports.
 */
export function normalizedSessionToMessages(
  session: NormalizedSession,
): {
  id: string;
  created: Date;
  updated: Date;
  source: SessionSource;
  sourceId: string;
  messages: CoreMessage[];
  systemContent?: string;
} {
  const systemMsg = session.messages.find((m) => m.role === "system");

  return {
    id: session.id,
    created: new Date(session.created),
    updated: new Date(session.modified),
    source: session.source,
    sourceId: session.sourceId,
    messages: session.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })) as CoreMessage[],
    systemContent: systemMsg?.content,
  };
}
