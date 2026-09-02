import { customerKey, regionKey } from "./account-services.js";
import {
  button,
  card,
  empty,
  errorLine,
  money,
  showCredential,
  showError,
  trackSubscription,
} from "./account-ui.js";

export default {
  name: "account-applications",
  inject: [regionKey, customerKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const customer = view.get(customerKey);
    const element = card("account-applications", "01", "Applications");
    const body = element.querySelector(".account-card-body");
    region.append(element);

    const mutate = async (control, path, options, error) => {
      control.disabled = true;
      error.hidden = true;
      try {
        return await customer.request(path, options);
      } catch (cause) {
        showError(error, cause);
      } finally {
        control.disabled = false;
      }
    };
    const render = (state) => {
      const dashboard = state.dashboard;
      element.hidden = state.phase !== "ready" || !dashboard?.onboarded;
      if (element.hidden) return;
      body.replaceChildren();
      const error = errorLine();
      const form = document.createElement("form");
      form.className = "account-form two";
      form.innerHTML =
        '<label>New Application<input name="name" maxlength="80" placeholder="Research assistant" required></label>';
      const create = button("Create + key", "primary");
      create.type = "submit";
      form.append(create);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const result = await mutate(
          create,
          "/applications",
          {
            method: "POST",
            body: JSON.stringify({ applicationName: form.elements.name.value }),
          },
          error,
        );
        if (result) {
          form.reset();
          showCredential(result.credential);
          await customer.refresh();
        }
      });
      const list = document.createElement("ul");
      list.className = "account-list";
      for (const application of dashboard.applications ?? []) {
        const item = document.createElement("li");
        const details = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = application.name || application.id;
        const meta = document.createElement("small");
        meta.textContent = `${application.enabled ? "Active" : "Disabled"} · ${application.hasCredential ? "Key active" : "No active key"} · ${money(application.balance?.microDollars)}`;
        details.append(name, meta);
        const actions = document.createElement("div");
        actions.className = "account-row-actions";
        const toggle = button(application.enabled ? "Disable" : "Enable");
        const rotate = button("Rotate key");
        const revoke = button("Revoke key", "danger");
        revoke.disabled = !application.hasCredential;
        toggle.addEventListener("click", async () => {
          if (!confirm(`${toggle.textContent} ${name.textContent}?`)) return;
          const result = await mutate(
            toggle,
            `/applications/${encodeURIComponent(application.id)}/enabled`,
            {
              method: "POST",
              body: JSON.stringify({ enabled: !application.enabled }),
            },
            error,
          );
          if (result) await customer.refresh();
        });
        rotate.addEventListener("click", async () => {
          if (!confirm(`Rotate the key for ${name.textContent}?`)) return;
          const result = await mutate(
            rotate,
            `/applications/${encodeURIComponent(application.id)}/rotate`,
            { method: "POST" },
            error,
          );
          if (result) {
            showCredential(result.credential);
            await customer.refresh();
          }
        });
        revoke.addEventListener("click", async () => {
          if (!confirm(`Revoke the key for ${name.textContent}?`)) return;
          const result = await mutate(
            revoke,
            `/applications/${encodeURIComponent(application.id)}/revoke`,
            { method: "POST" },
            error,
          );
          if (result) await customer.refresh();
        });
        actions.append(toggle, rotate, revoke);
        item.append(details, actions);
        list.append(item);
      }
      if (!list.children.length) list.append(empty("No Applications yet."));
      body.append(form, error, list);
    };
    trackSubscription(ctx, customer, render);
    return () => element.remove();
  },
};
