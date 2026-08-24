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
      <h2>sessions</h2>
      <p class="note" style="margin:0 0 0.5rem;color:var(--muted);">loading…</p>
      <ul style="list-style:none;margin:0;padding:0;display:flex;
        flex-direction:column;gap:0.3rem;max-height:16rem;overflow-y:auto;"></ul>
      <div class="detail" style="display:none;margin-top:0.6rem;">
        <button class="back" style="background:none;border:1px solid var(--line);
          border-radius:4px;color:var(--muted);font:inherit;font-size:0.75rem;
          padding:0.15rem 0.6rem;cursor:pointer;margin-bottom:0.5rem;">← back</button>
        <div class="messages" style="display:flex;flex-direction:column;gap:0.4rem;
          max-height:16rem;overflow-y:auto;"></div>
      </div>`;
    region.appendChild(el);

    const note = el.querySelector(".note");
    const list = el.querySelector("ul");
    const detail = el.querySelector(".detail");
    const messages = el.querySelector(".messages");

    const showList = () => {
      detail.style.display = "none";
      list.style.display = "flex";
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
            const border = role === "user" ? "var(--accent)" : "var(--line)";
            return `<div style="border-left:2px solid ${border};padding:0.1rem 0.6rem;">
              <span style="color:var(--muted);font-size:0.75rem;">${esc(role)}</span>
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
        note.textContent = sessions.length ? "" : "no sessions yet";
        list.innerHTML = sessions
          .map(
            (s) => `<li><button data-session="${esc(s.sessionId)}"
              style="width:100%;text-align:left;background:var(--bg);
              border:1px solid var(--line);border-radius:4px;color:var(--ink);
              font:inherit;font-size:0.8rem;padding:0.35rem 0.6rem;cursor:pointer;">
              ${esc((s.firstPrompt ?? s.sessionId ?? "").slice(0, 70))}
              <span style="color:var(--muted);"> · ${esc(String(s.messageCount ?? "?"))} msgs</span>
            </button></li>`,
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
