/**
 * Trusted `PerimeterGateway` Plane (`examples/client-env/`).
 *
 * Holds ALL secrets, deploys a dedicated client-local Mycel Exchange for LLM
 * proxying & micro-dollar metering, runs the Hybrid HTTP/MCP Credential Proxy
 * (named `/egress/:service/*` routes + forward-proxy allowlist check), and
 * writes one correlated Audit & Trace Ledger (`traces.jsonl` + SSE UI).
 */

import { timingSafeEqual } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { createExchangeServer, type RunningExchange } from "@umwelten/mycel/server.js";
import { MemoryStore } from "@umwelten/mycel/store/memory-store.js";
import { Operator } from "@umwelten/mycel/operator.js";
import { Balances, applicationOwner } from "@umwelten/mycel/metering/balances.js";
import { LABS_CSS } from "../../scripts/site-styles.js";

export type AuditSpanKind =
  | "a2a.inbound"
  | "llm.completion"
  | "http.egress"
  | "http.forward"
  | "policy.denied";

export interface AuditSpan {
  id: string;
  traceId: string;
  timestamp: string;
  kind: AuditSpanKind;
  habitatId: string;
  speakerId: string;
  method: string;
  target: string;
  status: number;
  latencyMs: number;
  redactions: number;
  injectedSecretId?: string;
  model?: string;
  supplierId?: string;
  promptTokens?: number;
  completionTokens?: number;
  chargeMicroDollars?: number;
  detail?: string;
}

export interface EgressRoutePolicy {
  baseUrl: string;
  secretId: string;
  allowedMethods: string[];
  allowedPathPrefix: string;
}

export interface ClientPerimeterOptions {
  port?: number;
  host?: string;
  auditDir: string;
  habitatToken: string;
  supplierBaseUrl: string;
  modelId?: string;
  secrets: Record<string, string>;
  egressRoutes: Record<string, EgressRoutePolicy>;
  forwardAllowlistHosts?: string[];
}

export interface ClientPerimeterHandle {
  url: string;
  port: number;
  mycelUrl: string;
  tracesFile: string;
  getSpans: () => AuditSpan[];
  recordSpan: (span: Omit<AuditSpan, "id" | "timestamp">) => AuditSpan;
  setAskHandler: (
    handler: (input: {
      traceId: string;
      speakerId: string;
      prompt: string;
    }) => Promise<{ text: string }>,
  ) => void;
  close: () => Promise<void>;
}

