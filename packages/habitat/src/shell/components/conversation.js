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
import {
  resolveToken,
  browserSession,
  signInAgain,
  signInMessage,
} from "./auth.js";

const baseKey = serviceKey("shell:base");
const conversationKey = serviceKey("shell:conversation");

export default {
  name: "conversation",
  inject: [baseKey],
  apply(ctx, view, config) {
    const base = view.get(baseKey);
    let threadId = crypto.randomUUID();
    const token = resolveToken(config?.token);
    const identity = browserSession(base, token);
    const checkpointKey = "shell:conversation-login";
    let rejected = null;

    /** @type {Array<{role:string, parts:Array<object>, streaming?:boolean}>} */
    const messages = [];
    const listeners = new Set();
    const notify = () => {
      for (const fn of listeners) fn(messages);
    };

    const conversation = {
      get threadId() {
        return threadId;
      },
      messages,
      draft: "",
      busy: false,
      subscribe(fn) {
        listeners.add(fn);
        fn(messages);
        return () => listeners.delete(fn);
      },
      async send(text, allowSignIn = true) {
        await ready;
        if (conversation.busy) return;
        conversation.busy = true;
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
          if (res.status === 401) {
            // Authentication rejects this request before the model runs. Only
            // this known-unexecuted message may be resumed after signing in.
            rejected = { text, reply };
            if (allowSignIn && (await signInAgain(base, token))) return;
            rejected = null;
            throw new Error(signInMessage);
          }
          if (!res.ok)
            throw new Error(`HTTP ${res.status}: ${await res.text()}`);

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
        } finally {
          reply.streaming = false;
          conversation.busy = false;
          notify();
        }
      },
    };

    const beforeSignIn = (event) => {
      // A panel's expired request must not abort a chat already executing.
      if (conversation.busy && !rejected) {
        event.preventDefault();
        return;
      }
      try {
        sessionStorage.setItem(
          checkpointKey,
          JSON.stringify({
            userId: event.detail.userId,
            savedAt: Date.now(),
            threadId,
            messages: rejected ? messages.slice(0, -2) : messages,
            draft: conversation.draft,
            pending: rejected?.text,
          }),
        );
      } catch {
        event.preventDefault();
      }
    };
    window.addEventListener("shell:before-sign-in", beforeSignIn);
    ctx.effect(
      () => () =>
        window.removeEventListener("shell:before-sign-in", beforeSignIn),
    );

    const ready = identity.then((user) => {
      try {
        const saved = JSON.parse(
          sessionStorage.getItem(checkpointKey) ?? "null",
        );
        sessionStorage.removeItem(checkpointKey);
        // Signing in as somebody else must not expose or replay this user's
        // conversation. Checkpoints are tab-local and consumed once.
        if (
          !user ||
          saved?.userId !== user.userId ||
          Date.now() - saved.savedAt > 10 * 60_000
        )
          return;
        threadId = saved.threadId;
        messages.push(...saved.messages);
        conversation.draft = saved.draft ?? "";
        notify();
        if (saved.pending) void conversation.send(saved.pending, false);
      } catch {
        // No saved state (or storage disabled): start a normal conversation.
      }
    });
    ctx.provide(conversationKey, conversation);
  },
};
