/**
 * Quick prompts: canned questions sent through the shared conversation
 * service. Deliberately trivial — it exists to prove the service is a
 * shared seam, not the chat component's private state: a click here
 * appears in the chat transcript.
 */

import { serviceKey } from "../substrate/index.js";

const regionKey = serviceKey("shell:region");
const conversationKey = serviceKey("shell:conversation");

const DEFAULT_PROMPTS = [
  "What tools do you have?",
  "What have you been working on recently?",
];

export default {
  name: "quick-prompts",
  inject: [regionKey, conversationKey],
  apply(ctx, view, config) {
    const region = view.get(regionKey);
    const conversation = view.get(conversationKey);
    const prompts = config?.prompts ?? DEFAULT_PROMPTS;

    const el = document.createElement("div");
    el.className = "shell-card";
    el.dataset.component = "quick-prompts";
    el.innerHTML = `<h2>quick prompts</h2>
      <div style="display:flex;flex-direction:column;gap:0.5rem;"></div>`;
    const list = el.querySelector("div");
    for (const prompt of prompts) {
      const btn = document.createElement("button");
      btn.textContent = prompt;
      btn.style.cssText =
        "background:var(--bg);border:1px solid var(--line);border-radius:4px;" +
        "color:var(--ink);font:inherit;padding:0.45rem 0.7rem;cursor:pointer;" +
        "text-align:left;";
      btn.addEventListener("click", () => void conversation.send(prompt));
      list.appendChild(btn);
    }
    region.appendChild(el);
    return () => el.remove();
  },
};