function bearerMatches(authHeader: string | undefined, expectedToken: string): boolean {
  if (!authHeader) return false;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const actual = Buffer.from(m[1].trim(), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > 5_000_000) {
      throw new Error("Request body exceeds 5 MB limit");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function scrubSecrets(
  input: string,
  secrets: Record<string, string>,
): { scrubbed: string; redactions: number } {
  let text = input;
  let redactions = 0;
  for (const val of Object.values(secrets)) {
    if (!val || val.length < 4) continue;
    const candidates = [val, Buffer.from(val, "utf8").toString("base64")];
    for (const pattern of candidates) {
      if (!pattern) continue;
      let idx = text.indexOf(pattern);
      while (idx !== -1) {
        redactions += 1;
        text =
          text.slice(0, idx) +
          "[REDACTED_VAULT_SECRET]" +
          text.slice(idx + pattern.length);
        idx = text.indexOf(pattern, idx + "[REDACTED_VAULT_SECRET]".length);
      }
    }
  }
  return { scrubbed: text, redactions };
}

function renderAuditUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Client Environment · Perimeter Proxy &amp; Correlated Audit Ledger</title>
  <link rel="stylesheet" href="/styles/labs.css">
  <style>
    body { background: var(--canvas); color: var(--ink); font-family: var(--sans); }
    .ce-wrap { max-width: 1280px; margin: 0 auto; padding: 20px 24px 48px; display: flex; flex-direction: column; gap: 18px; }
    .ce-head { background: var(--paper); border: 1px solid var(--border-strong); padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
    .ce-grid { display: grid; grid-template-columns: 360px 1fr; gap: 18px; align-items: start; }
    @media (max-width: 900px) { .ce-grid { grid-template-columns: 1fr; } }
    .ce-panel { background: var(--paper); border: 1px solid var(--border-strong); padding: 16px 18px; }
    .ce-kicker { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent-warm); font-weight: 600; }
    .ce-input, .ce-textarea { width: 100%; font-family: var(--font-mono); font-size: 12px; padding: 7px 9px; border: 1px solid var(--border-strong); background: var(--surface-raised); color: var(--ink); }
    .ce-textarea { font-family: var(--sans); min-height: 76px; resize: vertical; }
    .ce-btn { font-family: var(--font-mono); font-size: 12px; font-weight: 600; padding: 8px 14px; border: 1px solid var(--signal); background: var(--signal); color: var(--paper); cursor: pointer; }
    .ce-btn.secondary { background: var(--surface-raised); color: var(--ink); border-color: var(--border-strong); }
    .ce-trace-group { border: 1px solid var(--border-strong); background: var(--surface-raised); margin-bottom: 12px; padding: 10px 12px; }
    .ce-span-row { display: grid; grid-template-columns: 130px 70px 1fr auto; gap: 8px; align-items: center; font-family: var(--font-mono); font-size: 11.5px; padding: 6px 8px; background: var(--paper); border: 1px solid var(--border); margin-top: 6px; }
    .ce-pill { display: inline-block; font-family: var(--font-mono); font-size: 10px; padding: 1px 6px; border: 1px solid var(--border-strong); background: var(--surface); }
    .ce-pill.llm { background: var(--accent-soft); color: var(--signal); border-color: var(--signal); }
    .ce-pill.http { background: var(--green-bg); color: var(--green); border-color: var(--green); }
    .ce-pill.denied { background: var(--red-bg); color: var(--red); border-color: var(--red); }
  </style>
</head>
<body>
  <div class="ce-wrap">
    <header class="ce-head">
      <div>
        <div class="ce-kicker">TheFocus.AI · Client Environment Perimeter (Decision D-11)</div>
        <h1 style="font-family: var(--serif); font-size: 24px; margin-top: 3px;">LLM + HTTP Credential Proxy &amp; Audit Ledger</h1>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <span class="ce-pill">Zero Secrets Inside Habitat Runtime</span>
        <span id="ce-live-pill" class="ce-pill llm">SSE Connecting...</span>
      </div>
    </header>

    <div class="ce-grid">
      <section class="ce-panel" style="display: flex; flex-direction: column; gap: 10px;">
        <div class="ce-kicker">Invoke QuickBooks Habitat (via Perimeter)</div>
        <label class="ce-kicker" style="color: var(--muted);">Speaker Identity (X-Mycel-End-User)</label>
        <input id="ce-speaker" class="ce-input" value="cfo@acme.example">
        <label class="ce-kicker" style="color: var(--muted);">Prompt</label>
        <textarea id="ce-prompt" class="ce-textarea">Check current QuickBooks Aged Receivables and summarize overdue invoices.</textarea>
        <button id="ce-send" type="button" class="ce-btn">Ask Habitat (Mints x-trace-id)</button>
        <div style="border-top: 1px solid var(--border); padding-top: 10px; margin-top: 4px; display: flex; flex-direction: column; gap: 6px;">
          <div class="ce-kicker" style="color: var(--muted);">Last Answer</div>
          <pre id="ce-answer" style="white-space: pre-wrap; font-size: 12.5px; line-height: 1.5; background: var(--surface-raised); border: 1px solid var(--border); padding: 9px; margin: 0;">Send a prompt to trigger correlated Mycel + QuickBooks spans.</pre>
        </div>
      </section>

      <section class="ce-panel">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div class="ce-kicker">Correlated Audit &amp; Trace Ledger (traces.jsonl)</div>
          <span id="ce-count" style="font-family: var(--font-mono); font-size: 11px; color: var(--muted);">0 spans</span>
        </div>
        <div id="ce-ledger"></div>
      </section>
    </div>
  </div>

  <script>
    (function () {
      var spans = [];
      function makeEl(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
      }
      function pillCls(kind) {
        if (kind === "llm.completion") return "llm";
        if (kind === "policy.denied") return "denied";
        return "http";
      }
      function render() {
        document.getElementById("ce-count").textContent = spans.length + " span(s)";
        var byTrace = new Map();
        for (var i = 0; i < spans.length; i++) {
          var s = spans[i];
          var arr = byTrace.get(s.traceId) || [];
          arr.push(s);
          byTrace.set(s.traceId, arr);
        }
        var ledger = document.getElementById("ce-ledger");
        ledger.textContent = "";
        var keys = Array.from(byTrace.keys()).reverse();
        if (keys.length === 0) {
          var empty = makeEl("div", "", "No spans recorded yet.");
          empty.style.color = "var(--muted)";
          empty.style.fontFamily = "var(--font-mono)";
          empty.style.fontSize = "12px";
          ledger.appendChild(empty);
          return;
        }
        for (var k = 0; k < keys.length; k++) {
          var tid = keys[k];
          var group = byTrace.get(tid) || [];
          var box = makeEl("div", "ce-trace-group");
          var hdr = makeEl("div");
          hdr.style.display = "flex";
          hdr.style.justifyContent = "space-between";
          hdr.style.fontFamily = "var(--font-mono)";
          hdr.style.fontSize = "11px";
          hdr.appendChild(makeEl("strong", "", "traceId=" + tid));
          var sub = makeEl("span", "", "speaker=" + group[0].speakerId + " · habitat=" + group[0].habitatId);
          sub.style.color = "var(--muted)";
          hdr.appendChild(sub);
          box.appendChild(hdr);
          for (var j = 0; j < group.length; j++) {
            var sp = group[j];
            var meta = [];
            if (sp.injectedSecretId) meta.push("injected=" + sp.injectedSecretId);
            if (sp.chargeMicroDollars != null) meta.push(sp.chargeMicroDollars + " u$");
            if (sp.promptTokens != null) meta.push(sp.promptTokens + "p/" + sp.completionTokens + "c tok");
            if (sp.redactions > 0) meta.push("scrubbed=" + sp.redactions);
            if (sp.detail) meta.push(sp.detail);
            var row = makeEl("div", "ce-span-row");
            row.appendChild(makeEl("span", "ce-pill " + pillCls(sp.kind), sp.kind));
            row.appendChild(makeEl("span", "", sp.method + " " + sp.status));
            var mid = makeEl("span");
            mid.appendChild(makeEl("div", "", sp.target));
            var metaEl = makeEl("div", "", meta.join(" · "));
            metaEl.style.color = "var(--muted)";
            mid.appendChild(metaEl);
            row.appendChild(mid);
            row.appendChild(makeEl("span", "", sp.latencyMs + "ms"));
            box.appendChild(row);
          }
          ledger.appendChild(box);
        }
      }
      var src = new EventSource("/api/traces/stream");
      src.onopen = function () {
        spans = [];
        document.getElementById("ce-live-pill").textContent = "SSE Live";
      };
      src.onmessage = function (ev) {
        if (!ev.data) return;
        spans.push(JSON.parse(ev.data));
        render();
      };
      document.getElementById("ce-send").addEventListener("click", async function () {
        var btn = document.getElementById("ce-send");
        btn.disabled = true;
        try {
          var res = await fetch("/api/ask", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              speakerId: document.getElementById("ce-speaker").value,
              prompt: document.getElementById("ce-prompt").value
            })
          });
          var body = await res.json();
          document.getElementById("ce-answer").textContent = body.text || body.error || JSON.stringify(body);
        } finally {
          btn.disabled = false;
        }
      });
    })();
  </script>
