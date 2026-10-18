import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../store/memory-store.js";
import { offerFixture, supplierFixture } from "../store/conformance.js";
import { DEFAULT_PRICING } from "../types.js";
import { createCatalogue } from "./catalogue.js";
import { createCustomerHandler } from "./handler.js";

const modelId = "whisper/large-v3";
const input = () => ({
  supplierId: "vendor",
  model: modelId,
  operations: ["transcription"],
  enabled: true,
  pricing: {
    ...DEFAULT_PRICING,
    operationPricing: {
      transcription: {
        inputUnit: "second",
        outputUnit: "token",
        wholesaleInputPerMillion: 100000000,
        wholesaleOutputPerMillion: 17,
        retailInputPerMillion: 130000000,
        retailOutputPerMillion: 29,
      },
    },
  },
});
const checkBody = (model = modelId) => ({
  supplierId: "vendor",
  model,
  confirmPaidProbe: true,
});
const chatPass = () =>
  Response.json({ choices: [{ message: { content: "OK" } }] });
const decisionsPass = () =>
  Response.json({
    model: modelId,
    answers: { ok: { type: "noul", noul: 0.99 } },
    usage: { input_tokens: 1, output_tokens: 1 },
  });

describe("admin catalogue", () => {
  let store: MemoryStore;
  let server: http.Server;
  let origin: string;
  let upstream: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(async () => {
    store = new MemoryStore();
    await store.createSupplier(
      supplierFixture({
        id: "vendor",
        baseUrl: "https://trusted.example/v1",
        upstreamCredentialEnv: undefined,
      }),
    );
    upstream = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    const handler = createCustomerHandler({
      store,
      fetch: upstream,
      verifyOperator: async (authorization) => {
        if (!authorization) throw new Error();
        return {
          subject: "subject",
          role: authorization === "Bearer admin" ? "admin" : "member",
        };
      },
    });
    server = http.createServer(async (req, res) => {
      if (!(await handler(req, res))) res.writeHead(404).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/customer/admin/catalogue`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const request = (
    path: string,
    body?: unknown,
    role: string | null = "admin",
  ) =>
    fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        ...(role ? { authorization: `Bearer ${role}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  function route(match: Record<string, () => Response>) {
    upstream.mockImplementation(async (url) => {
      const href = String(url);
      for (const [suffix, respond] of Object.entries(match)) {
        if (href.endsWith(suffix)) return respond();
      }
      return new Response(null, { status: 404 });
    });
  }

  it.each([null, "member"])(
    "rejects %s on every catalogue route before probing or mutating",
    async (role) => {
      for (const [path, body] of [
        ["", undefined],
        ["/models?supplierId=vendor", undefined],
        ["/check", checkBody()],
        ["/save", input()],
        ["/enabled", { supplierId: "vendor", enabled: false }],
        ["/connect", { preset: "openai" }],
      ] as const) {
        expect((await request(path, body, role)).status).toBe(role ? 403 : 401);
      }
      expect(upstream).not.toHaveBeenCalled();
      expect(await store.listOffers()).toEqual([]);
      expect((await store.getSupplier("vendor"))?.enabled).toBe(true);
    },
  );

  it("lists only upstream model IDs/names without publishing or probing", async () => {
    upstream.mockResolvedValueOnce(Response.json({ data: [
      { id: "z/model", name: "Z model", pricing: { secret: "omit" } },
      { id: "a/model" }, { id: "z/model", name: "Z model" },
      { id: "" }, null, { name: "missing id" },
    ] }));
    const response = await request("/models?supplierId=vendor");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: [
      { id: "a/model", name: "a/model" }, { id: "z/model", name: "Z model" },
    ] });
    expect(upstream).toHaveBeenCalledExactlyOnceWith("https://trusted.example/v1/models", {
      headers: {}, redirect: "error", signal: expect.any(AbortSignal),
    });
    expect(await store.listOffers()).toEqual([]);
  });

  it("names every operation, including Decisions, on the catalogue list", async () => {
    const response = await request("");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.labels.decisions).toBe("Decisions");
    for (const operation of body.operations) {
      expect(body.labels[operation]).toEqual(expect.any(String));
      expect(body.labels[operation]).not.toBe("undefined");
      expect(body.labels[operation].length).toBeGreaterThan(0);
    }
  });

  it("keeps discovery credentials server-side and rejects missing suppliers", async () => {
    await store.createSupplier(supplierFixture({ id: "keyed", baseUrl: "https://trusted.example/v1/", upstreamCredentialEnv: "TEST_KEY" }));
    const catalogue = createCatalogue(store, { fetch: upstream, readCredential: () => "test-secret" });
    upstream.mockResolvedValueOnce(Response.json({ data: [] }));
    expect(await catalogue.models("keyed")).toEqual({ models: [] });
    expect(upstream.mock.calls[0][1]?.headers).toEqual({ authorization: "Bearer test-secret" });
    upstream.mockClear();
    expect((await request("/models?supplierId=missing")).status).toBe(404);
    expect((await request("/models")).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([Response.json({ error: "private upstream detail" }, { status: 500 }), Response.json({ invalid: [] })])(
    "reports discovery failure without upstream details", async (result) => {
      upstream.mockResolvedValueOnce(result);
      const response = await request("/models?supplierId=vendor");
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "upstream_catalogue_unavailable" });
    },
  );

  it("checks every operation, then saves a subset without probing again", async () => {
    route({
      "/chat/completions": chatPass,
      "/decisions": decisionsPass,
    });
    const checked = await request("/check", checkBody("mixed"));
    expect(checked.status).toBe(200);
    expect(upstream.mock.calls.map(([url]) => String(url))).toEqual([
      "https://trusted.example/v1/chat/completions",
      "https://trusted.example/v1/embeddings",
      "https://trusted.example/v1/decisions",
      "https://trusted.example/v1/audio/transcriptions",
      "https://trusted.example/v1/images/generations",
      "https://trusted.example/v1/videos/generations",
    ]);
    const [chatUrl, chatInit] = upstream.mock.calls[0];
    expect(chatUrl).toBe("https://trusted.example/v1/chat/completions");
    expect(chatInit).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(String(chatInit?.body))).toEqual({
      model: "mixed",
      max_tokens: 8,
      messages: [{ role: "user", content: "Say OK." }],
    });
    const decisionsCall = upstream.mock.calls[2];
    expect(JSON.parse(String(decisionsCall[1]?.body))).toEqual({
      model: "mixed",
      state: "OK",
      questions: { ok: { type: "noul", instructions: "Does the state say OK?" } },
    });
    const body = await checked.json();
    expect(body.labels.decisions).toBe("Decisions");
    expect(body.findings.find((finding: { operation: string }) => finding.operation === "decisions")).toMatchObject({
      judgment: "pass",
      label: "Decisions",
      summary: "Supported.",
    });
    expect(body.findings.map((finding: { label: string }) => finding.label)).not.toContain("undefined");
    const recorded = await store.getOffer("vendor", "mixed");
    expect(recorded).toMatchObject({
      capabilities: ["chat", "decisions"],
      enabled: false,
      servingMode: "adapted",
      adminManaged: true,
      wholesalePromptPerMillion: 0,
      retailPromptPerMillion: 100_000,
      retailCompletionPerMillion: 400_000,
    });
    expect(recorded?.operationPricing?.embeddings).toBeUndefined();
    expect(recorded?.operationPricing?.decisions).toMatchObject({
      inputUnit: "token",
      outputUnit: "token",
      wholesaleInputPerMillion: 0,
      wholesaleOutputPerMillion: 0,
      retailInputPerMillion: 100_000,
      retailOutputPerMillion: 400_000,
    });
    const verifiedAt = recorded?.verifiedAt;
    upstream.mockClear();
    const saved = await request("/save", {
      supplierId: "vendor",
      model: "mixed",
      operations: ["chat"],
      enabled: true,
      pricing: { ...DEFAULT_PRICING, operationPricing: {} },
    });
    expect(saved.status).toBe(200);
    expect(upstream).not.toHaveBeenCalled();
    const shrunk = await store.getOffer("vendor", "mixed");
    expect(shrunk?.capabilities).toEqual(["chat"]);
    expect(shrunk?.verifiedAt).toEqual(verifiedAt);
    const again = await request("/save", {
      supplierId: "vendor",
      model: "mixed",
      operations: ["chat"],
      enabled: true,
      pricing: { ...DEFAULT_PRICING, operationPricing: {} },
    });
    expect(again.status).toBe(200);
    expect((await store.getOffer("vendor", "mixed"))?.verifiedAt).toEqual(verifiedAt);
    const rejected = await request("/save", {
      supplierId: "vendor",
      model: "mixed",
      operations: ["chat", "embeddings"],
      enabled: true,
      pricing: {
        ...DEFAULT_PRICING,
        operationPricing: {
          embeddings: {
            inputUnit: "token",
            outputUnit: "token",
            wholesaleInputPerMillion: 0,
            wholesaleOutputPerMillion: 0,
            retailInputPerMillion: 100_000,
            retailOutputPerMillion: 400_000,
          },
        },
      },
    });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({ error: "not_a_checked_capability" });
    expect((await store.getOffer("vendor", "mixed"))?.capabilities).toEqual(["chat"]);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("keeps stored prices when a recheck confirms or shrinks, and disables when it grows", async () => {
    route({
      "/chat/completions": chatPass,
      "/decisions": decisionsPass,
    });
    expect((await request("/check", checkBody("priced"))).status).toBe(200);
    const custom = {
      wholesalePromptPerMillion: 5,
      wholesaleCompletionPerMillion: 7,
      retailPromptPerMillion: 11,
      retailCompletionPerMillion: 13,
      operationPricing: {
        decisions: {
          inputUnit: "token",
          outputUnit: "token",
          wholesaleInputPerMillion: 3,
          wholesaleOutputPerMillion: 4,
          retailInputPerMillion: 8,
          retailOutputPerMillion: 9,
        },
      },
    };
    const saved = await request("/save", {
      supplierId: "vendor",
      model: "priced",
      operations: ["decisions", "chat"],
      enabled: true,
      pricing: custom,
    });
    expect(saved.status).toBe(200);
    const priced = await store.getOffer("vendor", "priced");
    expect(priced?.capabilities).toEqual(["chat", "decisions"]);
    expect(priced).toMatchObject({
      enabled: true,
      wholesalePromptPerMillion: 5,
      operationPricing: custom.operationPricing,
    });
    const verifiedAt = priced?.verifiedAt;
    upstream.mockClear();
    route({ "/chat/completions": chatPass });
    expect((await request("/check", checkBody("priced"))).status).toBe(200);
    const shrunk = await store.getOffer("vendor", "priced");
    expect(shrunk).toMatchObject({
      capabilities: ["chat"],
      enabled: true,
      wholesalePromptPerMillion: 5,
      wholesaleCompletionPerMillion: 7,
      retailPromptPerMillion: 11,
      retailCompletionPerMillion: 13,
    });
    expect(shrunk?.operationPricing?.decisions).toBeUndefined();
    expect(shrunk?.verifiedAt).not.toEqual(verifiedAt);
    route({
      "/chat/completions": chatPass,
      "/embeddings": () => Response.json({ data: [{ embedding: [0.2, -0.7] }] }),
    });
    expect((await request("/check", checkBody("priced"))).status).toBe(200);
    const grown = await store.getOffer("vendor", "priced");
    expect(grown).toMatchObject({
      capabilities: ["chat", "embeddings"],
      enabled: false,
      wholesalePromptPerMillion: 5,
      retailCompletionPerMillion: 13,
    });
    expect(grown?.operationPricing?.embeddings).toMatchObject({
      inputUnit: "token",
      outputUnit: "token",
      wholesaleInputPerMillion: 0,
      wholesaleOutputPerMillion: 0,
      retailInputPerMillion: 100_000,
      retailOutputPerMillion: 400_000,
    });
  });

  it("verifies multipart STT, uses seconds pricing, preserves other models and survives a new handler", async () => {
    await store.replaceOffers("vendor", [offerFixture({ model: "other" })]);
    route({
      "/audio/transcriptions": () => Response.json({ text: "", duration: 1 }),
    });
    const checked = await request("/check", checkBody());
    expect(checked.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(6);
    const transcription = upstream.mock.calls.find(([url]) =>
      String(url).endsWith("/audio/transcriptions"),
    );
    expect(transcription?.[0]).toBe(
      "https://trusted.example/v1/audio/transcriptions",
    );
    const init = transcription?.[1];
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const form = init?.body as FormData;
    expect(form.get("model")).toBe(modelId);
    expect((form.get("file") as File).type).toBe("audio/wav");
    expect((form.get("file") as File).size).toBe(16044);
    upstream.mockClear();
    const response = await request("/save", input());
    expect(response.status).toBe(200);
    expect(upstream).not.toHaveBeenCalled();
    await store.replaceOffers("vendor", []);
    const catalogue = createCatalogue(store, { fetch: upstream });
    const offer = (await catalogue.list()).suppliers[0].offers[0];
    expect(offer).toMatchObject({
      model: modelId,
      capabilities: ["transcription"],
      adminManaged: true,
      availability: "transcription: eligible",
      operationPricing: input().pricing.operationPricing,
    });
    expect(offer.verifiedAt).toBeInstanceOf(Date);
    const initial = await response.json();
    expect(
      initial.suppliers[0].offers.map((o: { model: string }) => o.model),
    ).toEqual(["other", modelId]);
    const serialized = JSON.stringify(initial);
    expect(serialized).not.toContain("hash-office");
    expect(serialized).not.toContain("trusted.example");
    await request("/enabled", {
      supplierId: "vendor",
      model: modelId,
      enabled: false,
    });
    await store.replaceOffers("vendor", [
      offerFixture({ model: modelId }),
    ]);
    expect((await catalogue.list()).suppliers[0].offers[0].availability).toBe(
      "transcription: offer-disabled",
    );
  });

  it.each([
    null,
    [],
    { ...input(), operations: [] },
    { ...input(), operations: ["speech"] },
    { ...input(), operations: ["chat", "chat"] },
    { ...input(), model: "bad\u0000model" },
    { ...input(), enabled: "true" },
    { ...input(), confirmPaidProbe: false },
    { ...input(), confirmPaidProbe: true },
    { ...input(), baseUrl: "https://attacker.example" },
    { ...input(), pricing: { ...input().pricing, retailPromptPerMillion: -1 } },
    {
      ...input(),
      pricing: { ...input().pricing, retailPromptPerMillion: 0.5 },
    },
    {
      ...input(),
      pricing: {
        ...input().pricing,
        retailPromptPerMillion: Number.MAX_SAFE_INTEGER + 1,
      },
    },
    { ...input(), pricing: { ...input().pricing, operationPricing: {} } },
    {
      ...input(),
      pricing: {
        ...input().pricing,
        operationPricing: {
          transcription: {
            ...input().pricing.operationPricing.transcription,
            inputUnit: "byte",
          },
        },
      },
    },
  ])(
    "rejects invalid catalogue values before any upstream request: %j",
    async (body) => {
      expect((await request("/save", body)).status).toBe(400);
      expect(upstream).not.toHaveBeenCalled();
      expect(await store.listOffers()).toEqual([]);
    },
  );

  it("requires confirmPaidProbe on check and rejects it on save", async () => {
    expect(
      (await request("/check", { supplierId: "vendor", model: modelId })).status,
    ).toBe(400);
    expect(
      (await request("/check", { ...checkBody(), confirmPaidProbe: false })).status,
    ).toBe(400);
    expect((await request("/check", { ...checkBody(), operations: ["chat"] })).status).toBe(400);
    expect((await request("/save", { ...input(), confirmPaidProbe: true })).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    expect(await store.listOffers()).toEqual([]);
  });

  it("does not probe on save, and refuses a missing or publisher-owned offer", async () => {
    const missing = await request("/save", input());
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "offer_not_found" });
    await store.replaceOffers("vendor", [offerFixture({ model: modelId })]);
    const published = await request("/save", input());
    expect(published.status).toBe(409);
    expect(await published.json()).toEqual({ error: "probe_before_publishing" });
    expect(upstream).not.toHaveBeenCalled();
    expect((await store.getOffer("vendor", modelId))?.adminManaged).toBeFalsy();
  });

  it.each([
    { text: "hello" },
    { text: "hello", duration: 0 },
    { text: "hello", duration: -1 },
    { duration: 1 },
    { text: "hello", duration: "NaN" },
  ])("does not store transcription for an off-contract STT response %j", async (body) => {
    route({
      "/audio/transcriptions": () => Response.json(body),
    });
    const response = await request("/check", checkBody());
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(
      payload.findings.find((finding: { operation: string }) => finding.operation === "transcription"),
    ).toMatchObject({ judgment: "contract", summary: "Not supported." });
    expect((await store.getOffer("vendor", modelId))?.capabilities).toEqual([]);
  });

  it("leaves the stored offer unchanged when a later operation has no result", async () => {
    const verifiedAt = new Date("2026-03-01T00:00:00.000Z");
    await store.saveAdminOffer(
      "vendor",
      { model: "kept", capabilities: ["chat"], servingMode: "adapted" },
      { ...DEFAULT_PRICING, wholesalePromptPerMillion: 17 },
      true,
      verifiedAt,
    );
    const before = JSON.parse(JSON.stringify(await store.getOffer("vendor", "kept")));
    route({
      "/chat/completions": chatPass,
      "/embeddings": () => new Response(null, { status: 500 }),
    });
    const response = await request("/check", checkBody("kept"));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "upstream_unobserved" });
    expect(upstream).toHaveBeenCalledTimes(6);
    expect(JSON.parse(JSON.stringify(await store.getOffer("vendor", "kept")))).toEqual(before);
  });

  it("writes nothing when every operation is unobserved", async () => {
    upstream.mockImplementation(async () => new Response(null, { status: 500 }));
    const response = await request("/check", checkBody());
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "upstream_unobserved" });
    expect(upstream).toHaveBeenCalledTimes(6);
    expect(await store.listOffers()).toEqual([]);
  });

  it("stops on the first rejected credential and does not call that row unsupported", async () => {
    upstream.mockImplementation(async () => new Response(null, { status: 401 }));
    const response = await request("/check", checkBody());
    expect(response.status).toBe(422);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(await store.listOffers()).toEqual([]);
    const body = await response.json();
    expect(body.error).toBe("upstream_unauthorized");
    expect(body.findings).toHaveLength(6);
    expect(body.findings[0]).toMatchObject({
      operation: "chat",
      judgment: "auth",
      summary: "Credential rejected. That does not mean the model lacks this operation.",
    });
    expect(body.findings[0].summary).not.toBe("Not supported.");
    expect(body.findings.slice(1).every((finding: { judgment: string }) => finding.judgment === "not-run")).toBe(true);
  });

  it("records an earlier pass when a later operation returns 401", async () => {
    route({
      "/chat/completions": chatPass,
      "/embeddings": () => new Response(null, { status: 401 }),
    });
    const response = await request("/check", checkBody("scoped"));
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect((await store.getOffer("vendor", "scoped"))?.capabilities).toEqual(["chat"]);
    const body = await response.json();
    expect(body.findings.find((finding: { operation: string }) => finding.operation === "embeddings")).toMatchObject({
      judgment: "auth",
    });
    expect(body.findings.filter((finding: { judgment: string }) => finding.judgment === "not-run")).toHaveLength(4);
  });

  it("records chat when image generation is refused", async () => {
    route({
      "/chat/completions": chatPass,
      "/images/generations": () => new Response(null, { status: 403 }),
    });
    const response = await request("/check", checkBody("images"));
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(6);
    expect((await store.getOffer("vendor", "images"))?.capabilities).toEqual(["chat"]);
    const body = await response.json();
    expect(
      body.findings.find((finding: { operation: string }) => finding.operation === "image-generation"),
    ).toMatchObject({
      judgment: "rejected",
      summary: "The upstream refused this operation. That does not mean the model lacks it.",
    });
  });

  it("records an empty capability list when every completed check misses", async () => {
    route({
      "/images/generations": () => new Response(null, { status: 403 }),
    });
    const response = await request("/check", checkBody("empty"));
    expect(response.status).toBe(200);
    expect((await store.getOffer("vendor", "empty"))?.capabilities).toEqual([]);
    expect((await store.getOffer("vendor", "empty"))?.enabled).toBe(false);
  });

  it("never exposes upstream errors or binds secrets to caller-controlled destinations", async () => {
    const catalogue = createCatalogue(store, {
      readCredential: () => "server-secret",
      fetch: upstream,
    });
    await expect(
      catalogue.connect({
        preset: "openai",
        baseUrl: "https://attacker.example",
        upstreamCredentialEnv: "DATABASE_URL",
      }),
    ).rejects.toMatchObject({ status: 400 });
    await catalogue.connect({ preset: "openai" });
    const registered = await store.getSupplier("openai");
    expect(registered?.baseUrl).toBe("https://api.openai.com/v1");
    expect(registered?.upstreamCredentialEnv).toBe("OPENAI_API_KEY");
    await expect(catalogue.connect({ preset: "openai" })).rejects.toMatchObject(
      { status: 409 },
    );
    expect((await store.getSupplier("openai"))?.credentialHash).toBe(
      registered?.credentialHash,
    );
    upstream.mockRejectedValue(new Error("server-secret provider error"));
    const response = await request("/check", checkBody());
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain("server-secret");
    expect(await store.listOffers()).toEqual([]);
    expect(JSON.stringify(await catalogue.list())).not.toContain(
      "server-secret",
    );
  });

  it("rejects missing credentials and agent capability claims", async () => {
    const catalogue = createCatalogue(store, {
      readCredential: () => undefined,
      fetch: upstream,
    });
    await expect(catalogue.connect({ preset: "groq" })).rejects.toMatchObject({
      status: 409,
    });
    delete process.env.CATALOGUE_TEST_MISSING_KEY;
    await store.createSupplier(
      supplierFixture({
        id: "vendor",
        upstreamCredentialEnv: "CATALOGUE_TEST_MISSING_KEY",
      }),
    );
    const missingKey = await request("/check", checkBody());
    expect(missingKey.status).toBe(409);
    expect(await missingKey.json()).toEqual({ error: "credential_not_configured" });
    await store.createSupplier(
      supplierFixture({ id: "vendor", kind: "agent" }),
    );
    const checked = await request("/check", checkBody());
    expect(checked.status).toBe(409);
    expect(await checked.json()).toEqual({
      error: "agent_capabilities_are_published_by_agent",
    });
    const saved = await request("/save", input());
    expect(saved.status).toBe(409);
    expect(await saved.json()).toEqual({
      error: "agent_capabilities_are_published_by_agent",
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("requires the actual embedding contract, not any successful JSON", async () => {
    route({
      "/embeddings": () => Response.json({ data: [{ embedding: [] }] }),
    });
    const missed = await request("/check", checkBody());
    expect(missed.status).toBe(200);
    const missedBody = await missed.json();
    expect(
      missedBody.findings.find(
        (finding: { operation: string }) => finding.operation === "embeddings",
      ).judgment,
    ).toBe("contract");
    expect((await store.getOffer("vendor", modelId))?.capabilities).not.toContain("embeddings");
    route({
      "/embeddings": () => Response.json({ data: [{ embedding: [0.2, -0.7] }] }),
    });
    expect((await request("/check", checkBody())).status).toBe(200);
    expect((await store.getOffer("vendor", modelId))?.capabilities).toEqual([
      "embeddings",
    ]);
  });

  it.each([
    ["chat", "/chat/completions", { choices: [{ message: { content: "OK" } }] }],
    ["image-generation", "/images/generations", { data: [{ b64_json: "aW1hZ2U=" }] }],
    ["video-generation", "/videos/generations", { video: { base64: "dmlkZW8=" } }],
  ] as const)(
    "requires usable output, not an asynchronous job ID, for %s",
    async (operation, path, valid) => {
      const queued = { video: { id: "queued" }, data: [{ id: "queued" }] };
      route({ [path]: () => Response.json(queued) });
      const missed = await request("/check", checkBody());
      expect(missed.status).toBe(200);
      const missedBody = await missed.json();
      expect(
        missedBody.findings.find((finding: { operation: string }) => finding.operation === operation).judgment,
      ).toBe("contract");
      expect((await store.getOffer("vendor", modelId))?.capabilities ?? []).not.toContain(operation);
      route({ [path]: () => Response.json(valid) });
      expect((await request("/check", checkBody())).status).toBe(200);
      expect((await store.getOffer("vendor", modelId))?.capabilities).toEqual([operation]);
    },
  );
});
