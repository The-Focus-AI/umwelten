/**
 * Chat component: renders the shared conversation transcript and sends
 * through the conversation service. Owns no conversation state — a
 * quick-prompt button (or any other component) sending through the same
 * service shows up here, because the transcript is the service's.
 */

import { serviceKey } from "../substrate/index.js";
import { renderConversation } from "../substrate/conversation-view.js";
import {
  IMAGE_TYPES,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_BYTES,
  parseImageDataUrl,
} from "../substrate/images.js";

const regionKey = serviceKey("shell:region");
const conversationKey = serviceKey("shell:conversation");

class HabitatChat extends HTMLElement {
  connectedCallback() {
    this.classList.add("shell-card");
    this.style.gridColumn = "1 / -1";
    this.innerHTML = `
      <h2>Chat</h2>
      <div class="log chat-log"></div>
      <div class="attachments" aria-label="Attached images"></div>
      <p class="attachment-error" role="alert"></p>
      <form class="composer">
        <input class="input" name="text" autocomplete="off" placeholder="Say something…"
          aria-label="Message">
        <label class="attach-btn" title="Attach images — PNG, JPEG, WebP or GIF; up to 4 images, 5 MiB each, 10 MiB total">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
          <input type="file" aria-label="Attach images" accept="${IMAGE_TYPES.join(",")}" multiple>
        </label>
        <button class="btn primary" type="submit">Send</button>
      </form>`;
  }

  renderTranscript(messages) {
    const log = this.querySelector(".log");
    renderConversation(log, messages);
  }
}

if (!customElements.get("habitat-chat")) {
  customElements.define("habitat-chat", HabitatChat);
}

export default {
  name: "chat",
  inject: [regionKey, conversationKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const conversation = view.get(conversationKey);
    const el = document.createElement("habitat-chat");
    el.dataset.component = "chat"; // placement identity (ADR 0034)
    region.appendChild(el);

    const form = el.querySelector("form");
    const input = el.querySelector('input[name="text"]');
    const files = el.querySelector('input[type="file"]');
    const send = el.querySelector('button[type="submit"]');
    const error = el.querySelector(".attachment-error");
    let reading = false;
    let shownImages;
    const unsubscribe = conversation.subscribe((messages) => {
      el.renderTranscript(messages);
      input.value = conversation.draft;
      input.disabled = conversation.savingForLogin;
      send.disabled = files.disabled =
        conversation.busy || reading || conversation.savingForLogin;
      if (shownImages !== conversation.images) {
        shownImages = conversation.images;
        const list = el.querySelector(".attachments");
        list.replaceChildren();
        for (const image of shownImages) {
          const item = document.createElement("div");
          const thumbnail = document.createElement("img");
          thumbnail.src = image.url;
          thumbnail.alt = image.name;
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "btn ghost sm";
          remove.textContent = "Remove";
          remove.setAttribute("aria-label", `Remove ${image.name}`);
          remove.onclick = () =>
            conversation.setImages(
              conversation.images.filter((candidate) => candidate !== image),
            );
          item.append(thumbnail, remove);
          list.append(item);
        }
      }
      for (const remove of el.querySelectorAll(".attachments button"))
        remove.disabled = conversation.savingForLogin;
    });
    ctx.effect(() => unsubscribe);
    const onFiles = async () => {
      reading = true;
      conversation.preparingImages = true;
      send.disabled = files.disabled = true;
      error.textContent = "";
      try {
        const selected = [...files.files];
        if (selected.length + conversation.images.length > MAX_IMAGES)
          throw new Error("Attach at most 4 images.");
        let total = conversation.images.reduce(
          (sum, image) => sum + image.size,
          0,
        );
        const images = [];
        for (const file of selected) {
          if (!IMAGE_TYPES.includes(file.type))
            throw new Error("Use PNG, JPEG, WebP, or GIF image files.");
          if (file.size > MAX_IMAGE_BYTES)
            throw new Error("Each image must be 5 MiB or smaller.");
          total += file.size;
          if (total > MAX_TOTAL_IMAGE_BYTES)
            throw new Error("Images must total 10 MiB or less.");
          const url = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () =>
              reject(new Error(`Could not read ${file.name}`));
            reader.readAsDataURL(file);
          });
          parseImageDataUrl(url);
          // A valid signature alone does not guarantee the browser can decode it.
          const image = new Image();
          image.src = url;
          await image.decode();
          images.push({
            url,
            name: file.name,
            mediaType: file.type,
            size: file.size,
          });
        }
        conversation.setImages([...conversation.images, ...images]);
      } catch (err) {
        error.textContent = err.message || "Unable to read image.";
      } finally {
        files.value = "";
        reading = false;
        conversation.preparingImages = false;
        send.disabled = files.disabled = conversation.busy;
      }
    };
    files.addEventListener("change", onFiles);
    ctx.effect(() => () => files.removeEventListener("change", onFiles));
    const onInput = () => {
      conversation.draft = input.value;
    };
    input.addEventListener("input", onInput);
    ctx.effect(() => () => input.removeEventListener("input", onInput));
    const onSubmit = (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (
        (!text && !conversation.images.length) ||
        conversation.busy ||
        conversation.savingForLogin ||
        reading
      )
        return;
      const images = conversation.images;
      input.value = "";
      conversation.draft = "";
      conversation.setImages([]);
      void conversation.send(text, true, images);
    };
    form.addEventListener("submit", onSubmit);
    ctx.effect(() => () => form.removeEventListener("submit", onSubmit));

    return () => el.remove();
  },
};
