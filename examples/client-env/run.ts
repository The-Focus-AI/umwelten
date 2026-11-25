#!/usr/bin/env node
/**
 * Client Environment E2E Demo & Audit Workbench (`pnpm run demo:client-env`).
 *
 * Demonstrates rethinking GaiaHost into a two-plane Client Environment:
 *   - Trusted `PerimeterGateway` (client-local Mycel LLM proxy/tracer + Hybrid
 *     HTTP/MCP credential proxy + correlated Audit Ledger `traces.jsonl`)
 *   - Untrusted zero-secret `HabitatRuntime` (`DurableHabitat` + SQLite +
 *     Mounted R/O ontology repo)
 *
 * Run:
 *   pnpm run demo:client-env
 *   pnpm run demo:client-env -- --serve
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { startMockQuickBooksApi, startMockToolSupplier } from "./mock-upstreams.js";
import { startClientPerimeter, type AuditSpan } from "./perimeter.js";
import { startClientHabitatRuntime } from "./runtime.js";

function printHelp(): void {
  console.log(`Usage: pnpm run demo:client-env [-- [options]]

Starts the two-plane Client Environment prototype:
  - Trusted PerimeterGateway (client-local Mycel LLM proxy + Hybrid HTTP proxy + traces.jsonl)
  - Zero-secret HabitatRuntime (QuickBooks DurableHabitat + Mounted R/O ontology)

Options:
  --smoke          Run all security, scrubbing, LLM tracing & correlation checks (default)
  --serve          Run the live Warm Paper Audit & Trace UI at http://127.0.0.1:<port>
  --port <port>    Port for --serve (default: 7450)
  --help, -h       Show this help message`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== "--"),
    options: {
      smoke: { type: "boolean", default: false },
      serve: { type: "boolean", default: false },
      port: { type: "string", default: "7450" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    return;
  }

  const serveMode = values.serve && !values.smoke;
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid --port: ${values.port}`);
  }

  const tmpRoot = await mkdtemp(join(tmpdir(), "umwelten-client-env-"));
  const auditDir = join(tmpRoot, "audit");
  const habitatDir = join(tmpRoot, "habitats", "quickbooks-ops");
  const ontologyDir = join(tmpRoot, "ontology");
  await mkdir(ontologyDir, { recursive: true });
  await writeFile(
    join(ontologyDir, "GLOSSARY.md"),
    "# Acme FinOps Ontology\n\n- **Overdue A/R**: Invoices >30 days past due excluding GL 6410 pass-throughs.\n",
    "utf8",
  );

  // Vault secrets kept strictly on the Perimeter side — never passed to Runtime
  const intuitSecret = `intuit-live-secret-${randomBytes(8).toString("hex")}`;
  const habitatToken = `hab-scoped-${randomBytes(8).toString("hex")}`;

  const qbo = await startMockQuickBooksApi(intuitSecret);
  const supplier = await startMockToolSupplier();
  const perimeter = await startClientPerimeter({
    port: serveMode ? port : 0,
    auditDir,
    habitatToken,
    supplierBaseUrl: supplier.baseUrl,
    secrets: {
      quickbooks_oauth_token: intuitSecret,
    },
    egressRoutes: {
      quickbooks: {
        baseUrl: qbo.baseUrl,
        secretId: "quickbooks_oauth_token",
        allowedMethods: ["GET"],
        allowedPathPrefix: "/v3/company/",
      },
    },
    forwardAllowlistHosts: [new URL(qbo.baseUrl).host],
  });

  const runtime = await startClientHabitatRuntime({
    habitatId: "quickbooks-ops",
    name: "QuickBooks FinOps Habitat",
    description: "Read-only financial operations assistant grounded in Acme ontology.",
    perimeterUrl: perimeter.url,
    habitatToken,
    workDir: habitatDir,
    ontologyDir,
  });

  perimeter.setAskHandler(async ({ traceId, speakerId, prompt }) => {
    const res = await runtime.askWithTrace({ traceId, speakerId, prompt });
    return { text: res.text };
  });

  try {
    if (serveMode) {
      console.log(`\nClient Environment Audit Workbench running at ${perimeter.url}`);
      console.log(`  Client-Local Mycel: ${perimeter.mycelUrl}`);
      console.log(`  Audit Trace Ledger: ${perimeter.tracesFile}`);
      console.log("  Press Ctrl+C to stop cleanly.\n");

      await new Promise<void>((resolveStop) => {
        const stop = () => resolveStop();
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
      return;
    }

    console.log("=== Client Environment Perimeter + Correlated Audit Smoke Test ===");
    console.log(`Perimeter Gateway:  ${perimeter.url}`);
    console.log(`Client-Local Mycel: ${perimeter.mycelUrl}`);

    // 1. Validate rendered Warm Paper UI HTML + JS syntax
    const uiRes = await fetch(`${perimeter.url}/`);
    assert.equal(uiRes.status, 200);
    const uiHtml = await uiRes.text();
    const scriptMatch = uiHtml.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch, "Expected inline script in workbench HTML");
    assert.ok(!scriptMatch[1].includes("</"), "Disallowed </ inside inline script");
    new Function(scriptMatch[1]);
    console.log("1. PASS Warm Paper Audit UI HTML + inline JS syntax valid");

    // 2. Unauthenticated egress call must fail closed (401)
    const unauthRes = await fetch(
      `${perimeter.url}/egress/quickbooks/v3/company/acme/reports/AgedReceivables`,
    );
    assert.equal(unauthRes.status, 401);
    console.log("2. PASS Unauthenticated egress request rejected (HTTP 401)");

    // 3. Forbidden DELETE method must be blocked by perimeter ACL (403) before touching QBO
    const reqCountBeforeDelete = qbo.requests.length;
    const deniedRes = await fetch(
      `${perimeter.url}/egress/quickbooks/v3/company/acme/invoice/1042`,
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${habitatToken}`,
          "x-trace-id": "tr-acl-test",
          "x-habitat-id": "quickbooks-ops",
          "x-speaker-id": "adversary",
        },
      },
    );
    assert.equal(deniedRes.status, 403);
    assert.equal(
      qbo.requests.length,
      reqCountBeforeDelete,
      "Forbidden DELETE must never reach upstream QuickBooks",
    );
    console.log("3. PASS Destructive DELETE blocked at perimeter ACL (HTTP 403, 0 upstream hits)");

    // 4. Secret scrubber must redact upstream secret echo
    const echoRes = await fetch(
      `${perimeter.url}/egress/quickbooks/v3/company/acme/echo-auth`,
      {
        headers: {
          authorization: `Bearer ${habitatToken}`,
          "x-trace-id": "tr-scrub-test",
          "x-habitat-id": "quickbooks-ops",
          "x-speaker-id": "cfo@acme.example",
        },
      },
    );
    assert.equal(echoRes.status, 200);
    const echoText = await echoRes.text();
    assert.ok(!echoText.includes(intuitSecret), "Raw Intuit secret leaked past scrubber!");
    assert.ok(echoText.includes("[REDACTED_VAULT_SECRET]"), "Expected redaction marker");
    console.log("4. PASS Secret scrubber redacted upstream echoed token");

    // 5. Forward proxy allowlist rejects arbitrary non-allowlisted internet host
    const fwdDenied = await fetch(`${perimeter.url}/forward-check`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${habitatToken}`,
        "x-trace-id": "tr-fwd-test",
        "x-habitat-id": "quickbooks-ops",
        "x-speaker-id": "cfo@acme.example",
      },
      body: JSON.stringify({ targetUrl: "https://exfiltrate.invalid/steal", method: "POST" }),
    });
    assert.equal(fwdDenied.status, 403);
    console.log("5. PASS Forward proxy allowlist blocked non-approved host (HTTP 403)");

    // 6. Full traced ask: Zero-secret Habitat -> Perimeter LLM (Mycel) -> Perimeter QBO Tool -> Mycel Synthesis
    const traceId = "tr-qbo-run-1";
    const askRes = await fetch(`${perimeter.url}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        traceId,
        speakerId: "cfo@acme.example",
        prompt: "What are our overdue receivables in QuickBooks right now?",
      }),
    });
    assert.equal(askRes.status, 200);
    const askBody = (await askRes.json()) as { traceId: string; text: string };
    assert.ok(
      askBody.text.includes("$24,450"),
      `Expected synthesized QBO total in answer, got: ${askBody.text}`,
    );
    assert.ok(!askBody.text.includes(intuitSecret), "Secret found in assistant answer!");
    console.log(`6. PASS Multi-turn traced QBO answer -> "${askBody.text}"`);

    // 7. Inspect traces.jsonl for correlated traceId spans + Mycel micro-dollars + zero leaked secrets
    const rawTraces = await readFile(perimeter.tracesFile, "utf8");
    assert.ok(!rawTraces.includes(intuitSecret), "Traces file must never store upstream secret values");
    const spans = rawTraces
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as AuditSpan);
    const runSpans = spans.filter((s) => s.traceId === traceId);
    const llmSpans = runSpans.filter((s) => s.kind === "llm.completion");
    const httpSpans = runSpans.filter((s) => s.kind === "http.egress");
    const inboundSpans = runSpans.filter((s) => s.kind === "a2a.inbound");

    assert.ok(llmSpans.length >= 2, `Expected >=2 LLM spans for tool turn + answer, got ${llmSpans.length}`);
    assert.ok(httpSpans.length >= 1, "Expected >=1 QuickBooks HTTP egress span");
    assert.equal(inboundSpans.length, 1, "Expected 1 inbound trace root span");
    assert.ok(
      llmSpans.every((s) => (s.chargeMicroDollars ?? 0) > 0),
      "Expected positive integer Mycel micro-dollar charges on LLM spans",
    );
    console.log(
      `7. PASS Audit ledger correlated ${runSpans.length} spans under ${traceId} ` +
        `(${llmSpans.length} Mycel LLM + ${httpSpans.length} QuickBooks HTTP + ${inboundSpans.length} inbound)`,
    );
    console.log("\nALL CLIENT ENVIRONMENT CHECKS PASSED.");
  } finally {
    await runtime.close();
    await perimeter.close();
    await supplier.close();
    await qbo.close();
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("\nClient Environment demo failed:", err);
  process.exit(1);
});
