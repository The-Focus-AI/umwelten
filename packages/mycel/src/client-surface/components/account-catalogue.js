import { customerKey, regionKey } from "./account-services.js";
import {
  button,
  card,
  empty,
  errorLine,
  showError,
  trackSubscription,
} from "./account-ui.js";

const labels = {
  chat: "Chat",
  embeddings: "Embeddings",
  transcription: "Speech to text (STT)",
  "image-generation": "Image generation",
  "video-generation": "Video generation",
};
const rates = [
  "Wholesale input",
  "Wholesale output",
  "Retail input",
  "Retail output",
];
const chatKeys = [
  "wholesalePromptPerMillion",
  "wholesaleCompletionPerMillion",
  "retailPromptPerMillion",
  "retailCompletionPerMillion",
];
const opKeys = [
  "wholesaleInputPerMillion",
  "wholesaleOutputPerMillion",
  "retailInputPerMillion",
  "retailOutputPerMillion",
];

export default {
  name: "account-catalogue",
  inject: [regionKey, customerKey],
  apply(ctx, view) {
    const customer = view.get(customerKey);
    const element = card("account-catalogue", "Admin", "Supplier catalogue");
    element.hidden = true;
    const body = element.querySelector(".account-card-body");
    const note = empty(
      "Manage durable vendor offers. Eligibility is configuration, not a live uptime guarantee. Verification sends billable test requests; failed checks leave the existing offer unchanged.",
    );
    const error = errorLine();
    error.setAttribute("role", "alert");
    const status = document.createElement("p");
    status.className = "account-note";
    status.setAttribute("role", "status");
    const controls = document.createElement("div");
    controls.className = "account-form catalogue-controls";
    controls.innerHTML =
      '<label>Supplier<select name="supplier" aria-label="Supplier"></select></label>';
    const select = controls.querySelector("select");
    const refresh = button("Refresh availability");
    const supplierToggle = button("Disable supplier");
    const add = button("Add model", "primary");
    controls.append(refresh, supplierToggle, add);
    const connect = document.createElement("details");
    connect.className = "catalogue-connect";
    connect.innerHTML =
      '<summary>Connect a vendor</summary><p class="account-note">Keys are installed by the server operator, never entered in this browser. Other endpoints and dial-in agents must first be registered through the operator CLI.</p><div class="account-form"><label>Vendor preset<select aria-label="Vendor preset"></select></label></div>';
    const presets = connect.querySelector("select");
    const connectButton = button("Connect selected vendor");
    connect.querySelector(".account-form").append(connectButton);
    const list = document.createElement("ul");
    list.className = "account-list catalogue-offers";
    const editor = document.createElement("form");
    editor.className = "account-form catalogue-editor";
    editor.hidden = true;
    body.append(note, controls, connect, error, status, list, editor);
    view.get(regionKey).append(element);
    let data = null;
    let active = false;
    let generation = 0;
    let busy = false;
    const supplier = () => data?.suppliers.find((s) => s.id === select.value);

    function render() {
      const previous = select.value;
      select.replaceChildren(
        ...data.suppliers.map(
          (s) =>
            new Option(
              `${s.displayName} · ${s.kind}${!s.enabled ? " · disabled" : ""}`,
              s.id,
            ),
        ),
      );
      if (data.suppliers.some((s) => s.id === previous))
        select.value = previous;
      presets.replaceChildren(
        ...data.presets.map(
          (p) =>
            new Option(
              `${p.displayName} — ${p.credentialConfigured ? "key configured" : `needs ${p.credentialEnv}`}`,
              p.id,
            ),
        ),
      );
      renderSupplier();
    }
    function renderSupplier() {
      editor.hidden = true;
      list.replaceChildren();
      const s = supplier();
      supplierToggle.disabled = !s;
      add.disabled = !s || s.kind !== "vendor" || !s.credentialConfigured;
      supplierToggle.textContent = s?.enabled
        ? "Disable supplier"
        : "Enable supplier";
      if (!s) {
        list.append(
          empty("No suppliers yet. Connect a configured vendor above."),
        );
        return;
      }
      if (s.kind === "agent")
        list.append(
          empty(
            `${s.connected ? "Connected" : "Disconnected"} agent. Capabilities are verified and published by its agent; use the operator CLI for its offer controls.`,
          ),
        );
      if (!s.credentialConfigured)
        list.append(
          empty(
            "Upstream credential missing. Ask the server operator to configure this supplier’s key.",
          ),
        );
      if (!s.offers.length)
        list.append(
          empty(
            s.kind === "agent"
              ? "No offers published by this agent."
              : "No offers. Add a model and verify its operations to publish it.",
          ),
        );
      for (const offer of s.offers) {
        const row = document.createElement("li");
        const info = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = offer.model;
        const availability = document.createElement("small");
        availability.textContent = offer.availability || "No operations";
        const verified = document.createElement("small");
        verified.textContent = offer.adminManaged
          ? `Admin managed · verified ${new Date(offer.verifiedAt).toLocaleString()}`
          : "Supplier / CLI published · heartbeat required for vendors";
        info.append(title, availability, verified);
        const actions = document.createElement("div");
        actions.className = "account-row-actions";
        if (s.kind === "vendor") {
          const edit = button("Edit / verify");
          edit.onclick = () => editOffer(offer);
          actions.append(edit);
        }
        if (offer.adminManaged) {
          const toggle = button(
            offer.enabled ? "Disable offer" : "Enable offer",
          );
          toggle.onclick = () =>
            run("Updating offer…", "enabled", {
              supplierId: s.id,
              model: offer.model,
              enabled: !offer.enabled,
            });
          actions.append(toggle);
        }
        row.append(info, actions);
        list.append(row);
      }
    }
    async function run(message, action, payload) {
      if (busy) return;
      busy = true;
      error.hidden = true;
      status.textContent = message;
      const current = generation;
      element.setAttribute("aria-busy", "true");
      const buttons = [...element.querySelectorAll("button")];
      const disabled = buttons.map((b) => b.disabled);
      buttons.forEach((b) => {
        b.disabled = true;
      });
      try {
        const result = await customer.request(
          `/admin/catalogue${action ? `/${action}` : ""}`,
          action ? { method: "POST", body: JSON.stringify(payload) } : {},
        );
        if (active && current === generation) {
          data = result;
          render();
          status.textContent =
            action === "save"
              ? "Verified and saved. Other models are unchanged."
              : "Catalogue refreshed.";
        }
      } catch (cause) {
        if (active && current === generation) {
          showError(error, cause);
          status.textContent = "No changes saved.";
        }
      } finally {
        busy = false;
        element.removeAttribute("aria-busy");
        buttons.forEach((b, i) => {
          if (b.isConnected) b.disabled = disabled[i];
        });
        supplierToggle.disabled = !supplier();
        add.disabled =
          !supplier() ||
          supplier().kind !== "vendor" ||
          !supplier().credentialConfigured;
        if (active && current !== generation) void run("Loading catalogue…");
      }
    }
    function editOffer(offer) {
      editor.replaceChildren();
      editor.hidden = false;
      const heading = document.createElement("h3");
      heading.textContent = offer ? `Edit ${offer.model}` : "Add a model";
      editor.append(heading);
      const modelLabel = document.createElement("label");
      modelLabel.textContent = "Exact upstream model ID";
      const model = document.createElement("input");
      model.name = "model";
      model.required = true;
      model.maxLength = 200;
      model.value = offer?.model ?? "";
      model.readOnly = Boolean(offer);
      modelLabel.append(model);
      editor.append(modelLabel);
      const groups = [];
      for (const operation of data.operations) {
        const group = document.createElement("fieldset");
        const legend = document.createElement("legend");
        const label = document.createElement("label");
        label.className = "catalogue-check";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = offer
          ? offer.capabilities.includes(operation)
          : operation === "chat";
        label.append(check, document.createTextNode(labels[operation]));
        legend.append(label);
        group.append(legend);
        const inputs = document.createElement("div");
        inputs.className = "catalogue-rates";
        const units =
          operation === "chat"
            ? { input: "token", output: "token" }
            : data.units[operation];
        const keys = operation === "chat" ? chatKeys : opKeys;
        const price =
          operation === "chat" ? offer : offer?.operationPricing?.[operation];
        keys.forEach((key, i) => {
          const field = document.createElement("label");
          field.textContent = `${rates[i]} · USD / million ${i % 2 ? units.output : units.input}s`;
          const input = document.createElement("input");
          input.type = "number";
          input.min = "0";
          input.max = "9007199254";
          input.step = "0.000001";
          input.required = true;
          input.dataset.key = key;
          input.value = String(
            (price?.[key] ?? (i < 2 ? 0 : i === 2 ? 100000 : 400000)) / 1e6,
          );
          field.append(input);
          inputs.append(field);
        });
        const update = () => {
          inputs.hidden = !check.checked;
          inputs.querySelectorAll("input").forEach((input) => {
            input.disabled = !check.checked;
          });
        };
        check.onchange = update;
        update();
        group.append(inputs);
        editor.append(group);
        groups.push({ operation, check, inputs, units });
      }
      const enabledLabel = document.createElement("label");
      enabledLabel.className = "catalogue-check";
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = offer?.enabled ?? true;
      enabledLabel.append(
        enabled,
        document.createTextNode(
          "Enable this offer after successful verification",
        ),
      );
      const confirmLabel = document.createElement("label");
      confirmLabel.className = "catalogue-check";
      const confirm = document.createElement("input");
      confirm.type = "checkbox";
      confirm.required = true;
      confirmLabel.append(
        confirm,
        document.createTextNode(
          "I authorize billable test requests for the selected operations (up to 30 seconds each).",
        ),
      );
      const help = empty(
        "STT input is measured seconds, output is tokens. $100 per million seconds = $0.0001/second. Verification checks endpoint contracts, not model quality. Saving takes admin ownership; CLI sync cannot replace this model.",
      );
      const submit = button("Verify & save offer", "primary");
      submit.type = "submit";
      const cancel = button("Cancel");
      cancel.onclick = () => {
        editor.hidden = true;
      };
      const actions = document.createElement("div");
      actions.className = "account-actions";
      actions.append(submit, cancel);
      editor.append(enabledLabel, confirmLabel, help, actions);
      editor.onsubmit = (event) => {
        event.preventDefault();
        const pricing = Object.fromEntries(chatKeys.map((key) => [key, 0]));
        pricing.operationPricing = {};
        const operations = [];
        for (const group of groups) {
          if (!group.check.checked) continue;
          operations.push(group.operation);
          const values = Object.fromEntries(
            [...group.inputs.querySelectorAll("input")].map((input) => [
              input.dataset.key,
              Math.round(Number(input.value) * 1e6),
            ]),
          );
          if (group.operation === "chat") Object.assign(pricing, values);
          else
            pricing.operationPricing[group.operation] = {
              ...values,
              inputUnit: group.units.input,
              outputUnit: group.units.output,
            };
        }
        if (!operations.length) {
          showError(error, new Error("Select at least one operation."));
          return;
        }
        void run("Verifying selected endpoints…", "save", {
          supplierId: supplier().id,
          model: model.value,
          operations,
          pricing,
          enabled: enabled.checked,
          confirmPaidProbe: confirm.checked,
        });
      };
      model.focus();
    }
    refresh.onclick = () => run("Refreshing…");
    add.onclick = () => editOffer(null);
    select.onchange = renderSupplier;
    supplierToggle.onclick = () =>
      run("Updating supplier…", "enabled", {
        supplierId: supplier().id,
        enabled: !supplier().enabled,
      });
    connectButton.onclick = () =>
      run("Connecting vendor…", "connect", { preset: presets.value });
    trackSubscription(ctx, customer, (state) => {
      const allowed = state.phase === "ready" && state.dashboard?.canAdminGrant;
      element.hidden = !allowed;
      if (!allowed) {
        active = false;
        generation++;
        data = null;
        list.replaceChildren();
        editor.replaceChildren();
      } else if (!active) {
        active = true;
        void run("Loading catalogue…");
      }
    });
    return () => {
      active = false;
      generation++;
      element.remove();
    };
  },
};
