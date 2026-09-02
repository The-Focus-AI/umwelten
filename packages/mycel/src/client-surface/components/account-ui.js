export function money(microDollars = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(microDollars / 1_000_000);
}

export function card(id, number, title) {
  const element = document.createElement("section");
  element.className = "account-card";
  element.dataset.component = id;
  element.innerHTML = `<header><span>${number}</span><h2>${title}</h2></header><div class="account-card-body"></div>`;
  return element;
}

export function empty(text) {
  const element = document.createElement("p");
  element.className = "account-empty";
  element.textContent = text;
  return element;
}

export function errorLine() {
  const element = document.createElement("p");
  element.className = "account-error";
  element.hidden = true;
  return element;
}

export function showError(element, error) {
  element.textContent = error instanceof Error ? error.message : String(error);
  element.hidden = false;
}

export function button(text, className = "") {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `account-button ${className}`.trim();
  element.textContent = text;
  return element;
}

export function showCredential(value) {
  const dialog = document.createElement("dialog");
  dialog.className = "account-dialog";
  const heading = document.createElement("h2");
  heading.textContent = "Save this key now.";
  const copy = button("Copy key", "primary");
  const close = button("I saved it");
  const code = document.createElement("code");
  code.textContent = value;
  const note = document.createElement("p");
  note.textContent =
    "Mycel stores only its SHA-256 hash. This value will not be shown again.";
  const actions = document.createElement("div");
  actions.className = "account-actions";
  actions.append(copy, close);
  dialog.append(heading, note, code, actions);
  document.body.append(dialog);
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(value);
    copy.textContent = "Copied";
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

export function trackSubscription(ctx, service, render) {
  const unsubscribe = service.subscribe(render);
  ctx.effect(() => unsubscribe);
}
