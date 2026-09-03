import { customerKey, regionKey } from "./account-services.js";
import {
  button,
  card,
  errorLine,
  showError,
  trackSubscription,
} from "./account-ui.js";

export default {
  name: "account-admin-grant",
  inject: [regionKey, customerKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const customer = view.get(customerKey);
    const element = card("account-admin-grant", "Admin", "Grant credit");
    const body = element.querySelector(".account-card-body");
    const note = document.createElement("p");
    note.className = "account-note";
    note.textContent =
      "Operator grant—not a payment. Every credit is appended to the ledger with your Clerk subject and reason.";
    const form = document.createElement("form");
    form.className = "account-form";
    form.innerHTML =
      '<label>Amount (USD)<input name="amount" type="number" min="0.01" max="5000" step="0.01" value="25" required></label><label>Reason<input name="reason" maxlength="200" placeholder="Client review credit" required></label>';
    const submit = button("Grant account credit", "primary");
    submit.type = "submit";
    const error = errorLine();
    form.append(submit, error);
    body.append(note, form);
    region.append(element);

    const render = (state) => {
      element.hidden =
        state.phase !== "ready" ||
        !state.dashboard?.onboarded ||
        !state.dashboard?.canAdminGrant;
    };
    trackSubscription(ctx, customer, render);

    const onSubmit = async (event) => {
      event.preventDefault();
      submit.disabled = true;
      error.hidden = true;
      try {
        const values = new FormData(form);
        const amountCents = Math.round(Number(values.get("amount")) * 100);
        await customer.request("/admin/grants", {
          method: "POST",
          body: JSON.stringify({
            amountCents,
            reason: values.get("reason"),
          }),
        });
        form.reset();
        await customer.refresh();
      } catch (cause) {
        showError(error, cause);
      } finally {
        submit.disabled = false;
      }
    };
    form.addEventListener("submit", onSubmit);
    ctx.effect(() => () => form.removeEventListener("submit", onSubmit));
    return () => element.remove();
  },
};
