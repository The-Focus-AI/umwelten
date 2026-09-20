#!/usr/bin/env node
/** A real local Exchange, a deliberately under-described Offer, and a switchable simulated supplier. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { MemoryStore } from "@umwelten/mycel/store/memory-store.js";
import { Operator } from "@umwelten/mycel/operator.js";
import {
  createExchangeServer,
  type RunningExchange,
} from "@umwelten/mycel/server.js";

const { values } = parseArgs({
  options: {
    step: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});
if (values.step && (values.json || !process.stdin.isTTY)) {
  throw new Error(
    "--step needs an interactive terminal and cannot be combined with --json",
  );
}

const model = "envelope-demo";
const body = {
  model,
  messages: [
    {
      role: "user",
      content: "Route ticket DEMO-42: Please refund my duplicate charge.",
    },
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "ticket_route",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          team: { type: "string", enum: ["billing", "engineering"] },
          ticket: { type: "string" },
        },
        required: ["team", "ticket"],
      },
    },
  },
  // Unknown to Mycel. This is a provider extension, not a routing instruction.
  demo_provider_extension: { receipt: "sealed-envelope-42" },
};
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12);
const expectedAnswer = { team: "billing", ticket: "DEMO-42" };
const supplierError = {
  error: {
    type: "unsupported_parameter",
    message: "This simulated upstream currently rejects response_format.",
  },
};
let acceptsSchema = true;
const received: unknown[] = [];
const supplier = http.createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString());
    received.push(input);
    if (!acceptsSchema) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify(supplierError));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-demo",
        object: "chat.completion",
        created: 1,
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify(expectedAnswer),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 37, completion_tokens: 12, total_tokens: 49 },
      }),
    );
  } catch {
    res.writeHead(400).end();
  }
});

async function main() {
  const terminal = values.step
    ? createInterface({ input: process.stdin, output: process.stdout })
    : undefined;
  const log = (text: string) => {
    if (!values.json) console.log(text);
  };
  const act = async (title: string) => {
    if (terminal) await terminal.question(`\nPress Enter for ${title}… `);
    log(`\n${title}`);
  };
  let exchange: RunningExchange | undefined;
  try {
    supplier.listen(0, "127.0.0.1");
    await once(supplier, "listening");
    const address = supplier.address();
    assert(address && typeof address === "object");
    const store = new MemoryStore();
    const operator = new Operator(store);
    await operator.registerSupplier({
      id: "demo-supplier",
      displayName: "Simulated supplier",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
    });
    await operator.publishOffersFor("demo-supplier", [
      { model, capabilities: ["chat"], servingMode: "adapted" },
    ]);
    await operator.createClient("demo-client", "Disposable demo client");
    const { credential } = await operator.createApplication({
      id: "demo-app",
      clientId: "demo-client",
    });
    assert(credential);
    await operator.grantToClient("demo-client", 1_000_000);
    exchange = await createExchangeServer({
      store,
      host: "127.0.0.1",
      port: 0,
    });
    const url = exchange.url;
    const catalog = async () =>
      (
        await fetch(`${url}/v1/models`, { signal: AbortSignal.timeout(5000) })
      ).json();
    const before = await catalog();
    assert.deepEqual(
      before.data.find((entry: { id: string }) => entry.id === model)
        .capabilities,
      ["chat"],
    );
    const send = (headers: Record<string, string> = {}) =>
      fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${credential}`,
          "x-mycel-end-user": "presenter",
          ...headers,
        },
        body: JSON.stringify(body),
      });

    log(
      "MYCEL / THE SEALED ENVELOPE\nReal Exchange + local HTTP supplier. Simulated answers. No API keys or paid calls.",
    );
    log(
      `Catalog: ${model} → [chat] (no structured-output flag)\nEnvelope: ${fingerprint(body)} — JSON schema + an unknown provider extension`,
    );
    const observations: {
      act: string;
      status: number;
      upstreamCalls: number;
      decisionBy: string;
    }[] = [];

    await act("1. Upstream accepts — catalog stays silent");
    const accepted = await send();
    assert.equal(
      accepted.status,
      200,
      "A missing catalog feature must not block forwarding",
    );
    const answer = await accepted.json();
    assert.deepEqual(
      JSON.parse(answer.choices[0].message.content),
      expectedAnswer,
    );
    assert.equal(received.length, 1);
    assert.deepEqual(
      received[0],
      body,
      "Every request field must reach the supplier unchanged",
    );
    const records = await store.listRequests();
    assert.equal(records.length, 1);
    assert.equal(records[0].outcome, "completed");
    const debits = (
      await store.listLedgerEntries("client", "demo-client")
    ).filter((entry) => entry.requestId === records[0].id);
    assert.equal(
      debits.length,
      1,
      "Exactly one debit for the successful request",
    );
    assert.equal(debits[0].microDollars, -records[0].charge);
    log(
      `HTTP 200 → ${JSON.stringify(expectedAnswer)}\nUpstream received envelope ${fingerprint(received[0])}; one request, one local ledger debit.`,
    );
    observations.push({
      act: "accept",
      status: accepted.status,
      upstreamCalls: 1,
      decisionBy: "upstream",
    });

    await act("2. Flip only the upstream — same envelope, same catalog");
    acceptsSchema = false;
    const rejected = await send();
    assert.equal(
      rejected.status,
      400,
      "Preserve the upstream rejection status, not a Mycel capability 503",
    );
    const failure = await rejected.json();
    assert.equal(failure.error, "upstream_error");
    assert.equal(failure.upstreamStatus, 400);
    assert.deepEqual(JSON.parse(failure.body), supplierError);
    assert.equal(received.length, 2);
    assert.deepEqual(received[1], body);
    log(
      `HTTP 400 → upstream_error / unsupported_parameter\nUpstream received the SAME envelope ${fingerprint(received[1])}. Mycel did not predict support.`,
    );
    observations.push({
      act: "reject",
      status: rejected.status,
      upstreamCalls: 1,
      decisionBy: "upstream",
    });

    await act(
      "3. Explicit routing constraint — this time the caller asks for a gate",
    );
    acceptsSchema = true;
    const constrained = await send({
      "x-exchange-require-capability": "structured-output",
    });
    assert.equal(constrained.status, 503);
    const blocked = await constrained.json();
    assert.equal(blocked.error, "no_eligible_offer");
    assert(
      blocked.considered.some(
        (offer: { reason: string }) => offer.reason === "missing-capability",
      ),
    );
    assert.equal(
      received.length,
      2,
      "Explicit constraint must reject before forwarding",
    );
    log(
      "HTTP 503 → no_eligible_offer\nZero new upstream calls. An explicit routing requirement is not a payload parameter.",
    );
    observations.push({
      act: "explicit-constraint",
      status: constrained.status,
      upstreamCalls: 0,
      decisionBy: "caller policy",
    });

    await act("4. No valid credential — pass-through is not an auth bypass");
    const unauthorized = await send({
      authorization: "Bearer invalid-demo-credential",
    });
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json()).error, "unauthorized");
    assert.equal(received.length, 2);
    assert.deepEqual(
      await catalog(),
      before,
      "Do not edit capability flags to manufacture a pass",
    );
    log(
      "HTTP 401 → unauthorized\nZero new upstream calls. Catalog unchanged across all four acts.",
    );
    observations.push({
      act: "unauthorized",
      status: unauthorized.status,
      upstreamCalls: 0,
      decisionBy: "authentication",
    });
    const result = {
      passed: true,
      simulatedSupplier: true,
      catalogUnchanged: true,
      envelope: fingerprint(body),
      observations,
    };
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else
      log(
        "\nPASS — the upstream decides parameter support; Mycel enforces access and explicit policy.",
      );
  } finally {
    terminal?.close();
    await exchange?.close();
    supplier.closeAllConnections();
    if (supplier.listening)
      await new Promise<void>((resolve, reject) =>
        supplier.close((error) => (error ? reject(error) : resolve())),
      );
  }
}

await main();
