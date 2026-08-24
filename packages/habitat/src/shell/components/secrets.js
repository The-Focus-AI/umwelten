/**
 * Secrets panel (#402): strictly a view over the secrets_* tools through
 * shell:tools — no panel-private routes. Values are write-only: the input
 * clears on submit and nothing a secret contains is ever rendered.
 */

import { serviceKey } from "../substrate/index.js";

const regionKey = serviceKey("shell:region");
const toolsKey = serviceKey("shell:tools");

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

export default {
  name: "secrets",
  inject: [regionKey, toolsKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const tools = view.get(toolsKey);

    const el = document.createElement("div");
    el.className = "shell-card";
    el.dataset.component = "secrets";
    el.innerHTML = `
      <h2>secrets</h2>
      <ul style="list-style:none;margin:0 0 0.8rem;padding:0;display:flex;
        flex-direction:column;gap:0.3rem;"></ul>
      <p class="note" style="margin:0 0 0.8rem;color:var(--muted);"></p>
      <form style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        <input name="name" placeholder="NAME" autocomplete="off" spellcheck="false"
          style="flex:1;min-width:8rem;background:var(--bg);border:1px solid var(--line);
          border-radius:4px;color:var(--ink);font:inherit;padding:0.4rem 0.6rem;">
        <input name="value" placeholder="value" type="password" autocomplete="off"
          style="flex:2;min-width:10rem;background:var(--bg);border:1px solid var(--line);
          border-radius:4px;color:var(--ink);font:inherit;padding:0.4rem 0.6rem;">
        <button style="background:var(--accent);border:0;border-radius:4px;
          color:var(--bg);font:inherit;font-weight:600;padding:0.4rem 0.9rem;
          cursor:pointer;">set</button>
      </form>`;
    region.appendChild(el);

    const list = el.querySelector("ul");
    const note = el.querySelector(".note");
    const form = el.querySelector("form");

    const refresh = async () => {
      try {
        const result = await tools.call("secrets_list");
        const names = Array.isArray(result) ? result : (result.secrets ?? result.names ?? []);
        note.textContent = names.length ? "" : "no secrets set";
        list.innerHTML = names
          .map(
            (n) => `<li style="display:flex;align-items:center;gap:0.6rem;">
              <code style="flex:1;">${esc(typeof n === "string" ? n : n.name)}</code>
              <button data-remove="${esc(typeof n === "string" ? n : n.name)}"
                style="background:none;border:1px solid var(--line);border-radius:4px;
                color:var(--muted);font:inherit;font-size:0.75rem;padding:0.1rem 0.5rem;
                cursor:pointer;">remove</button></li>`,
          )
          .join("");
      } catch (err) {
        note.textContent = err.message;
      }
    };

    const onClick = async (e) => {
      const name = e.target?.dataset?.remove;
      if (!name) return;
      try {
        await tools.call("secrets_remove", { name });
        await refresh();
      } catch (err) {
        note.textContent = err.message;
      }
    };
    const onSubmit = async (e) => {
      e.preventDefault();
      const name = form.elements.name.value.trim();
      const value = form.elements.value.value;
      if (!name || !value) return;
      form.elements.value.value = ""; // write-only: clear before the call returns
      try {
        await tools.call("secrets_set", { name, value });
        form.elements.name.value = "";
        await refresh();
      } catch (err) {
        note.textContent = err.message;
      }
    };
    list.addEventListener("click", onClick);
    form.addEventListener("submit", onSubmit);
    ctx.effect(() => () => {
      list.removeEventListener("click", onClick);
      form.removeEventListener("submit", onSubmit);
    });

    void refresh();
    return () => el.remove();
  },
};
