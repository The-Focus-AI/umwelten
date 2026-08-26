/**
 * Built-in status component: renders the habitat's live /health readout.
 * Plain ESM per the serving contract — no build step, no framework. The
 * substrate is imported from the same base the shell serves it at.
 */

import { serviceKey } from "../substrate/index.js";

const regionKey = serviceKey("shell:region");
const baseKey = serviceKey("shell:base");

class HabitatStatus extends HTMLElement {
  connectedCallback() {
    this.classList.add("shell-card");
    this.innerHTML = `<h2>status</h2><dl></dl>`;
  }
  render(health) {
    this.hasData = true;
    const rows = {
      name: health.name ?? "—",
      status: health.status ?? "—",
      model: health.model ?? "—",
      tools: String(health.tools ?? "—"),
      auth: health.auth ?? "—",
    };
    this.querySelector("dl").innerHTML = Object.entries(rows)
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
      .join("");
    const title = document.getElementById("host-name");
    if (title && health.name) title.textContent = health.name;
  }
  renderError(message) {
    // A transient blip must not wipe good data: keep the last snapshot and
    // flag staleness; the next successful refresh clears it.
    if (this.hasData) {
      const dl = this.querySelector("dl");
      if (!dl.querySelector("[data-stale]")) {
        dl.insertAdjacentHTML(
          "beforeend",
          `<dt data-stale style="color:var(--error)">stale</dt><dd data-stale>${message}</dd>`,
        );
      }
      return;
    }
    this.querySelector("dl").innerHTML =
      `<dt>error</dt><dd>${message}</dd>`;
  }
}

if (!customElements.get("habitat-status")) {
  customElements.define("habitat-status", HabitatStatus);
}

export default {
  name: "status",
  inject: [regionKey, baseKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const base = view.get(baseKey);
    const el = document.createElement("habitat-status");
    el.dataset.component = "status"; // placement identity (ADR 0034)
    region.appendChild(el);

    const refresh = async () => {
      try {
        const res = await fetch(new URL("/health", base));
        el.render(await res.json());
      } catch (err) {
        el.renderError(err.message);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 15_000);
    ctx.effect(() => () => clearInterval(timer));

    return () => el.remove();
  },
};
