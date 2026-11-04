/** Operator-only metadata, supplied through Gaia's authenticated tool surface. */
import { serviceKey } from "../substrate/index.js";
const regionKey = serviceKey("shell:region");
const toolsKey = serviceKey("shell:tools");

export default {
  name: "operations",
  inject: [regionKey, toolsKey],
  apply(ctx, view) {
    const el = document.createElement("section");
    el.className = "shell-card";
    el.dataset.component = "operations";
    el.style.gridColumn = "1 / -1";
    el.innerHTML = `<h2>Operational health</h2><p class="note" role="status">Loading observations…</p>
      <p class="policy"></p><ul></ul><details><summary>Diagnostic decisions and recovery history</summary><div class="history"></div></details>`;
    view.get(regionKey).appendChild(el);
    let disposed = false;
    let loading = false;
    const note = el.querySelector(".note");
    const list = el.querySelector("ul");
    const history = el.querySelector(".history");
    const row = (text) => {
      const item = document.createElement("li");
      item.className = "list-row";
      item.textContent = text;
      return item;
    };
    const refresh = async () => {
      if (loading || disposed) return;
      loading = true;
      try {
        const report = await view.get(toolsKey).call("operational_status");
        if (disposed) return;
        if (report.version !== 1 || !Array.isArray(report.conditions))
          throw new Error("unavailable");
        const stale =
          report.stale ||
          !report.observedAt ||
          Date.now() - Date.parse(report.observedAt) > 120000;
        const active = report.conditions.filter((c) => c.state === "active");
        note.textContent = stale
          ? "Unknown — observations are unavailable or stale. Do not infer health."
          : `${active.filter((c) => c.severity !== "info").length} conditions need attention · observed ${new Date(report.observedAt).toLocaleTimeString()}`;
        el.querySelector(".policy").textContent =
          `Recovery ${report.recoveryEnabled ? "enabled by deployment policy" : "requires approval"}. Sleeping is not a failure. No private conversations or raw logs are collected.`;
        list.replaceChildren(
          ...active.map((c) =>
            row(`${c.severity.toUpperCase()} · ${c.subject} — ${c.summary}`),
          ),
        );
        if (!active.length && !stale)
          list.appendChild(
            row("No active conditions in the observed signals."),
          );
        history.replaceChildren(
          ...[
            ...(report.investigations ?? [])
              .slice(-20)
              .reverse()
              .map((i) => row(`${i.conditionId}: ${i.decision}`)),
            ...(report.actions ?? [])
              .slice(-10)
              .reverse()
              .map((a) =>
                row(`${a.subject}: ${a.action} — ${a.outcome} (${a.at})`),
              ),
          ],
        );
      } catch {
        if (!disposed) {
          note.textContent = "Unknown — operational status is unavailable.";
          list.replaceChildren();
          history.replaceChildren();
        }
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 30000);
    ctx.effect(() => () => {
      disposed = true;
      clearInterval(timer);
    });
    return () => el.remove();
  },
};
