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
      <style>habitat-chat label:focus-within { outline:2px solid var(--accent); }</style>
      <h2>chat</h2>
      <div class="log" style="display:flex;flex-direction:column;gap:0.6rem;
        max-height:50vh;overflow-y:auto;padding:0.2rem 0;"></div>
      <div class="attachments" aria-label="Attached images" style="display:flex;flex-wrap:wrap;gap:0.6rem;"></div>
      <p class="attachment-error" role="alert" style="color:var(--error);margin:0.3rem 0;"></p>
      <form style="display:flex;flex-wrap:wrap;gap:0.6rem;margin-top:0.8rem;">
        <input name="text" autocomplete="off" placeholder="say something…"
          aria-label="Message" style="flex:1;min-width:8rem;background:var(--bg);border:1px solid var(--line);
          border-radius:4px;color:var(--ink);font:inherit;padding:0.5rem 0.7rem;">
        <label title="Attach images — PNG, JPEG, WebP or GIF; up to 4 images, 5 MiB each, 10 MiB total"
          style="position:relative;display:flex;align-items:center;justify-content:center;cursor:pointer;
            color:var(--muted);border-radius:4px;padding:0.5rem;">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
          <input type="file" aria-label="Attach images" accept="${IMAGE_TYPES.join(",")}" multiple
            style="position:absolute;inset:0;width:100%;opacity:0;cursor:pointer;">
        </label>
        <button type="submit" style="background:var(--accent);border:0;border-radius:4px;
          color:var(--bg);font:inherit;font-weight:600;padding:0.5rem 1rem;
          cursor:pointer;">send</button>
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
          Object.assign(thumbnail.style, {
            width: "6rem",
            height: "5rem",
            objectFit: "contain",
            display: "block",
          });
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "remove";
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
