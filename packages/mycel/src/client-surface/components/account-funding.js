import { customerKey, regionKey } from "./account-services.js";
import {
  button,
  card,
  errorLine,
  showError,
  trackSubscription,
} from "./account-ui.js";

export default {
  name: "account-funding",
  inject: [regionKey, customerKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const customer = view.get(customerKey);
    const element = card("account-funding", "02", "Funding");
    const body = element.querySelector(".account-card-body");
    region.append(element);
    const render = (state) => {
      const dashboard = state.dashboard;
      element.hidden = state.phase !== "ready" || !dashboard?.onboarded;
      if (element.hidden) return;
      body.replaceChildren();
      if (!dashboard.fundingConfigured) {
        const note = document.createElement("p");
        note.className = "account-note";
        note.textContent =
          "Payment funding is not active for this environment. An operator must configure Stripe before customer funds can move.";
        body.append(note);
        return;
      }
      const form = document.createElement("form");
      form.className = "account-form";
      form.innerHTML =
        '<label>Funding amount (USD)<input name="amount" type="number" min="5" max="5000" step="1" value="25" required></label>';
      const submit = button("Add funds", "primary");
      submit.type = "submit";
      const error = errorLine();
      form.append(submit);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        submit.disabled = true;
        error.hidden = true;
        try {
          const amountCents = Math.round(
            Number(form.elements.amount.value) * 100,
          );
          const result = await customer.request("/funding/checkout", {
            method: "POST",
            body: JSON.stringify({ amountCents }),
          });
          location.assign(result.url);
        } catch (cause) {
          showError(error, cause);
          submit.disabled = false;
        }
      });
      body.append(form, error);
    };
    trackSubscription(ctx, customer, render);
    return () => element.remove();
  },
};
