/**
 * Exchange health component: renders `/health` live. That endpoint reports
 * whether the **store** is reachable, not merely whether the process is up —
 * so this card is honest about the one failure that matters. Plain ESM per
 * the serving contract; read-only over an endpoint that already exists.
 */

import { serviceKey } from "../substrate/index.js";

const regionKey = serviceKey("shell:region");
const baseKey = serviceKey("shell:base");

class ExchangeHealth extends HTMLElement {
  connectedCallback() {
    this.classList.add("shell-card");
    this.innerHTML = `<h2>exchange</h2><dl></dl>`;
  }
  render(health) {
    this.hasData = true;
    const degraded = health.status !== "ok";
    this.querySelector("dl").innerHTML = `
      <dt>status</dt>
      <dd style="${degraded ? "color:var(--error)" : "color:var(--accent)"}">${health.status ?? "—"}</dd>
      ${health.store ? `<dt>store</dt><dd style="color:var(--error)">${health.store}</dd>` : ""}`;
    const title = document.getElementById("host-name");
    if (title) title.textContent = "mycel — the Exchange";
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
    this.querySelector("dl").innerHTML = `<dt>error</dt><dd>${message}</dd>`;
  }
}

if (!customElements.get("exchange-health")) {
  customElements.define("exchange-health", ExchangeHealth);
}

export default {
  name: "health",
  inject: [regionKey, baseKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const base = view.get(baseKey);
    const el = document.createElement("exchange-health");
    region.appendChild(el);

    const refresh = async () => {
      try {
        const res = await fetch(new URL("/health", base));
        const stale = document.querySelectorAll("exchange-health [data-stale]");
        el.render(await res.json());
        for (const n of stale) n.remove();
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
