/**
 * Shared, host-neutral conversation rendering for Shell components.
 *
 * A Habitat supplies messages from its persistent conversation service; the
 * Mycel playground supplies OpenAI response deltas. This module owns only the
 * safe DOM projection, so neither host has to recreate chat presentation and
 * neither host's transport leaks into the other.
 */

import { renderMarkdown } from "./markdown.js";

export interface ConversationPart {
  kind: "text" | "reasoning" | "tool" | "error";
  text?: string;
  name?: string;
  input?: unknown;
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

// Keep the user's disclosure choice across streaming rerenders. Hosts retain
// part identity as results arrive; weak keys release old transcripts and views.
const toolViews = new WeakMap<
  HTMLElement,
  WeakMap<ConversationPart, HTMLDetailsElement>
>();

function renderTool(
  part: ConversationPart,
  streaming: boolean | undefined,
  views: WeakMap<ConversationPart, HTMLDetailsElement>,
): HTMLDetailsElement {
  const complete = part.output !== undefined;
  const previous = views.get(part);
  const details = document.createElement("details");
  details.dataset.complete = String(complete);
  details.open =
    previous?.dataset.complete === String(complete) ? previous.open : !complete;
  details.style.color = "var(--muted)";
  const summary = document.createElement("summary");
  summary.style.cursor = "pointer";
  summary.textContent = `⚡ ${text(part.name)} — ${complete ? "complete ✓" : streaming === false ? "no result" : "running…"}`;
  details.append(summary);
  for (const [label, value] of [
    ["Input", part.input],
    ["Result", part.output],
  ] as const) {
    if (value === undefined) continue;
    const title = document.createElement("div");
    title.textContent = label;
    const content = document.createElement("pre");
    content.textContent =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    Object.assign(content.style, {
      margin: "0.25rem 0 0.5rem",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      maxHeight: "16rem",
      overflowY: "auto",
      color: "var(--ink)",
      font: "inherit",
    });
    details.append(title, content);
  }
  if (!complete) {
    const pending = document.createElement("div");
    pending.textContent =
      streaming === false ? "No result received." : "Waiting for result…";
    details.append(pending);
  }
  views.set(part, details);
  return details;
}

/** Model output is data, never trusted HTML; only assistant text is Markdown. */
export function renderConversation(
  container: HTMLElement,
  messages: ConversationMessage[],
): void {
  let views = toolViews.get(container);
  if (!views) {
    views = new WeakMap();
    toolViews.set(container, views);
  }
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
      if (message.role === "assistant" && part.kind === "text") {
        bubble.append(renderMarkdown(text(part.text)));
        continue;
      }
      if (part.kind === "tool") {
        bubble.append(renderTool(part, message.streaming, views));
        continue;
      }
      const line = document.createElement("p");
      line.style.margin = "0";
      line.style.whiteSpace = "pre-wrap";
      if (part.kind === "reasoning") {
        line.style.color = "var(--muted)";
        line.style.fontStyle = "italic";
        line.textContent = text(part.text);
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