</body>
</html>`;
}

export async function startClientPerimeter(
  options: ClientPerimeterOptions,
): Promise<ClientPerimeterHandle> {
  const host = options.host ?? "127.0.0.1";
  const modelId = options.modelId ?? "gemma-4-26b";
  mkdirSync(options.auditDir, { recursive: true });
  const tracesFile = join(options.auditDir, "traces.jsonl");
  writeFileSync(tracesFile, "", "utf8");

  // ── 1. Dedicated Client-Local Mycel Exchange inside the Perimeter ─────
  const mycelStore = new MemoryStore();
  await mycelStore.setup();
  const operator = new Operator(mycelStore);
  const { credential: supplierCred } = await operator.registerSupplier({
    id: "client-supplier",
    displayName: "Client Approved Supplier",
    baseUrl: options.supplierBaseUrl,
  });
  await mycelStore.createClient({ id: "client-acme", name: "Acme Client" });
  const clientApp = await operator.createApplication({
    id: "client-env-app",
    clientId: "client-acme",
  });
  if (!clientApp.credential) {
    throw new Error("Expected static credential for client-env-app");
  }
  const mycelAppCredential = clientApp.credential;
  const balances = new Balances(mycelStore);
  await balances.grant(
    applicationOwner("client-env-app"),
    10_000_000,
    "client-env-float",
  );

  const exchange: RunningExchange = await createExchangeServer({
    store: mycelStore,
    port: 0,
    host: "127.0.0.1",
  });

  const pubRes = await fetch(`${exchange.url}/suppliers/offers`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${supplierCred}`,
    },
    body: JSON.stringify({
      offers: [
        {
          model: modelId,
          capabilities: ["chat", "streaming", "tool-calling"],
          servingMode: "managed",
          contextTokens: 131072,
        },
      ],
    }),
  });
  if (!pubRes.ok) {
    throw new Error(
      `Client-local Mycel supplier publish failed (${pubRes.status}): ${await pubRes.text()}`,
    );
  }

  // Keep Mycel app credential strictly inside the Perimeter secret vault
  const allSecrets: Record<string, string> = {
    ...options.secrets,
    mycel_app_credential: mycelAppCredential,
    supplier_credential: supplierCred,
  };

  // ── 2. Correlated Audit & Trace Ledger ────────────────────────────────
  const spans: AuditSpan[] = [];
  const sseSubscribers = new Set<{
    res: ServerResponse;
    ping: ReturnType<typeof setInterval>;
  }>();
  let spanSeq = 0;

  const recordSpan = (input: Omit<AuditSpan, "id" | "timestamp">): AuditSpan => {
    const span: AuditSpan = {
      id: `sp-${++spanSeq}`,
      timestamp: new Date().toISOString(),
      ...input,
    };
    spans.push(span);
    appendFileSync(tracesFile, `${JSON.stringify(span)}\n`, "utf8");
    const frame = `data: ${JSON.stringify(span)}\n\n`;
    for (const sub of sseSubscribers) {
      try {
        sub.res.write(frame);
      } catch {
        // Closed streams cleaned up via close listeners
      }
    }
    return span;
  };

  let askHandler:
    | ((input: { traceId: string; speakerId: string; prompt: string }) => Promise<{ text: string }>)
    | undefined;

  const allowedForwardHosts = new Set(options.forwardAllowlistHosts ?? []);

  // ── 3. Perimeter HTTP Gateway (Auth, LLM Proxy, Egress Proxy, UI) ─────
  const server = http.createServer(async (req, res) => {
    const startedAt = Date.now();
    const method = req.method ?? "GET";
    const urlObj = new URL(req.url ?? "/", `http://${host}`);
    const pathname = urlObj.pathname;

    try {
      if (method === "GET" && pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderAuditUiHtml());
        return;
      }

      if (method === "GET" && pathname === "/styles/labs.css") {
        res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
        res.end(LABS_CSS);
        return;
      }

      if (method === "GET" && pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            mode: "client-env-perimeter",
            mycelUrl: exchange.url,
            tracesFile,
            spansCount: spans.length,
          }),
        );
        return;
      }

      if (method === "GET" && pathname === "/api/traces") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ spans, tracesFile }));
        return;
      }

      if (method === "GET" && pathname === "/api/traces/stream") {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });
        for (const sp of spans) {
          res.write(`data: ${JSON.stringify(sp)}\n\n`);
        }
        const ping = setInterval(() => {
          try {
            res.write(": ping\n\n");
          } catch {
            // Closed on disconnect
          }
        }, 15_000);
        const sub = { res, ping };
        sseSubscribers.add(sub);
        const cleanup = () => {
          clearInterval(ping);
          sseSubscribers.delete(sub);
        };
        req.on("close", cleanup);
        res.on("close", cleanup);
        return;
      }

      if (method === "POST" && pathname === "/api/ask") {
        if (!askHandler) {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "No Habitat runtime attached." }));
          return;
        }
        const raw = await readRequestBody(req);
        const body = JSON.parse(raw.toString("utf8") || "{}") as {
          speakerId?: string;
          prompt?: string;
          traceId?: string;
        };
        const speakerId = (body.speakerId ?? "analyst@client.example").trim();
        const prompt = (body.prompt ?? "").trim();
        const traceId = body.traceId ?? `tr-${Date.now()}`;
        if (!prompt) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "prompt is required" }));
          return;
        }
        const ans = await askHandler({ traceId, speakerId, prompt });
        recordSpan({
          traceId,
          kind: "a2a.inbound",
          habitatId: "quickbooks-ops",
          speakerId,
          method: "POST",
          target: "/a2a",
          status: 200,
          latencyMs: Date.now() - startedAt,
          redactions: 0,
          detail: `prompt=${prompt.slice(0, 60)}`,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ traceId, speakerId, text: ans.text }));
        return;
      }

      // Authenticate all runtime -> perimeter calls
      const traceId = String(req.headers["x-trace-id"] ?? `tr-uncorrelated-${Date.now()}`);
      const habitatId = String(req.headers["x-habitat-id"] ?? "unknown-habitat");
      const speakerId = String(req.headers["x-speaker-id"] ?? "anonymous");

      if (pathname.startsWith("/llm/v1/") || pathname.startsWith("/egress/") || pathname === "/forward-check") {
        if (!bearerMatches(req.headers.authorization, options.habitatToken)) {
          recordSpan({
            traceId,
            kind: "policy.denied",
            habitatId,
            speakerId,
            method,
            target: pathname,
            status: 401,
            latencyMs: Date.now() - startedAt,
            redactions: 0,
            detail: "Invalid or missing habitat perimeter token",
          });
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized perimeter caller" }));
          return;
        }
      }

      // ── 3A. LLM Proxy -> Client-Local Mycel Exchange ──────────────────
      if (pathname.startsWith("/llm/v1/")) {
        const subPath = pathname.slice("/llm".length) + urlObj.search;
        const bodyBuf = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(req);
        const beforeCount = (await mycelStore.listRequests()).length;

        const upstreamRes = await fetch(`${exchange.url}${subPath}`, {
          method,
          headers: {
            "content-type": String(req.headers["content-type"] ?? "application/json"),
            authorization: `Bearer ${mycelAppCredential}`,
            "x-mycel-end-user": speakerId,
          },
          body: bodyBuf ? new Uint8Array(bodyBuf) : undefined,
        });

        const contentType = upstreamRes.headers.get("content-type") ?? "application/json";
        const rawText = await upstreamRes.text();
        const { scrubbed, redactions } = scrubSecrets(rawText, allSecrets);

        const afterList = await mycelStore.listRequests();
        const latestRec =
          afterList.length > beforeCount ? afterList[afterList.length - 1] : undefined;

        let reqModel = modelId;
        if (bodyBuf) {
          try {
            const parsed = JSON.parse(bodyBuf.toString("utf8")) as { model?: string };
            if (parsed.model) reqModel = parsed.model;
          } catch {
            // Keep default
          }
        }

        recordSpan({
          traceId,
          kind: "llm.completion",
          habitatId,
          speakerId,
          method,
          target: subPath,
          status: upstreamRes.status,
          latencyMs: Date.now() - startedAt,
          redactions,
          injectedSecretId: "mycel_app_credential",
          model: latestRec?.model ?? reqModel,
          supplierId: latestRec?.supplierId ?? "client-supplier",
          promptTokens: latestRec?.promptTokens,
          completionTokens: latestRec?.completionTokens,
          chargeMicroDollars: latestRec?.charge,
        });

        res.writeHead(upstreamRes.status, { "content-type": contentType });
        res.end(scrubbed);
        return;
      }

      // ── 3B. Named Hybrid HTTP/MCP Egress Proxy (/egress/:service/*) ───
      const egressMatch = pathname.match(/^\/egress\/([^/]+)(\/.*)?$/);
      if (egressMatch) {
        const serviceName = decodeURIComponent(egressMatch[1]);
        const targetPath = (egressMatch[2] ?? "/") + urlObj.search;

        if (targetPath.includes("..")) {
          recordSpan({
            traceId,
            kind: "policy.denied",
            habitatId,
            speakerId,
            method,
            target: pathname,
            status: 400,
            latencyMs: Date.now() - startedAt,
            redactions: 0,
            detail: "Path traversal blocked",
          });
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid path" }));
          return;
        }

        const route = options.egressRoutes[serviceName];
        if (!route) {
          recordSpan({
            traceId,
            kind: "policy.denied",
            habitatId,
            speakerId,
            method,
            target: pathname,
            status: 404,
            latencyMs: Date.now() - startedAt,
            redactions: 0,
            detail: `Unknown egress service ${serviceName}`,
          });
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: `Unknown service "${serviceName}"` }));
          return;
        }

        if (
          !route.allowedMethods.includes(method) ||
          !targetPath.startsWith(route.allowedPathPrefix)
        ) {
          recordSpan({
            traceId,
            kind: "policy.denied",
            habitatId,
            speakerId,
            method,
            target: `${serviceName}:${targetPath}`,
            status: 403,
            latencyMs: Date.now() - startedAt,
            redactions: 0,
            detail: `Method ${method} or path blocked by ACL`,
          });
          res.writeHead(403, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: `Forbidden by perimeter ACL: ${method} ${targetPath}`,
            }),
          );
          return;
        }

        const secretVal = options.secrets[route.secretId];
        if (!secretVal) {
          throw new Error(`Missing vault secret ${route.secretId}`);
        }

        const bodyBuf = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(req);
        const upstreamRes = await fetch(`${route.baseUrl}${targetPath}`, {
          method,
          headers: {
            authorization: `Bearer ${secretVal}`,
            ...(req.headers["content-type"]
              ? { "content-type": String(req.headers["content-type"]) }
              : {}),
          },
          body: bodyBuf ? new Uint8Array(bodyBuf) : undefined,
        });

        const rawText = await upstreamRes.text();
        const { scrubbed, redactions } = scrubSecrets(rawText, allSecrets);

        recordSpan({
          traceId,
          kind: "http.egress",
          habitatId,
          speakerId,
          method,
          target: `${serviceName}:${targetPath}`,
          status: upstreamRes.status,
          latencyMs: Date.now() - startedAt,
          redactions,
          injectedSecretId: route.secretId,
          ...(redactions > 0 ? { detail: `scrubbed ${redactions} secret match(es)` } : {}),
        });

        res.writeHead(upstreamRes.status, {
          "content-type": upstreamRes.headers.get("content-type") ?? "application/json",
        });
        res.end(scrubbed);
        return;
      }

      // ── 3C. Forward Proxy Allowlist Gate (for CodingTools bash egress) ──
      if (method === "POST" && pathname === "/forward-check") {
        const raw = await readRequestBody(req);
        const parsed = JSON.parse(raw.toString("utf8") || "{}") as {
          targetUrl?: string;
          method?: string;
        };
        const targetUrl = new URL(String(parsed.targetUrl ?? ""));
        const reqMethod = String(parsed.method ?? "GET");

        if (!allowedForwardHosts.has(targetUrl.host)) {
          recordSpan({
            traceId,
            kind: "policy.denied",
            habitatId,
            speakerId,
            method: reqMethod,
            target: targetUrl.toString(),
            status: 403,
            latencyMs: Date.now() - startedAt,
            redactions: 0,
            detail: `Host ${targetUrl.host} not in forward proxy allowlist`,
          });
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: `Forward egress denied for ${targetUrl.host}` }));
          return;
        }

        const upstreamRes = await fetch(targetUrl, { method: reqMethod });
        const rawText = await upstreamRes.text();
        const { scrubbed, redactions } = scrubSecrets(rawText, allSecrets);

        recordSpan({
          traceId,
          kind: "http.forward",
          habitatId,
          speakerId,
          method: reqMethod,
          target: targetUrl.toString(),
          status: upstreamRes.status,
          latencyMs: Date.now() - startedAt,
          redactions,
        });
        res.writeHead(upstreamRes.status, {
          "content-type": upstreamRes.headers.get("content-type") ?? "text/plain",
        });
        res.end(scrubbed);
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `Not found: ${method} ${pathname}` }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
      } else {
        res.end();
      }
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port ?? 0, host, () => {
      server.removeListener("error", rejectListen);
      resolveListen();
    });
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    url: `http://${host}:${port}`,
    port,
    mycelUrl: exchange.url,
    tracesFile,
    getSpans: () => [...spans],
    recordSpan,
    setAskHandler(handler) {
      askHandler = handler;
    },
    async close() {
      for (const sub of sseSubscribers) {
        clearInterval(sub.ping);
        sub.res.end();
      }
      sseSubscribers.clear();
      server.closeIdleConnections?.();
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      });
      await exchange.close();
    },
  };
}
