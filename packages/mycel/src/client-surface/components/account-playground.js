import { renderConversation } from "../substrate/conversation-view.js";
import { customerKey, regionKey } from "./account-services.js";
import {
  button,
  card,
  errorLine,
  showError,
  trackSubscription,
} from "./account-ui.js";

function optionLabel(model) {
  const prompt = model.pricing?.prompt;
  const completion = model.pricing?.completion;
  if (typeof prompt !== "number" || typeof completion !== "number")
    return model.id;
  return `${model.id} · $${prompt}/$${completion} per 1M`;
}

async function readCompletion(response, onDelta) {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(
      payload.message ??
        payload.error?.replaceAll?.("_", " ") ??
        `Request failed (${response.status}).`,
    );
  }
  if (!response.body) throw new Error("The completion returned no stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const chunk = JSON.parse(data);
        if (chunk.error) throw new Error(chunk.error.replaceAll("_", " "));
        const delta = chunk.choices?.[0]?.delta;
        if (typeof delta?.reasoning_content === "string")
          onDelta("reasoning", delta.reasoning_content);
        if (typeof delta?.content === "string")
          onDelta("text", delta.content);
      }
    }
    if (done) break;
  }
}

export default {
  name: "account-playground",
  inject: [regionKey, customerKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const customer = view.get(customerKey);
    const element = card("account-playground", "02", "Playground");
    const body = element.querySelector(".account-card-body");
    const transcript = document.createElement("div");
    transcript.className = "account-conversation";
    const form = document.createElement("form");
    form.className = "account-form account-playground-form";
    const selectors = document.createElement("div");
    selectors.className = "account-inline";
    const applicationLabel = document.createElement("label");
    applicationLabel.textContent = "Application";
    const application = document.createElement("select");
    applicationLabel.append(application);
    const modelLabel = document.createElement("label");
    modelLabel.textContent = "Live model";
    const model = document.createElement("select");
    modelLabel.append(model);
    selectors.append(applicationLabel, modelLabel);
    const promptLabel = document.createElement("label");
    promptLabel.textContent = "Message";
    const prompt = document.createElement("textarea");
    prompt.name = "prompt";
    prompt.rows = 3;
    prompt.placeholder = "Ask a live model through Mycel…";
    prompt.required = true;
    promptLabel.append(prompt);
    const send = button("Send through Mycel", "primary");
    send.type = "submit";
    const error = errorLine();
    form.append(selectors, promptLabel, send, error);
    body.append(transcript, form);
    region.append(element);

    let messages = [];
    let modelsLoaded = false;
    let loadingModels = false;
    const render = () => renderConversation(transcript, messages);
    const loadModels = async () => {
      if (modelsLoaded || loadingModels) return;
      loadingModels = true;
      try {
        const response = await fetch("/v1/models");
        const payload = await response.json();
        if (!response.ok || !Array.isArray(payload.data))
          throw new Error("Could not read the live model catalogue.");
        model.replaceChildren(
          ...payload.data.map((entry) => {
            const option = document.createElement("option");
            option.value = entry.id;
            option.textContent = optionLabel(entry);
            return option;
          }),
        );
        modelsLoaded = true;
      } catch (cause) {
        showError(error, cause);
      } finally {
        loadingModels = false;
      }
    };

    const renderState = (state) => {
      const dashboard = state.dashboard;
      element.hidden = state.phase !== "ready" || !dashboard?.onboarded;
      if (element.hidden) return;
      const current = application.value;
      application.replaceChildren(
        ...(dashboard.applications ?? [])
          .filter((entry) => entry.enabled)
          .map((entry) => {
            const option = document.createElement("option");
            option.value = entry.id;
            option.textContent = entry.id;
            return option;
          }),
      );
      if ([...application.options].some((option) => option.value === current))
        application.value = current;
      send.disabled = !application.value || !model.value;
      void loadModels().then(() => {
        send.disabled = !application.value || !model.value;
      });
    };
    trackSubscription(ctx, customer, renderState);

    const onSubmit = async (event) => {
      event.preventDefault();
      const content = prompt.value.trim();
      if (!content || !application.value || !model.value) return;
      error.hidden = true;
      prompt.value = "";
      send.disabled = true;
      messages.push({ role: "user", parts: [{ kind: "text", text: content }] });
      const assistant = {
        role: "assistant",
        parts: [
          { kind: "reasoning", text: "" },
          { kind: "text", text: "" },
        ],
        streaming: true,
      };
      messages.push(assistant);
      render();
      try {
        const wireMessages = messages
          .slice(0, -1)
          .map((message) => ({
            role: message.role,
            content: message.parts
              .filter((part) => part.kind === "text")
              .map((part) => part.text)
              .join(""),
          }));
        const response = await customer.fetch(
          `/applications/${encodeURIComponent(application.value)}/playground`,
          {
            method: "POST",
            body: JSON.stringify({
              model: model.value,
              messages: wireMessages,
              stream: true,
            }),
          },
        );
        await readCompletion(response, (kind, delta) => {
          const part = assistant.parts.find((entry) => entry.kind === kind);
          part.text += delta;
          render();
        });
        assistant.streaming = false;
        assistant.parts = assistant.parts.filter((part) => part.text);
        render();
        await customer.refresh();
      } catch (cause) {
        assistant.streaming = false;
        assistant.parts.push({
          kind: "error",
          text: cause instanceof Error ? cause.message : String(cause),
        });
        render();
        showError(error, cause);
      } finally {
        send.disabled = !application.value || !model.value;
      }
    };
    form.addEventListener("submit", onSubmit);
    ctx.effect(() => () => form.removeEventListener("submit", onSubmit));
    return () => element.remove();
  },
};
