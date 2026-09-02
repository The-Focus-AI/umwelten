import { authKey, customerKey, regionKey } from "./account-services.js";
import {
  button,
  card,
  errorLine,
  money,
  showCredential,
  showError,
  trackSubscription,
} from "./account-ui.js";

export default {
  name: "account-overview",
  inject: [regionKey, authKey, customerKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const auth = view.get(authKey);
    const customer = view.get(customerKey);
    const element = card("account-overview", "Account", "Your connection");
    const body = element.querySelector(".account-card-body");
    let fundingResult = new URLSearchParams(location.search).get("funding");
    region.append(element);

    const render = (state) => {
      body.replaceChildren();
      if (state.phase === "loading") {
        body.textContent = "Reading the network…";
        return;
      }
      if (state.phase === "unavailable") {
        const error = errorLine();
        showError(
          error,
          "Customer authentication is not configured in this environment.",
        );
        body.append(error);
        return;
      }
      if (state.phase === "error") {
        const error = errorLine();
        showError(error, state.error);
        body.append(error);
        return;
      }
      if (state.phase === "signed-out") {
        const gate = document.createElement("div");
        gate.className = "account-gate";
        gate.innerHTML =
          "<h1>Connect to your account.</h1><p>Sign in to manage Applications, funding, usage, and your team—or create an account to begin.</p>";
        const actions = document.createElement("div");
        actions.className = "account-actions";
        const signIn = button("Sign in");
        const signUp = button("Create account", "primary");
        signIn.addEventListener("click", auth.signIn);
        signUp.addEventListener("click", auth.signUp);
        actions.append(signIn, signUp);
        gate.append(actions);
        body.append(gate);
        return;
      }
      const dashboard = state.dashboard;
      if (!dashboard?.onboarded) {
        const intro = document.createElement("div");
        intro.className = "account-gate";
        intro.innerHTML =
          "<h1>Grow your first connection.</h1><p>Name your Client and first Application. Mycel will issue an API key once and retain only its cryptographic hash.</p>";
        const form = document.createElement("form");
        form.className = "account-form two";
        form.innerHTML =
          '<label>Client name<input name="clientName" maxlength="120" placeholder="Acme Labs" required></label><label>First Application<input name="applicationName" maxlength="80" placeholder="Research assistant" required></label>';
        const submit = button("Create Client + key", "primary");
        submit.type = "submit";
        const error = errorLine();
        form.append(submit);
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          submit.disabled = true;
          error.hidden = true;
          try {
            const values = new FormData(form);
            const result = await customer.request("/onboard", {
              method: "POST",
              body: JSON.stringify({
                clientName: values.get("clientName"),
                applicationName: values.get("applicationName"),
              }),
            });
            showCredential(result.credential);
            await customer.refresh();
          } catch (cause) {
            showError(error, cause);
          } finally {
            submit.disabled = false;
          }
        });
        intro.append(form, error);
        body.append(intro);
        return;
      }
      if (fundingResult) {
        const notice = document.createElement("p");
        notice.className = "account-invite";
        notice.textContent =
          fundingResult === "success"
            ? "Checkout returned successfully. Your balance updates when Stripe's verified webhook arrives."
            : "Funding checkout was cancelled; no charge was made.";
        body.append(notice);
        fundingResult = null;
        history.replaceState({}, "", `/account/${location.hash}`);
      }
      const hero = document.createElement("div");
      hero.className = "account-hero";
      const identity = document.createElement("div");
      identity.innerHTML = '<span class="account-kicker">Client account</span>';
      const heading = document.createElement("h1");
      heading.textContent = dashboard.client.name;
      identity.append(heading);
      const vitals = document.createElement("div");
      vitals.className = "account-vitals";
      const balance = document.createElement("div");
      balance.innerHTML = "<span>Ledger balance</span>";
      const balanceValue = document.createElement("strong");
      balanceValue.textContent = money(dashboard.balance?.microDollars);
      balance.append(balanceValue);
      const limit = document.createElement("div");
      limit.innerHTML = "<span>Postpaid limit</span>";
      const limitValue = document.createElement("strong");
      limitValue.textContent = money(dashboard.client.creditLimitMicroDollars);
      limit.append(limitValue);
      vitals.append(balance, limit);
      hero.append(identity, vitals);
      body.append(hero);
    };
    trackSubscription(ctx, customer, render);
    return () => element.remove();
  },
};
