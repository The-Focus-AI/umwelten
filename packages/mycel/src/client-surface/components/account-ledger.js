import { customerKey, regionKey } from "./account-services.js";
import { card, empty, money, trackSubscription } from "./account-ui.js";

export default {
  name: "account-ledger",
  inject: [regionKey, customerKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const customer = view.get(customerKey);
    const element = card("account-ledger", "03", "Ledger history");
    const body = element.querySelector(".account-card-body");
    region.append(element);
    const render = (state) => {
      const dashboard = state.dashboard;
      element.hidden = state.phase !== "ready" || !dashboard?.onboarded;
      if (element.hidden) return;
      body.replaceChildren();
      const list = document.createElement("ul");
      list.className = "account-list account-ledger";
      for (const entry of dashboard.ledger ?? []) {
        const item = document.createElement("li");
        const details = document.createElement("div");
        const reason = document.createElement("strong");
        reason.textContent = entry.reason || "Ledger entry";
        const date = document.createElement("time");
        date.textContent = new Date(entry.createdAt).toLocaleString();
        details.append(reason, date);
        const amount = document.createElement("span");
        amount.className = "account-amount";
        amount.textContent = money(entry.microDollars);
        item.append(details, amount);
        list.append(item);
      }
      if (!list.children.length) list.append(empty("No ledger entries yet."));
      body.append(list);
    };
    trackSubscription(ctx, customer, render);
    return () => element.remove();
  },
};
