/**
 * Habitats panel (#408): the fleet view, as a view over Gaia's orchestrator
 * tools — list_habitats / start_habitat / stop_habitat through shell:tools,
 * same no-private-routes rule as every panel. Listed only on hosts that
 * declare it (Gaia's shellEntries); on any other host the tools are absent
 * and the panel reports that instead of pretending.
 *
 * The composition move: for each RUNNING habitat with a public URL, this
 * panel mounts each peer's status projection through its one-time browser
 * login link. The child redeems that handoff before serving the sandboxed
 * iframe, so no static child key enters this page. Mounts hot-follow starts
 * and stops and cascade away with this panel under the ordering laws.
 */

import { serviceKey } from "../substrate/index.js";
import { mount } from "../substrate/component.js";
import foreignSpec from "./foreign.js";

const regionKey = serviceKey("shell:region");
const toolsKey = serviceKey("shell:tools");

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

function statusProjectionUrl(openUrl) {
  const url = new URL(openUrl);
  if (url.pathname === "/auth/handoff" || url.searchParams.has("return_to")) {
    url.searchParams.set("return_to", "/shell/solo/status/");
    return url.toString();
  }
  return new URL("/shell/solo/status/", url.origin).toString();
}

export default {
  name: "habitats",
  inject: [regionKey, toolsKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const tools = view.get(toolsKey);

    const el = document.createElement("div");
    el.className = "shell-card";
    el.dataset.component = "habitats";
    el.style.gridColumn = "1 / -1";
    el.innerHTML = `
      <h2>habitats</h2>
      <p class="note" style="margin:0 0 0.5rem;color:var(--muted);">loading fleet…</p>
      <ul style="list-style:none;margin:0;padding:0;display:flex;
        flex-direction:column;gap:0.4rem;"></ul>`;
    region.appendChild(el);
    const note = el.querySelector(".note");
    const list = el.querySelector("ul");

    /** Foreign mounts by habitat id → { fiber, unmount source-of-truth }. */
    const mounted = new Map();

    const reconcileMounts = (habitats) => {
      const wantMounted = new Map();
      for (const h of habitats) {
        if (h.status === "running" && h.url) {
          try {
            wantMounted.set(h.id, {
              title: `${h.name ?? h.id} — status`,
              url: statusProjectionUrl(h.url),
              resource: "ui://shell/status",
            });
          } catch {
            // no parseable public URL — nothing to mount
          }
        }
      }
      for (const [id, fiber] of mounted) {
        if (!wantMounted.has(id)) {
          void fiber.unmount();
          mounted.delete(id);
        }
      }
      for (const [id, config] of wantMounted) {
        if (!mounted.has(id)) {
          mounted.set(id, mount(ctx, foreignSpec, config));
        }
      }
    };

    const refresh = async () => {
      try {
        const result = await tools.call("list_habitats");
        const habitats = Array.isArray(result) ? result : [];
        note.textContent = habitats.length ? "" : "no habitats registered";
        list.innerHTML = habitats
          .map((h) => {
            const running = h.status === "running";
            const dot = running ? "var(--accent)" : "var(--muted)";
            return `<li style="display:flex;align-items:center;gap:0.7rem;">
              <span style="width:0.6rem;height:0.6rem;border-radius:50%;
                background:${dot};flex-shrink:0;"></span>
              <span style="flex:1;min-width:8rem;">${esc(h.name ?? h.id)}
                <span style="color:var(--muted);font-size:0.75rem;">
                  ${esc(h.status)} · ${esc(h.model ?? "")}</span></span>
              ${h.url && running ? `<a href="${esc(h.url)}" target="_blank" style="color:var(--accent);font-size:0.75rem;">open</a>` : ""}
              <button data-action="${running ? "stop" : "start"}" data-id="${esc(h.id)}"
                style="background:none;border:1px solid var(--line);border-radius:4px;
                color:var(--muted);font:inherit;font-size:0.75rem;
                padding:0.1rem 0.6rem;cursor:pointer;">${running ? "stop" : "start"}</button>
            </li>`;
          })
          .join("");
        reconcileMounts(habitats);
      } catch (err) {
        note.textContent = err.message;
      }
    };

    const onClick = async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      btn.disabled = true;
      btn.textContent = "…";
      try {
        await tools.call(
          btn.dataset.action === "stop" ? "stop_habitat" : "start_habitat",
          { id: btn.dataset.id },
        );
      } catch (err) {
        note.textContent = err.message;
      }
      await refresh();
    };
    list.addEventListener("click", onClick);
    ctx.effect(() => () => list.removeEventListener("click", onClick));

    void refresh();
    const timer = setInterval(refresh, 20_000);
    ctx.effect(() => () => clearInterval(timer));

    // The foreign fibers are children of this activation context, so
    // deactivation cascades them; el.remove() is only our own card.
    return () => el.remove();
  },
};
