/**
 * Conversation service provider (#401, ADR 0032's prompt/intent target).
 *
 * Owns the transcript and the wire: send() appends the user message,
 * streams the assistant's reply (text, reasoning, tool events) from the
 * host's /api/chat UI-message stream into the shared transcript, and
 * notifies subscribers on every change. Renders nothing — the chat
 * component (and anything else) consumes this service; a canned-prompt
 * button proves the seam is shared, and a wire-projected component's
 * `prompt` action will bind here the same way.
 */

import { serviceKey } from "../substrate/index.js";

const baseKey = serviceKey("shell:base");
const conversationKey = serviceKey("shell:conversation");

export default {
  name: "conversation",
  inject: [baseKey],
  apply(ctx, view, config) {
    const base = view.get(baseKey);
    const threadId = crypto.randomUUID();
    // Token resolution follows the old dashboard's convention so the two
    // UIs share auth on the same origin: ?token= in the URL (persisted),
    // then the stored "habitat-token". config.token wins when a host
    // pins one in the manifest.
    const token =
      config?.token ??
      (() => {
        try {
          const fromUrl = new URLSearchParams(location.search).get("token");
          if (fromUrl) {
            localStorage.setItem("habitat-token", fromUrl);
            return fromUrl;
          }
          return (
            localStorage.getItem("habitat-token") ??
            localStorage.getItem("shell:token") ??
            undefined
          );
        } catch {
          return undefined;
        }
      })();

    /** @type {Array<{role:string, parts:Array<object>, streaming?:boolean}>} */
    const messages = [];
    const listeners = new Set();
    const notify = () => {
      for (const fn of listeners) fn(messages);
    };

    const conversation = {
      threadId,
      messages,
      subscribe(fn) {
        listeners.add(fn);
        fn(messages);
        return () => listeners.delete(fn);
      },
      async send(text) {
        messages.push({ role: "user", parts: [{ kind: "text", text }] });
        const reply = { role: "assistant", parts: [], streaming: true };
        messages.push(reply);
        notify();

        const part = (kind) => {
          let last = reply.parts[reply.parts.length - 1];
          if (!last || last.kind !== kind) {
            last = { kind, text: "" };
            reply.parts.push(last);
          }
          return last;
        };

        try {
          const headers = { "Content-Type": "application/json" };
          if (token) headers.Authorization = `Bearer ${token}`;
          const res = await fetch(new URL("/api/chat", base), {
            method: "POST",
            headers,
            body: JSON.stringify({
              id: threadId,
              messages: [{ role: "user", content: text }],
            }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          const tools = new Map();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6);
              if (payload === "[DONE]") continue;
              let event;
              try {
                event = JSON.parse(payload);
              } catch {
                continue;
              }
              if (event.type === "text-delta") {
                part("text").text += event.delta;
              } else if (event.type === "reasoning-delta") {
                part("reasoning").text += event.delta;
              } else if (event.type === "tool-input-available") {
                const p = {
                  kind: "tool",
                  name: event.toolName,
                  input: event.input,
                };
                tools.set(event.toolCallId, p);
                reply.parts.push(p);
              } else if (event.type === "tool-output-available") {
                const p = tools.get(event.toolCallId);
                if (p) p.output = event.output;
              }
              notify();
            }
          }
        } catch (err) {
          const text = String(err.message ?? err);
          reply.parts.push({ kind: "error", text });
          if (text.includes("401")) {
            reply.parts.push({
              kind: "error",
              text:
                "This host requires a token. Reload the page with " +
                "?token=<your api key> appended to the URL — it is " +
                "remembered for next time.",
            });
          }
        } finally {
          reply.streaming = false;
          notify();
        }
      },
    };

    ctx.provide(conversationKey, conversation);
  },
};
