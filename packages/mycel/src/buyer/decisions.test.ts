import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../store/memory-store.js";
import { supplierFixture } from "../store/conformance.js";
import { Operator } from "../operator.js";
import { createExchangeServer, type RunningExchange } from "../server.js";
import { createCatalogue } from "../customer/catalogue.js";
import { DEFAULT_PRICING } from "../types.js";
import { createHttpTransport } from "./transport.js";

const model = "typesafe/jev-1.13";
const questions = {
  bug: { type: "noul", instructions: "Is it broken?" },
  team: {
    type: "choice",
    instructions: "Which team?",
    criteria: { ui: "Rendering", pay: "Billing" },
  },
  urgency: {
    type: "score",
    instructions: "How urgent?",
    criteria: ["Later", "Now"],
  },
};
const request = { model, state: "Checkout is blank", questions };
const result = {
  model,
  answers: {
    bug: { type: "noul", noul: 0.97 },
    team: {
      type: "choice",
      choice: "pay",
      confidence: 0.81,
      probabilities: { ui: 0.19, pay: 0.81 },
    },
    urgency: {
      type: "score",
      score: 0.73,
      probabilities: { "0": 0.27, "1": 0.73 },
      legend: { "0": "Later", "1": "Now" },
    },
  },
  usage: { input_tokens: 476, output_tokens: 70, cost: 0.000019992 },
};
const pricing = {
  ...DEFAULT_PRICING,
  operationPricing: {
    decisions: {
      inputUnit: "token" as const,
      outputUnit: "token" as const,
      wholesaleInputPerMillion: 2_000_000,
      wholesaleOutputPerMillion: 7_000_000,
      retailInputPerMillion: 3_000_000,
      retailOutputPerMillion: 11_000_000,
    },
  },
};

