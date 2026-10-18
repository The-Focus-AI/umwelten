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
  kind: "text" | "reasoning" | "tool" | "error" | "image";
  text?: string;
  name?: string;
  url?: string;
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
    bubble.className = "msg";
    bubble.dataset.role = message.role;
    for (const part of message.parts) {
      if (message.role === "user" && part.kind === "image") {
        if (
          /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(
            part.url ?? "",
          )
        ) {
          const image = document.createElement("img");
          image.src = part.url!;
          image.alt = part.name || "Uploaded image";
          Object.assign(image.style, {
            display: "block",
            maxWidth: "100%",
            maxHeight: "16rem",
            objectFit: "contain",
            margin: "0.3rem 0",
          });
          bubble.append(image);
        }
        continue;
      }
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
