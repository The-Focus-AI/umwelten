import { customerKey, regionKey } from "./account-services.js";
import {
  button,
  card,
  empty,
  errorLine,
  showError,
  trackSubscription,
} from "./account-ui.js";

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
      "Manage durable vendor offers. Eligibility is configuration, not a live uptime guarantee. Checking sends billable test requests for every operation. A rejected credential or a missing result leaves the stored offer unchanged.",
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
    const showDisabled = button("Show disabled suppliers");
    showDisabled.setAttribute("aria-pressed", "false");
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
    body.append(note, controls, showDisabled, connect, error, status, list, editor);
    view.get(regionKey).append(element);
    let data = null;
    let active = false;
    let generation = 0;
    let editorToken = 0;
    let busy = false;
    const supplier = () => data?.suppliers.find((s) => s.id === select.value);

    function render() {
      const previous = select.value;
      const visibleSuppliers = data.suppliers.filter(
        (s) => s.enabled || showDisabled.getAttribute("aria-pressed") === "true",
      );
      select.replaceChildren(
        ...visibleSuppliers.map(
          (s) =>
            new Option(
              `${s.displayName} · ${s.kind}${!s.enabled ? " · disabled" : ""}`,
              s.id,
            ),
        ),
      );
      if (visibleSuppliers.some((s) => s.id === previous))
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
    function closeEditor() {
      editorToken += 1;
      editor.hidden = true;
    }
    function renderSupplier() {
      closeEditor();
      paintOffers();
    }
    function paintOffers() {
      list.replaceChildren();
      const s = supplier();
      supplierToggle.disabled = !s;
      add.disabled = !s || s.kind !== "vendor" || !s.credentialConfigured;
      supplierToggle.textContent = s?.enabled
        ? "Disable supplier"
        : "Enable supplier";
      if (!s) {
        list.append(
          empty(
            data.suppliers.length
              ? "No active suppliers. Show disabled suppliers to inspect or re-enable one."
              : "No suppliers yet. Connect a configured vendor above.",
          ),
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
              : "No offers. Add a model and check what it can do.",
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
          ? offer.verifiedAt
            ? `Admin managed · verified ${new Date(offer.verifiedAt).toLocaleString()}`
            : "Admin managed · existing capabilities retained; verification not recorded"
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
    function releaseControls(buttons, disabled) {
      busy = false;
      element.removeAttribute("aria-busy");
      buttons.forEach((control, index) => {
        if (control.isConnected) control.disabled = disabled[index];
      });
      supplierToggle.disabled = !supplier();
      add.disabled =
        !supplier() ||
        supplier().kind !== "vendor" ||
        !supplier().credentialConfigured;
    }
    async function run(message, action, payload) {
      if (busy) return;
      busy = true;
      error.hidden = true;
      status.textContent = message;
      const current = generation;
      element.setAttribute("aria-busy", "true");
      const buttons = [...element.querySelectorAll("button")];
      const disabled = buttons.map((control) => control.disabled);
      buttons.forEach((control) => {
        control.disabled = true;
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
              ? "Saved. Other models are unchanged."
              : "Catalogue refreshed.";
        }
      } catch (cause) {
        if (active && current === generation) {
          showError(error, cause);
          status.textContent = "No changes saved.";
        }
      } finally {
        releaseControls(buttons, disabled);
        if (active && current !== generation) void run("Loading catalogue…");
      }
    }
    function labelFor(operation) {
      const label = data?.labels?.[operation];
      return typeof label === "string" ? label : "";
    }
    function unitsFor(operation) {
      if (operation === "chat") return { input: "token", output: "token" };
      return data?.units?.[operation];
    }
    function ratesFor(offer, operation) {
      if (!offer) return undefined;
      return operation === "chat" ? offer : offer.operationPricing?.[operation];
    }
    function checkStatus(findings) {
      const names = findings
        .filter((finding) => finding.judgment === "pass")
        .map((finding) => finding.label)
        .filter((label) => typeof label === "string" && label.length > 0);
      if (names.length === 0) return "Checked. No operation passed.";
      if (names.length === 1) return `Checked. ${names[0]} passed.`;
      if (names.length === 2)
        return `Checked. ${names[0]} and ${names[1]} passed.`;
      return `Checked. ${names.slice(0, -1).join(", ")}, and ${names.at(-1)} passed.`;
    }
    function priceFields(operation, units, stored) {
      const inputs = document.createElement("div");
      inputs.className = "catalogue-rates";
      const keys = operation === "chat" ? chatKeys : opKeys;
      keys.forEach((key, index) => {
        const field = document.createElement("label");
        const unit = index % 2 ? units?.output : units?.input;
        field.textContent = unit
          ? `${rates[index]} · USD / million ${unit}s`
          : rates[index];
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.max = "9007199254";
        input.step = "0.000001";
        input.required = true;
        input.dataset.key = key;
        const micro = stored?.[key];
        input.value = String(
          (typeof micro === "number"
            ? micro
            : index < 2
              ? 0
              : index === 2
                ? 100000
                : 400000) / 1e6,
        );
        field.append(input);
        inputs.append(field);
      });
      return inputs;
    }
    function operationRow({ operation, label, summary, priced, stored, units }) {
      const group = document.createElement("fieldset");
      group.dataset.operation = operation;
      if (priced) group.dataset.priced = "true";
      const legend = document.createElement("legend");
      legend.textContent = typeof label === "string" ? label : "";
      group.append(legend);
      if (typeof summary === "string" && summary) {
        const line = document.createElement("p");
        line.className = "account-note";
        line.textContent = summary;
        group.append(line);
      }
      if (priced) {
        group.append(priceFields(operation, units, stored));
        const leave = button("Leave out");
        leave.onclick = () => group.remove();
        group.append(leave);
      }
      return group;
    }
    function editOffer(offer) {
      const session = generation;
      const token = ++editorToken;
      editor.hidden = false;
      editor.replaceChildren();
      let suggestions = null;
      let confirm = null;
      let enabledInput = null;
      let modelLocked = Boolean(offer);
      const current = () =>
        active &&
        session === generation &&
        token === editorToken &&
        !editor.hidden;
      const heading = document.createElement("h3");
      heading.textContent = offer ? `Edit ${offer.model}` : "Add a model";
      const modelLabel = document.createElement("label");
      modelLabel.textContent = "Upstream model";
      const model = document.createElement("input");
      model.name = "model";
      model.required = true;
      model.maxLength = 200;
      model.value = offer?.model ?? "";
      model.readOnly = Boolean(offer);
      modelLabel.append(model);
      const rows = document.createElement("div");
      const footer = document.createElement("div");
      const actions = document.createElement("div");
      actions.className = "account-actions";
      editor.append(heading, modelLabel, rows, footer, actions);
      function cancelButton() {
        const cancel = button("Cancel");
        cancel.onclick = () => closeEditor();
        return cancel;
      }
      function checkAgainButton() {
        const again = button("Check again");
        again.onclick = () => showCheckChrome();
        return again;
      }
      function saveButton() {
        const submit = button("Save offer", "primary");
        submit.type = "submit";
        return submit;
      }
      function enableBox(checked) {
        const label = document.createElement("label");
        label.className = "catalogue-check";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = checked;
        enabledInput = input;
        label.append(input, document.createTextNode("Enable this offer"));
        return label;
      }
      function helpNote() {
        return empty(
          "STT input is measured seconds, output is tokens. $100 per million seconds = $0.0001/second. Prices are USD per million units. Saving does not send a test request. Check again runs billable test requests for every operation, up to 30 seconds each.",
        );
      }
      function showCheckChrome() {
        editor.dataset.mode = "check";
        rows.replaceChildren();
        const confirmLabel = document.createElement("label");
        confirmLabel.className = "catalogue-check";
        confirm = document.createElement("input");
        confirm.type = "checkbox";
        confirmLabel.append(
          confirm,
          document.createTextNode(
            "I authorize billable test requests for every operation, up to 30 seconds each.",
          ),
        );
        footer.replaceChildren(confirmLabel);
        const check = button("Check what this model can do", "primary");
        check.type = "submit";
        actions.replaceChildren(check, cancelButton());
      }
      function showFindings(findings) {
        rows.replaceChildren(
          ...findings.map((finding) =>
            operationRow({
              operation: finding.operation,
              label: finding.label,
              summary: finding.summary,
              priced: false,
            }),
          ),
        );
        if (editor.dataset.mode === "price") {
          editor.dataset.mode = "findings";
          footer.replaceChildren();
          actions.replaceChildren(checkAgainButton(), cancelButton());
        }
      }
      function showPriceEditor(findings, stored) {
        rows.replaceChildren(
          ...findings.map((finding) =>
            operationRow({
              operation: finding.operation,
              label: finding.label,
              summary: finding.summary,
              priced: finding.judgment === "pass",
              stored: ratesFor(stored, finding.operation),
              units: unitsFor(finding.operation),
            }),
          ),
        );
        const passed = findings.some((finding) => finding.judgment === "pass");
        if (!passed) {
          editor.dataset.mode = "findings";
          footer.replaceChildren(helpNote());
          actions.replaceChildren(checkAgainButton(), cancelButton());
          return;
        }
        editor.dataset.mode = "price";
        footer.replaceChildren(enableBox(Boolean(stored?.enabled)), helpNote());
        actions.replaceChildren(saveButton(), checkAgainButton(), cancelButton());
      }
      function showStoredEditor(stored) {
        const billable = (data.operations ?? []).filter((operation) =>
          stored.capabilities.includes(operation),
        );
        rows.replaceChildren(
          ...billable.map((operation) =>
            operationRow({
              operation,
              label: labelFor(operation),
              priced: true,
              stored: ratesFor(stored, operation),
              units: unitsFor(operation),
            }),
          ),
        );
        editor.dataset.mode = "price";
        if (!billable.length) {
          rows.append(
            empty("No checked operations yet. Check again to probe this model."),
          );
          footer.replaceChildren();
          actions.replaceChildren(checkAgainButton(), cancelButton());
          return;
        }
        footer.replaceChildren(enableBox(Boolean(stored.enabled)), helpNote());
        actions.replaceChildren(saveButton(), checkAgainButton(), cancelButton());
      }
      function offerFor(catalogue, modelValue) {
        const source = catalogue?.suppliers ? catalogue : data;
        return source?.suppliers
          ?.find((item) => item.id === select.value)
          ?.offers?.find((item) => item.model === modelValue);
      }
      async function runCheck(requireConsent) {
        if (busy || !current() || !supplier()) return;
        const modelValue = model.value.trim();
        if (!modelValue) {
          showError(error, new Error("Enter an upstream model."));
          return;
        }
        if (requireConsent && !confirm?.checked) {
          showError(
            error,
            new Error("Authorize billable test requests before checking."),
          );
          return;
        }
        busy = true;
        error.hidden = true;
        status.textContent = "Checking every operation…";
        const currentGeneration = generation;
        element.setAttribute("aria-busy", "true");
        const buttons = [...element.querySelectorAll("button")];
        const disabled = buttons.map((control) => control.disabled);
        buttons.forEach((control) => {
          control.disabled = true;
        });
        const suggestionsWereDisabled = suggestions?.disabled ?? true;
        if (suggestions) suggestions.disabled = true;
        model.readOnly = true;
        let accepted = false;
        try {
          const result = await customer.request("/admin/catalogue/check", {
            method: "POST",
            body: JSON.stringify({
              supplierId: supplier().id,
              model: modelValue,
              confirmPaidProbe: true,
            }),
          });
          if (!current() || model.value.trim() !== modelValue) return;
          accepted = true;
          modelLocked = true;
          data = result;
          paintOffers();
          status.textContent = checkStatus(result.findings ?? []);
          showPriceEditor(result.findings ?? [], offerFor(result, modelValue));
        } catch (cause) {
          if (!current()) return;
          showError(error, cause);
          status.textContent = "The offer was not changed.";
          if (Array.isArray(cause.findings)) showFindings(cause.findings);
        } finally {
          releaseControls(buttons, disabled);
          if (accepted) {
            model.readOnly = true;
            if (suggestions) suggestions.disabled = true;
          } else {
            model.readOnly = modelLocked;
            if (suggestions) suggestions.disabled = suggestionsWereDisabled;
          }
          if (active && currentGeneration !== generation)
            void run("Loading catalogue…");
        }
      }
      function saveOffer() {
        const groups = [...rows.querySelectorAll("fieldset")].filter(
          (group) => group.dataset.priced === "true",
        );
        if (!groups.length) {
          showError(error, new Error("Keep at least one passed operation."));
          return;
        }
        const pricing = Object.fromEntries(chatKeys.map((key) => [key, 0]));
        pricing.operationPricing = {};
        const selected = groups.map((group) => group.dataset.operation);
        const operations = (data.operations ?? []).filter((operation) =>
          selected.includes(operation),
        );
        for (const group of groups) {
          const operation = group.dataset.operation;
          const values = Object.fromEntries(
            [...group.querySelectorAll(".catalogue-rates input")].map((input) => [
              input.dataset.key,
              Math.round(Number(input.value) * 1e6),
            ]),
          );
          if (operation === "chat") Object.assign(pricing, values);
          else {
            const units = unitsFor(operation);
            pricing.operationPricing[operation] = {
              ...values,
              inputUnit: units.input,
              outputUnit: units.output,
            };
          }
        }
        void run("Saving offer…", "save", {
          supplierId: supplier().id,
          model: model.value.trim(),
          operations,
          pricing,
          enabled: Boolean(enabledInput?.checked),
        });
      }
      if (!offer) {
        model.placeholder = "Search upstream models or enter an exact model ID";
        model.autocomplete = "off";
        suggestions = document.createElement("select");
        suggestions.setAttribute("aria-label", "Matching upstream models");
        suggestions.disabled = true;
        suggestions.append(new Option("Loading upstream models…", ""));
        const discovery = empty("Loading models from the supplier…");
        discovery.id = "catalogue-model-discovery";
        discovery.setAttribute("role", "status");
        model.setAttribute("aria-describedby", discovery.id);
        editor.insertBefore(discovery, rows);
        editor.insertBefore(suggestions, discovery);
        void customer
          .request(
            `/admin/catalogue/models?supplierId=${encodeURIComponent(supplier().id)}`,
          )
          .then(({ models }) => {
            if (!current() || !model.isConnected) return;
            const filter = () => {
              // A completed check fixes the probed id. A late model list must not unlock it.
              if (model.readOnly) {
                suggestions.disabled = true;
                return;
              }
              const query = model.value.toLowerCase();
              const matches = models.filter((item) =>
                `${item.id} ${item.name}`.toLowerCase().includes(query),
              );
              suggestions.replaceChildren(
                new Option(
                  matches.length
                    ? "Choose an upstream model…"
                    : "No matching models — enter an ID above",
                  "",
                ),
                ...matches.map(
                  (item) => new Option(`${item.name} — ${item.id}`, item.id),
                ),
              );
              suggestions.disabled = !matches.length;
            };
            model.oninput = filter;
            suggestions.onchange = () => {
              if (!model.readOnly && suggestions.value) model.value = suggestions.value;
            };
            filter();
            discovery.textContent = models.length
              ? `${models.length} upstream models loaded. Start typing to select one, or enter an ID manually. Listing does not verify capabilities or set prices.`
              : "The supplier returned no models. You can still enter an exact model ID manually.";
          })
          .catch(() => {
            if (current() && model.isConnected) {
              suggestions.replaceChildren(new Option("Upstream list unavailable", ""));
              discovery.textContent =
                "Could not load upstream models. You can still enter an exact model ID manually.";
            }
          });
      }
      if (offer?.adminManaged) showStoredEditor(offer);
      else showCheckChrome();
      editor.onsubmit = (event) => {
        event.preventDefault();
        if (editor.dataset.mode === "price") saveOffer();
        else if (editor.dataset.mode === "check") void runCheck(true);
      };
      model.focus();
    }
    showDisabled.onclick = () => {
      if (!data || busy) return;
      const show = showDisabled.getAttribute("aria-pressed") !== "true";
      showDisabled.setAttribute("aria-pressed", String(show));
      showDisabled.textContent = show
        ? "Hide disabled suppliers"
        : "Show disabled suppliers";
      render();
    };
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
