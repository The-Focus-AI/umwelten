/**
 * Tool-invocation service provider: `shell:tools` = { call(name, args) }
 * over the host's /mcp surface — the same authenticated tool surface every
 * other client uses (ADR 0032/0033: panels are views over tools; no
 * panel-private routes).
 *
 * The habitat's /mcp is stateless (fresh server per request), so a call is
 * one JSON-RPC POST — no handshake, no session. Responses arrive
 * SSE-framed or as plain JSON; both are handled.
 */

import { serviceKey } from "../substrate/index.js";
import { resolveToken, authHeaders } from "./auth.js";

const baseKey = serviceKey("shell:base");
const toolsKey = serviceKey("shell:tools");

function parsePayload(text, contentType) {
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) return JSON.parse(line.slice(6));
    }
    throw new Error("empty event stream from /mcp");
  }
  return JSON.parse(text);
}

export default {
  name: "tools",
  inject: [baseKey],
  apply(ctx, view, config) {
    const base = view.get(baseKey);
    const token = resolveToken(config?.token);
    let nextId = 1;

    ctx.provide(toolsKey, {
      /**
       * Call a habitat tool by name. Returns the tool's result — parsed
       * from JSON when the tool returned JSON, raw text otherwise. Throws
       * on transport errors, JSON-RPC errors, and tool-reported errors.
       */
      async call(name, args = {}) {
        const res = await fetch(new URL("/mcp", base), {
          method: "POST",
          headers: authHeaders(token, {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          }),
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: nextId++,
            method: "tools/call",
            params: { name, arguments: args },
          }),
        });
        if (res.status === 401)
          throw new Error(
            "Unauthorized — reload with ?token=<your api key> in the URL.",
          );
        if (!res.ok) throw new Error(`/mcp HTTP ${res.status}`);
        const payload = parsePayload(
          await res.text(),
          res.headers.get("content-type") ?? "",
        );
        if (payload.error)
          throw new Error(payload.error.message ?? "tool call failed");
        const result = payload.result ?? {};
        const text = (result.content ?? [])
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        if (result.isError) throw new Error(text || `${name} failed`);
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      },
    });
  },
};