describe("Decisions serving path", () => {
  let store: MemoryStore;
  let exchange: RunningExchange;
  let credential: string;
  let upstream: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(async () => {
    store = new MemoryStore();
    await store.createSupplier(
      supplierFixture({
        id: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1/",
        upstreamCredentialEnv: "TEST_KEY",
      }),
    );
    await store.saveAdminOffer(
      "openrouter",
      { model, capabilities: ["decisions"], servingMode: "adapted" },
      pricing,
      true,
      new Date(),
    );
    const operator = new Operator(store);
    await operator.createClient("focus", "The Focus AI");
    credential = (
      await operator.createApplication({
        id: "umwelten-internal",
        clientId: "focus",
      })
    ).credential!;
    await operator.grantToClient("focus", 10_000);
    upstream = vi.fn<typeof fetch>(async () => Response.json(result));
    exchange = await createExchangeServer({
      store,
      host: "127.0.0.1",
      port: 0,
      resolveTransport: createHttpTransport({
        fetchImpl: upstream,
        readCredential: () => "upstream-test-key",
      }),
    });
  });
  afterEach(async () => exchange.close());
  const post = (
    body: unknown = request,
    token = credential,
    path = "/v1/decisions",
  ) =>
    fetch(exchange.url + path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "x-mycel-end-user": "synthetic",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

  it("preserves all typed answers and usage, routes alpha, meters independently and debits once", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(JSON.parse(init!.body as string)).toEqual(request);
    expect(init!.headers).toMatchObject({
      authorization: "Bearer upstream-test-key",
      "idempotency-key": response.headers.get("x-mycel-request-id"),
    });
    const records = await store.listRequests();
    expect(records).toHaveLength(1);
    // Independently counted serialized fixture sizes: input 279 and answers 241 characters.
    expect(records[0]).toMatchObject({
      operation: "decisions",
      outcome: "completed",
      applicationId: "umwelten-internal",
      subject: "synthetic",
      inputUnits: 70,
      outputUnits: 61,
      promptTokens: 70,
      completionTokens: 61,
      upstreamPromptTokens: 476,
      upstreamCompletionTokens: 70,
      cost: 567,
      charge: 881,
    });
    const entries = (await store.listLedgerEntries("client", "focus")).filter(
      (entry) => entry.requestId,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].microDollars).toBe(-881);
    expect((await store.getBalance("client", "focus")).microDollars).toBe(9119);
  });

  it.each(["transport", "http", "body", "usage", "answers"])(
    "records %s failure once without a charge",
    async (failure) => {
      upstream.mockImplementation(async () => {
        if (failure === "transport") throw new Error("offline");
        if (failure === "http")
          return Response.json({ error: "busy" }, { status: 429 });
        if (failure === "body")
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error("dropped"));
              },
            }),
          );
        return Response.json({
          ...result,
          ...(failure === "usage"
            ? { usage: { input_tokens: -1, output_tokens: 70 } }
            : { answers: {} }),
        });
      });
      expect((await post()).status).toBe(failure === "http" ? 429 : 502);
      expect(upstream).toHaveBeenCalledTimes(1);
      expect(await store.listRequests()).toMatchObject([
        { operation: "decisions", outcome: "supply-failed", charge: 0 },
      ]);
      expect((await store.getBalance("client", "focus")).microDollars).toBe(
        10_000,
      );
    },
  );

  it("requires real authentication and credit before dispatch", async () => {
    expect((await post(request, "invalid")).status).toBe(401);
    await new Operator(store).grantToApplication("umwelten-internal", 1);
    expect((await post()).status).toBe(402);
    expect(upstream).not.toHaveBeenCalled();
    expect(await store.listRequests()).toEqual([]);
  });

  it("rejects malformed questions, streaming and chat dispatch", async () => {
    expect(
      (await post({ ...request, questions: { bad: { type: "boolean" } } }))
        .status,
    ).toBe(400);
    expect((await post({ ...request, stream: true })).status).toBe(400);
    expect(
      (
        await post(
          { model, messages: [{ role: "user", content: "hello" }] },
          credential,
          "/v1/chat/completions",
        )
      ).status,
    ).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("requires explicit Decisions pricing and honors application restrictions", async () => {
    await store.setOfferPricing("openrouter", model, {
      ...DEFAULT_PRICING,
      operationPricing: {},
    });
    expect((await post()).status).toBe(503);
    await store.setOfferPricing("openrouter", model, pricing);
    const app = (await store.getApplication("umwelten-internal"))!;
    await store.createApplication({ ...app, allowedModels: ["another-model"] });
    expect((await post()).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("probes Decisions before publication and preserves the offer across chat sync", async () => {
    upstream.mockResolvedValue(
      Response.json({
        answers: { ok: { type: "noul", noul: 0.99 } },
        usage: { input_tokens: 12, output_tokens: 5 },
      }),
    );
    const catalogue = createCatalogue(store, {
      fetch: upstream,
      readCredential: () => "upstream-test-key",
    });
    await catalogue.save({
      supplierId: "openrouter",
      model,
      operations: ["decisions"],
      pricing,
      enabled: true,
      confirmPaidProbe: true,
    });
    expect(upstream.mock.calls[0][0]).toBe(
      "https://openrouter.ai/api/alpha/decisions",
    );
    await store.replaceOffers("openrouter", [
      { model: "chat-only", capabilities: ["chat"], servingMode: "adapted" },
    ]);
    expect(await store.getOffer("openrouter", model)).toMatchObject({
      capabilities: ["decisions"],
      adminManaged: true,
      enabled: true,
      operationPricing: pricing.operationPricing,
    });
    upstream.mockResolvedValue(
      Response.json({ choices: [{ message: { content: "OK" } }] }),
    );
    await expect(
      catalogue.save({
        supplierId: "openrouter",
        model: "unverified",
        operations: ["decisions"],
        pricing,
        enabled: true,
        confirmPaidProbe: true,
      }),
    ).rejects.toThrow("verification_failed:decisions");
    expect(await store.getOffer("openrouter", "unverified")).toBeNull();
  });
});
