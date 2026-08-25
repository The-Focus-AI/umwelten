/**
 * Models catalogue component: renders `GET /v1/models` live — what this
 * Exchange can serve, one row per Model, priced at the cheapest eligible
 * Offer. The endpoint is deliberately unauthenticated (the catalogue is not
 * secret) and reveals no Supplier, so neither does this card.
 */

import { serviceKey } from "../substrate/index.js";

const regionKey = serviceKey("shell:region");
const baseKey = serviceKey("shell:base");

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

const dollars = (n) =>
  typeof n === "number" ? `$${n.toFixed(2)}/M` : "—";

export default {
  name: "models",
  inject: [regionKey, baseKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const base = view.get(baseKey);

    const el = document.createElement("div");
    el.className = "shell-card";
    el.dataset.component = "models";
    el.style.gridColumn = "1 / -1";
    el.innerHTML = `
      <h2>models</h2>
      <p class="note" style="margin:0 0 0.5rem;color:var(--muted);">loading catalogue…</p>
      <div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;
        font-size:0.85rem;"></table></div>`;
    region.appendChild(el);
    const note = el.querySelector(".note");
    const table = el.querySelector("table");

    const td = "padding:0.25rem 0.8rem 0.25rem 0;text-align:left;";
    const refresh = async () => {
      try {
        const res = await fetch(new URL("/v1/models", base));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { data } = await res.json();
        const models = Array.isArray(data) ? data : [];
        note.textContent = models.length ? "" : "no models on offer";
        table.innerHTML = models.length
          ? `<tr style="color:var(--muted);">
              <th style="${td}">model</th><th style="${td}">prompt</th>
              <th style="${td}">completion</th><th style="${td}">context</th>
              <th style="${td}">capabilities</th><th style="${td}">guarantees</th>
            </tr>` +
            models
              .map(
                (m) => `<tr style="border-top:1px solid var(--line);">
              <td style="${td}">${esc(m.id)}</td>
              <td style="${td}">${dollars(m.pricing?.prompt)}</td>
              <td style="${td}">${dollars(m.pricing?.completion)}</td>
              <td style="${td}">${m.context_length ? esc(m.context_length) : "—"}</td>
              <td style="${td}color:var(--muted);">${esc((m.capabilities ?? []).join(", ") || "—")}</td>
              <td style="${td}color:var(--muted);">${esc((m.guarantees ?? []).join(", ") || "—")}</td>
            </tr>`,
              )
              .join("")
          : "";
      } catch (err) {
        note.textContent = err.message;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 30_000);
    ctx.effect(() => () => clearInterval(timer));

    return () => el.remove();
  },
};
