/**
 * Shared, host-neutral conversation rendering for Shell components.
 *
 * A Habitat supplies messages from its persistent conversation service; the
 * Mycel playground supplies OpenAI response deltas. This module owns only the
 * safe DOM projection, so neither host has to recreate chat presentation and
 * neither host's transport leaks into the other.
 */

export interface ConversationPart {
  kind: "text" | "reasoning" | "tool" | "error";
  text?: string;
  name?: string;
  output?: unknown;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  parts: ConversationPart[];
  streaming?: boolean;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Render with textContent only: model output is data, never trusted HTML. */
export function renderConversation(
  container: HTMLElement,
  messages: ConversationMessage[],
): void {
  container.replaceChildren();
  for (const message of messages) {
    const bubble = document.createElement("div");
    bubble.dataset.role = message.role;
    Object.assign(bubble.style, {
      alignSelf: message.role === "user" ? "flex-end" : "flex-start",
      maxWidth: "85%",
      border: `1px solid ${message.role === "user" ? "var(--accent)" : "var(--line)"}`,
      borderRadius: "6px",
      padding: "0.5rem 0.8rem",
    });
    for (const part of message.parts) {
      const line = document.createElement("p");
      line.style.margin = "0";
      line.style.whiteSpace = "pre-wrap";
      if (part.kind === "reasoning") {
        line.style.color = "var(--muted)";
        line.style.fontStyle = "italic";
        line.textContent = text(part.text);
      } else if (part.kind === "tool") {
        line.style.color = "var(--muted)";
        line.textContent = `⚡ ${text(part.name)}${part.output !== undefined ? " ✓" : "…"}`;
      } else {
        if (part.kind === "error") line.style.color = "var(--error)";
        line.textContent = text(part.text);
      }
      bubble.append(line);
    }
    if (message.streaming) {
      const progress = document.createElement("p");
      progress.style.margin = "0";
      progress.style.color = "var(--muted)";
      progress.textContent = "…";
      bubble.append(progress);
    }
    container.append(bubble);
  }
  container.scrollTop = container.scrollHeight;
}
