/**
 * Sessions panel (#403): browse the habitat's sessions and open one to its
 * messages — a view over sessions_list / sessions_messages through
 * shell:tools, same no-private-routes rule as every panel.
 */

import { serviceKey } from "../substrate/index.js";

const regionKey = serviceKey("shell:region");
const toolsKey = serviceKey("shell:tools");

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

export default {
  name: "sessions",
  inject: [regionKey, toolsKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const tools = view.get(toolsKey);

    const el = document.createElement("div");
    el.className = "shell-card";
    el.dataset.component = "sessions";
    el.innerHTML = `
      <h2>Sessions</h2>
      <p class="note">loading…</p>
      <ul></ul>
      <div class="detail" style="display:none;margin-top:0.6rem;">
        <button class="back btn ghost sm" type="button">← Back</button>
        <div class="messages chat-log"></div>
      </div>`;
    region.appendChild(el);

    const note = el.querySelector(".note");
    const list = el.querySelector("ul");
    const detail = el.querySelector(".detail");
    const messages = el.querySelector(".messages");

    const showList = () => {
      detail.style.display = "none";
      list.style.display = "block";
    };

    const openSession = async (sessionId) => {
      try {
        const result = await tools.call("sessions_messages", {
          sessionId,
          limit: 50,
        });
        const msgs = Array.isArray(result) ? result : (result.messages ?? []);
        messages.innerHTML = msgs
          .map((m) => {
            const role = m.role ?? "?";
            const text =
              typeof m.content === "string"
                ? m.content
                : (m.text ?? JSON.stringify(m.content ?? m));
            return `<div class="msg" data-role="${esc(role)}">
              <span class="meta">${esc(role)}</span>
              <p style="margin:0.1rem 0 0;white-space:pre-wrap;">${esc(String(text).slice(0, 500))}</p></div>`;
          })
          .join("");
        list.style.display = "none";
        detail.style.display = "block";
      } catch (err) {
        note.textContent = err.message;
      }
    };

    const refresh = async () => {
      try {
        const result = await tools.call("sessions_list", { limit: 15 });
        const sessions = Array.isArray(result) ? result : (result.sessions ?? []);
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
      } catch (err) {
        note.textContent = err.message;
      }
    };

    const onClick = (e) => {
      const id = e.target.closest("[data-session]")?.dataset?.session;
      if (id) void openSession(id);
    };
    const onBack = () => showList();
    list.addEventListener("click", onClick);
    el.querySelector(".back").addEventListener("click", onBack);
    ctx.effect(() => () => {
      list.removeEventListener("click", onClick);
    });

    void refresh();
    return () => el.remove();
  },
};
