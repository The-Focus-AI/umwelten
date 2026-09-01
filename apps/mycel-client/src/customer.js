const section = document.querySelector("#customer-account");
const accountLinks = [...document.querySelectorAll("[data-account-link]")];
const loading = document.querySelector("#customer-loading");
const errorBox = document.querySelector("#customer-error");
const onboarding = document.querySelector("#customer-onboarding");
const onboardingForm = document.querySelector("#onboarding-form");
const dashboardView = document.querySelector("#customer-dashboard");
const dashboardName = document.querySelector("#dashboard-name");
const clientBalance = document.querySelector("#client-balance");
const creditLimit = document.querySelector("#credit-limit");
const applicationList = document.querySelector("#application-list");
const requestList = document.querySelector("#request-list");
const applicationForm = document.querySelector("#application-form");
const credentialDialog = document.querySelector("#credential-dialog");
const credentialValue = document.querySelector("#credential-value");
const copyCredential = document.querySelector("#copy-credential");
const closeCredential = document.querySelector("#close-credential");

let activeClerk = null;
let activeUserId = null;
let dashboard = null;

function money(microDollars = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(microDollars / 1_000_000);
}

function setBusy(isBusy) {
  loading.hidden = !isBusy;
  onboardingForm?.querySelector("button")?.toggleAttribute("disabled", isBusy);
  applicationForm?.querySelector("button")?.toggleAttribute("disabled", isBusy);
}

function showError(message = "") {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

async function customerRequest(path = "", options = {}) {
  const token = await activeClerk?.session?.getToken();
  if (!token)
    throw new Error("Your session has expired. Sign in again to continue.");
  const response = await fetch(`/api/customer${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload.error === "customer_auth_not_configured"
        ? "Customer accounts are not configured on this Exchange yet."
        : payload.error?.replaceAll("_", " ") ||
            `Request failed (${response.status}).`,
    );
  }
  return payload;
}

function showCredential(value) {
  credentialValue.textContent = value;
  credentialDialog.showModal();
}

function emptyState(text) {
  const item = document.createElement("li");
  item.className = "empty-row";
  item.textContent = text;
  return item;
}

function renderApplications(applications) {
  applicationList.replaceChildren();
  if (!applications.length) {
    applicationList.append(emptyState("No Applications yet."));
    return;
  }
  for (const application of applications) {
    const item = document.createElement("li");
    item.className = "application-row";
    const details = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = application.id;
    const metadata = document.createElement("small");
    metadata.textContent = `${application.enabled ? "Active" : "Disabled"} · ${money(application.balance?.microDollars)}`;
    details.append(name, metadata);
    const rotate = document.createElement("button");
    rotate.className = "small-button";
    rotate.type = "button";
    rotate.textContent = "Rotate key";
    rotate.addEventListener("click", async () => {
      if (
        !window.confirm(
          `Rotate the key for ${application.id}? The current key will stop working immediately.`,
        )
      )
        return;
      try {
        rotate.disabled = true;
        showError();
        const result = await customerRequest(
          `/applications/${encodeURIComponent(application.id)}/rotate`,
          { method: "POST" },
        );
        showCredential(result.credential);
      } catch (error) {
        showError(error.message);
      } finally {
        rotate.disabled = false;
      }
    });
    item.append(details, rotate);
    applicationList.append(item);
  }
}

function renderRequests(requests) {
  requestList.replaceChildren();
  if (!requests.length) {
    requestList.append(
      emptyState("Requests will appear here after your first completion."),
    );
    return;
  }
  for (const request of requests) {
    const item = document.createElement("li");
    item.className = "request-row";
    const model = document.createElement("strong");
    model.textContent = request.model;
    const app = document.createElement("span");
    app.textContent = request.applicationId;
    const tokens = document.createElement("span");
    tokens.textContent = `${request.promptTokens + request.completionTokens} tokens`;
    const charge = document.createElement("span");
    charge.textContent = money(request.charge);
    const outcome = document.createElement("span");
    outcome.className = `request-outcome ${request.outcome}`;
    outcome.textContent = request.outcome;
    item.append(model, app, tokens, charge, outcome);
    requestList.append(item);
  }
}

function render(data) {
  dashboard = data;
  setBusy(false);
  onboarding.hidden = data.onboarded;
  dashboardView.hidden = !data.onboarded;
  if (!data.onboarded) return;
  dashboardName.textContent = data.client.name;
  clientBalance.textContent = money(data.balance.microDollars);
  creditLimit.textContent = money(data.client.creditLimitMicroDollars);
  renderApplications(data.applications);
  renderRequests(data.requests);
}

async function refresh() {
  showError();
  setBusy(true);
  try {
    render(await customerRequest());
  } catch (error) {
    setBusy(false);
    showError(error.message);
  }
}

onboardingForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(onboardingForm);
  setBusy(true);
  showError();
  try {
    const result = await customerRequest("/onboard", {
      method: "POST",
      body: JSON.stringify({
        clientName: values.get("clientName"),
        applicationName: values.get("applicationName"),
      }),
    });
    render(result.dashboard);
    onboardingForm.reset();
    showCredential(result.credential);
  } catch (error) {
    setBusy(false);
    showError(error.message);
  }
});

applicationForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = applicationForm.elements.applicationName;
  setBusy(true);
  showError();
  try {
    const result = await customerRequest("/applications", {
      method: "POST",
      body: JSON.stringify({ applicationName: input.value }),
    });
    input.value = "";
    showCredential(result.credential);
    await refresh();
  } catch (error) {
    setBusy(false);
    showError(error.message);
  }
});

copyCredential?.addEventListener("click", async () => {
  await navigator.clipboard.writeText(credentialValue.textContent);
  copyCredential.textContent = "Copied";
  window.setTimeout(() => (copyCredential.textContent = "Copy key"), 1600);
});
closeCredential?.addEventListener("click", () => credentialDialog.close());

export function updateCustomerSession({ clerk, signedIn }) {
  const userId = signedIn ? clerk?.user?.id : null;
  activeClerk = clerk;
  section.hidden = !signedIn;
  for (const link of accountLinks) link.hidden = !signedIn;
  if (!signedIn) {
    activeUserId = null;
    dashboard = null;
    onboarding.hidden = true;
    dashboardView.hidden = true;
    return;
  }
  if (userId && userId !== activeUserId) {
    activeUserId = userId;
    void refresh();
  } else if (dashboard) {
    render(dashboard);
  }
}
