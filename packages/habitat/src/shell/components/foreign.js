/**
 * Foreign-mount host (#407, ADR 0033 — the trust line is the habitat
 * boundary): mounts another habitat's component in this shell, behind an
 * iframe.
 *
 * Config: { title, mcp, resource, token? }
 *   mcp      — the peer's MCP endpoint (e.g. "https://peer.example/mcp")
 *   resource — the ui:// resource to mount (e.g. "ui://shell/status")
 *   token    — bearer for the peer's /mcp, when it requires one
 *
 * The projection is fetched with one stateless resources/read call
 * (ADR 0032): the result is the peer's solo-page URL, which renders in a
 * sandboxed iframe. The iframe is the boundary — a foreign component runs
 * against ITS OWN habitat on its own origin, and the only channel back to
 * this page is the solo beacon (mount state + height), filtered by source.
 * Nothing from the peer touches this page's DOM or services.
 */

import { serviceKey } from "../substrate/index.js";

const regionKey = serviceKey("shell:region");

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

async function readResource(mcp, resource, token) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(mcp, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: { uri: resource },
    }),
  });
  if (!res.ok) throw new Error(`peer /mcp HTTP ${res.status}`);
  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  let payload;
  if (contentType.includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data: "));
    if (!line) throw new Error("empty event stream from peer /mcp");
    payload = JSON.parse(line.slice(6));
  } else {
    payload = JSON.parse(text);
  }
  if (payload.error) throw new Error(payload.error.message ?? "read failed");
  const content = (payload.result?.contents ?? [])[0];
  if (!content || content.mimeType !== "text/uri-list" || !content.text)
    throw new Error(`resource ${resource} is not a mountable URL projection`);
  return content.text.trim();
}

export default {
  name: "foreign",
  inject: [regionKey],
  apply(ctx, view, config) {
    const region = view.get(regionKey);
    const { title, mcp, resource, token } = config ?? {};

    const el = document.createElement("div");
    el.className = "shell-card";
    el.dataset.component = "foreign";
    el.dataset.resource = resource ?? "";
    el.innerHTML = `
      <h2>${esc(title ?? resource ?? "foreign component")}</h2>
      <p class="note" style="margin:0 0 0.5rem;color:var(--muted);font-size:0.75rem;">
        loading from peer…</p>`;
    region.appendChild(el);
    const note = el.querySelector(".note");

    let iframe;
    const onMessage = (event) => {
      // Only the beacon from OUR iframe counts; anything else is ignored.
      if (!iframe || event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || data.type !== "shell:solo") return;
      note.textContent = data.error
        ? `peer error: ${data.error}`
        : data.active
          ? `mounted from ${new URL(iframe.src).host}`
          : "peer assembling…";
      if (typeof data.height === "number" && data.height > 40) {
        iframe.style.height = `${Math.min(data.height, 800)}px`;
      }
    };
    window.addEventListener("message", onMessage);
    ctx.effect(() => () => window.removeEventListener("message", onMessage));

    (async () => {
      try {
        if (!mcp || !resource) throw new Error("config needs mcp and resource");
        const url = await readResource(mcp, resource, token);
        iframe = document.createElement("iframe");
        // The boundary: scripts run, the peer origin is itself, but this
        // page's origin, storage, and DOM are unreachable (cross-origin).
        iframe.setAttribute(
          "sandbox",
          "allow-scripts allow-same-origin allow-forms",
        );
        iframe.src = url;
        iframe.style.cssText =
          "width:100%;height:120px;border:0;border-radius:4px;background:var(--bg);";
        el.appendChild(iframe);
      } catch (err) {
        note.textContent = err.message;
      }
    })();

    return () => el.remove();
  },
};
