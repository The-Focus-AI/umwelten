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
      <h2>Secrets</h2>
      <p class="note">This habitat's own store — on Gaia, the fleet vault is separate</p>
      <ul class="secret-list"></ul>
      <p class="note empty"></p>
      <form class="composer">
        <input class="input" name="name" placeholder="NAME" autocomplete="off" spellcheck="false">
        <input class="input" name="value" placeholder="value" type="password" autocomplete="off">
        <button class="btn primary" type="submit">Set</button>
      </form>`;
    region.appendChild(el);

    const list = el.querySelector("ul");
    const note = el.querySelector(".empty");
    const form = el.querySelector("form");

    const refresh = async () => {
      try {
        const result = await tools.call("secrets_list");
        const names = Array.isArray(result) ? result : (result.secrets ?? result.names ?? []);
        note.textContent = names.length ? "" : "No secrets set";
        list.innerHTML = names
          .map((n) => {
            const name = typeof n === "string" ? n : n.name;
            return `<li class="list-row">
              <code class="name">${esc(name)}</code>
              <button class="btn ghost sm" data-remove="${esc(name)}" type="button">Remove</button>
            </li>`;
          })
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
