import { customerKey, regionKey } from "./account-services.js";
import { card, empty, money, trackSubscription } from "./account-ui.js";

export default {
  name: "account-usage",
  inject: [regionKey, customerKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const customer = view.get(customerKey);
    const element = card("account-usage", "05", "Recent usage");
    const body = element.querySelector(".account-card-body");
    region.append(element);
    const render = (state) => {
      const dashboard = state.dashboard;
      element.hidden = state.phase !== "ready" || !dashboard?.onboarded;
      if (element.hidden) return;
      body.replaceChildren();
      const list = document.createElement("ul");
      list.className = "account-list";
      for (const request of dashboard.requests ?? []) {
        const item = document.createElement("li");
        item.className = "account-usage-row";
        const values = [
          request.model,
          request.applicationId,
          `${(request.promptTokens || 0) + (request.completionTokens || 0)} tokens`,
          money(request.charge),
          request.outcome,
        ];
        values.forEach((value, index) => {
          const cell = document.createElement(index === 0 ? "strong" : "span");
          cell.textContent = value ?? "—";
          item.append(cell);
        });
        list.append(item);
      }
      if (!list.children.length)
        list.append(empty("Requests will appear after your first completion."));
      body.append(list);
    };
    trackSubscription(ctx, customer, render);
    return () => element.remove();
  },
};
