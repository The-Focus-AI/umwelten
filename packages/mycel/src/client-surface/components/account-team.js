import { customerKey, regionKey } from "./account-services.js";
import {
  button,
  card,
  empty,
  errorLine,
  showError,
  trackSubscription,
} from "./account-ui.js";

function invitationToken() {
  return new URLSearchParams(location.hash.slice(1)).get("invite");
}

export default {
  name: "account-team",
  inject: [regionKey, customerKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const customer = view.get(customerKey);
    const element = card("account-team", "06", "Team");
    const body = element.querySelector(".account-card-body");
    region.append(element);
    const render = (state) => {
      const dashboard = state.dashboard;
      const inviteToken = invitationToken();
      element.hidden =
        state.phase !== "ready" || (!dashboard?.onboarded && !inviteToken);
      if (element.hidden) return;
      body.replaceChildren();
      const error = errorLine();

      if (!dashboard?.onboarded && inviteToken) {
        const prompt = document.createElement("div");
        prompt.className = "account-invite";
        prompt.textContent =
          "This invitation will add your signed-in account to an existing Mycel Client.";
        const accept = button("Accept invitation", "primary");
        accept.addEventListener("click", async () => {
          accept.disabled = true;
          try {
            await customer.request("/invitations/accept", {
              method: "POST",
              body: JSON.stringify({ token: inviteToken }),
            });
            history.replaceState({}, "", "/account/");
            await customer.refresh();
          } catch (cause) {
            showError(error, cause);
            accept.disabled = false;
          }
        });
        body.append(prompt, accept, error);
        return;
      }

      const isOwner = dashboard.operator?.role === "owner";
      if (isOwner) {
        const create = button("Create 7-day invite", "primary");
        const invitation = document.createElement("div");
        invitation.className = "account-invite";
        invitation.hidden = true;
        create.addEventListener("click", async () => {
          create.disabled = true;
          error.hidden = true;
          try {
            const result = await customer.request("/invitations", {
              method: "POST",
            });
            const value = `${location.origin}/account/#invite=${encodeURIComponent(result.invitation.token)}`;
            const label = document.createElement("span");
            label.textContent = "Copy this one-time invitation now:";
            const code = document.createElement("code");
            code.textContent = value;
            const copy = button("Copy invite");
            copy.addEventListener("click", async () => {
              await navigator.clipboard.writeText(value);
              copy.textContent = "Copied";
            });
            invitation.replaceChildren(label, code, copy);
            invitation.hidden = false;
          } catch (cause) {
            showError(error, cause);
          } finally {
            create.disabled = false;
          }
        });
        body.append(create, invitation);
      }
      const list = document.createElement("ul");
      list.className = "account-list";
      for (const operator of dashboard.operators ?? []) {
        const item = document.createElement("li");
        const details = document.createElement("div");
        const subject = document.createElement("strong");
        subject.textContent = operator.subject;
        const role = document.createElement("small");
        role.textContent = operator.role;
        details.append(subject, role);
        item.append(details);
        if (isOwner && operator.role !== "owner") {
          const remove = button("Remove", "danger");
          remove.addEventListener("click", async () => {
            if (!confirm(`Remove ${operator.subject} from this team?`)) return;
            remove.disabled = true;
            try {
              await customer.request(
                `/operators/${encodeURIComponent(operator.subject)}`,
                { method: "DELETE" },
              );
              await customer.refresh();
            } catch (cause) {
              showError(error, cause);
              remove.disabled = false;
            }
          });
          item.append(remove);
        }
        list.append(item);
      }
      if (!list.children.length) list.append(empty("No team members."));
      body.append(error, list);
    };
    trackSubscription(ctx, customer, render);
    return () => element.remove();
  },
};
