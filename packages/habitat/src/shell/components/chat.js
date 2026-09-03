/**
 * Chat component: renders the shared conversation transcript and sends
 * through the conversation service. Owns no conversation state — a
 * quick-prompt button (or any other component) sending through the same
 * service shows up here, because the transcript is the service's.
 */

import { serviceKey } from "../substrate/index.js";
import { renderConversation } from "../substrate/conversation-view.js";

const regionKey = serviceKey("shell:region");
const conversationKey = serviceKey("shell:conversation");

class HabitatChat extends HTMLElement {
  connectedCallback() {
    this.classList.add("shell-card");
    this.style.gridColumn = "1 / -1";
    this.innerHTML = `
      <h2>chat</h2>
      <div class="log" style="display:flex;flex-direction:column;gap:0.6rem;
        max-height:50vh;overflow-y:auto;padding:0.2rem 0;"></div>
      <form style="display:flex;gap:0.6rem;margin-top:0.8rem;">
        <input name="text" autocomplete="off" placeholder="say something…"
          style="flex:1;background:var(--bg);border:1px solid var(--line);
          border-radius:4px;color:var(--ink);font:inherit;padding:0.5rem 0.7rem;">
        <button style="background:var(--accent);border:0;border-radius:4px;
          color:var(--bg);font:inherit;font-weight:600;padding:0.5rem 1rem;
          cursor:pointer;">send</button>
      </form>`;
  }

  renderTranscript(messages) {
    const log = this.querySelector(".log");
    renderConversation(log, messages);
  }
}

if (!customElements.get("habitat-chat")) {
  customElements.define("habitat-chat", HabitatChat);
}

export default {
  name: "chat",
  inject: [regionKey, conversationKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const conversation = view.get(conversationKey);
    const el = document.createElement("habitat-chat");
    el.dataset.component = "chat"; // placement identity (ADR 0034)
    region.appendChild(el);

    const unsubscribe = conversation.subscribe((messages) =>
      el.renderTranscript(messages),
    );
    ctx.effect(() => unsubscribe);

    const form = el.querySelector("form");
    const input = el.querySelector("input");
    const onSubmit = (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      void conversation.send(text);
    };
    form.addEventListener("submit", onSubmit);
    ctx.effect(() => () => form.removeEventListener("submit", onSubmit));

    return () => el.remove();
  },
};
