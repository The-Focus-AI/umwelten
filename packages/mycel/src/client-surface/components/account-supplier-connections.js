import { customerKey, regionKey } from "./account-services.js";
import { card, empty, trackSubscription } from "./account-ui.js";

const when = (value) => (value ? new Date(value).toLocaleString() : "Never");

export default {
  name: "account-supplier-connections",
  inject: [regionKey, customerKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const customer = view.get(customerKey);
    const element = card(
      "account-supplier-connections",
      "Admin",
      "Supplier connections",
    );
    const body = element.querySelector(".account-card-body");
    region.append(element);

    const render = (state) => {
      const dashboard = state.dashboard;
      element.hidden = state.phase !== "ready" || !dashboard?.canAdminGrant;
      if (element.hidden) return;
      body.replaceChildren();
      const list = document.createElement("ul");
      list.className = "account-list";
      for (const supplier of dashboard.supplierConnections ?? []) {
        const item = document.createElement("li");
        const details = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = supplier.displayName || supplier.id;
        const status = document.createElement("small");
        status.textContent = supplier.connected
          ? `● Connected since ${when(supplier.connectedAt)} · ${supplier.inFlight} in flight`
          : `○ Disconnected · last: ${when(supplier.lastDisconnectAt)}${
              supplier.lastDisconnectReason
                ? ` (${supplier.lastDisconnectReason})`
                : ""
            }`;
        status.style.color = supplier.connected ? "#77c593" : "var(--muted)";
        const id = document.createElement("code");
        id.textContent = `${supplier.id}${supplier.enabled ? "" : " · disabled"}`;
        details.append(name, status, id);
        item.append(details);
        list.append(item);
      }
      if (!list.children.length)
        list.append(empty("No machine Suppliers are registered."));
      body.append(list);
    };
    trackSubscription(ctx, customer, render);

    const timer = setInterval(() => {
      if (!element.hidden) void customer.refresh();
    }, 15_000);
    ctx.effect(() => () => clearInterval(timer));
    return () => element.remove();
  },
};
