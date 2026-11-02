/**
 * Sessions panel (#403): browse the habitat's sessions and open one to its
 * messages — a view over sessions_list / sessions_messages through
 * shell:tools, same no-private-routes rule as every panel.
 */

import { serviceKey } from "../substrate/index.js";

const regionKey = serviceKey("shell:region");
const toolsKey = serviceKey("shell:tools");
const conversationKey = serviceKey("shell:conversation");

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

export default {
  name: "sessions",
  inject: [regionKey, toolsKey, conversationKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const tools = view.get(toolsKey);
    const conversation = view.get(conversationKey);
    let sessions = [];

    const el = document.createElement("div");
    el.className = "shell-card";
    el.dataset.component = "sessions";
    el.innerHTML = `
      <h2>Sessions</h2>
      <button class="new-chat btn ghost sm" type="button">New chat</button>
      <p class="note">loading…</p>
      <ul></ul>`;
    region.appendChild(el);

    const note = el.querySelector(".note");
    const list = el.querySelector("ul");
    const updateSelection = () => {
      for (const button of el.querySelectorAll("button")) {
        button.disabled = conversation.busy || conversation.savingForLogin;
        if (button.dataset.session) button.setAttribute("aria-pressed", String(button.dataset.session === conversation.selectedSession));
      }
    };
    ctx.effect(() => conversation.subscribe(updateSelection));

    const refresh = async () => {
      try {
        const result = await tools.call("sessions_list", { limit: 15 });
        sessions = Array.isArray(result) ? result : (result.sessions ?? []);
        note.textContent = sessions.length ? "" : "No sessions yet";
        list.innerHTML = sessions
          .map(
            (s) => `<li>
              <button class="list-row" data-session="${esc(s.sessionId)}" type="button">
                <span class="name">${esc((s.firstPrompt ?? s.sessionId ?? "").slice(0, 70))}</span>
                <span class="meta">${esc(String(s.messageCount ?? "?"))} msgs</span>
              </button>
            </li>`,
          )
          .join("");
        updateSelection();
      } catch (err) {
        note.textContent = err.message;
      }
    };

    const onClick = async (e) => {
      const id = e.target.closest("[data-session]")?.dataset?.session;
      const session = sessions.find((s) => s.sessionId === id);
      if (!session) return;
      note.textContent = "Loading conversation…";
      try {
        await conversation.openSession(session);
        note.textContent = "";
        document.querySelector("habitat-chat")?.scrollIntoView({ block: "nearest" });
      } catch (err) {
        note.textContent = err.message;
      }
    };
    list.addEventListener("click", onClick);
    el.querySelector(".new-chat").onclick = () => { void conversation.newChat(); };
    ctx.effect(() => () => {
      list.removeEventListener("click", onClick);
    });

    void refresh();
    return () => el.remove();
  },
};
