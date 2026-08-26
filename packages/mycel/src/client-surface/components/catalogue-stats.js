/**
 * Catalogue-at-a-glance: the summary view over `GET /v1/models` — how many
 * Models are on offer, the price floor, and the capability union.
 *
 * This component is the exercised promotion path of #410: it was grown as an
 * agent-authored module in a dev Exchange's components directory (where the
 * self-assembly loop serves it as `custom:catalogue-stats`), then promoted
 * verbatim into the built-in roster — the only edits promotion makes are
 * this header and the ENTRIES row in serve.ts. Same read-only rule as every
 * client-surface component: it observes the Exchange, nothing more.
 */

import { serviceKey } from "../substrate/index.js";

const regionKey = serviceKey("shell:region");
const baseKey = serviceKey("shell:base");

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

export default {
  name: "catalogue-stats",
  inject: [regionKey, baseKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const base = view.get(baseKey);

    const el = document.createElement("div");
    el.className = "shell-card";
    el.dataset.component = "catalogue-stats";
    el.innerHTML = `<h2>catalogue</h2><dl></dl>`;
    region.appendChild(el);
    const dl = el.querySelector("dl");

    const refresh = async () => {
      try {
        const res = await fetch(new URL("/v1/models", base));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { data } = await res.json();
        const models = Array.isArray(data) ? data : [];
        const completions = models
          .map((m) => m.pricing?.completion)
          .filter((p) => typeof p === "number");
        const capabilities = [
          ...new Set(models.flatMap((m) => m.capabilities ?? [])),
        ].sort();
        dl.innerHTML = `
          <dt>models on offer</dt><dd>${models.length}</dd>
          <dt>completion from</dt>
          <dd>${completions.length ? `$${Math.min(...completions).toFixed(2)}/M` : "—"}</dd>
          <dt>capabilities</dt>
          <dd>${esc(capabilities.join(", ") || "—")}</dd>`;
      } catch (err) {
        dl.innerHTML = `<dt>error</dt><dd>${esc(err.message)}</dd>`;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 30_000);
    ctx.effect(() => () => clearInterval(timer));

    return () => el.remove();
  },
};
