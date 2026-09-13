import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../store/memory-store.js";
import { offerFixture, supplierFixture } from "../store/conformance.js";
import { DEFAULT_PRICING } from "../types.js";
import { createCatalogue } from "./catalogue.js";
import { createCustomerHandler } from "./handler.js";

const input = () => ({
  supplierId: "vendor",
  model: "whisper/large-v3",
  operations: ["transcription"],
  enabled: true,
  confirmPaidProbe: true,
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
    upstream = vi.fn<typeof fetch>(async () =>
      Response.json({ text: "", duration: 1 }),
    );
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

  it.each([null, "member"])(
    "rejects %s on every catalogue route before probing or mutating",
    async (role) => {
      for (const [path, body] of [
        ["", undefined],
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

  it("verifies multipart STT, uses seconds pricing, preserves other models and survives a new handler", async () => {
    await store.replaceOffers("vendor", [offerFixture({ model: "other" })]);
    const response = await request("/save", input());
    expect(response.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe("https://trusted.example/v1/audio/transcriptions");
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const form = init?.body as FormData;
    expect(form.get("model")).toBe("whisper/large-v3");
    expect((form.get("file") as File).type).toBe("audio/wav");
    expect((form.get("file") as File).size).toBe(16044);
    await store.replaceOffers("vendor", []);
    const catalogue = createCatalogue(store, { fetch: upstream });
    const offer = (await catalogue.list()).suppliers[0].offers[0];
    expect(offer).toMatchObject({
      model: "whisper/large-v3",
      capabilities: ["transcription"],
      adminManaged: true,
      availability: "transcription: eligible",
      operationPricing: input().pricing.operationPricing,
    });
    expect(offer.verifiedAt).toBeInstanceOf(Date);
    const initial = await response.json();
    expect(
      initial.suppliers[0].offers.map((o: { model: string }) => o.model),
    ).toEqual(["other", "whisper/large-v3"]);
    const serialized = JSON.stringify(initial);
    expect(serialized).not.toContain("hash-office");
    expect(serialized).not.toContain("trusted.example");
    await request("/enabled", {
      supplierId: "vendor",
      model: "whisper/large-v3",
      enabled: false,
    });
    await store.replaceOffers("vendor", [
      offerFixture({ model: "whisper/large-v3" }),
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

  it.each([
    { text: "hello" },
    { text: "hello", duration: 0 },
    { text: "hello", duration: -1 },
    { duration: 1 },
    { text: "hello", duration: "NaN" },
  ])("fails closed on invalid STT response %j", async (body) => {
    await store.replaceOffers("vendor", [
      offerFixture({ model: input().model }),
    ]);
    upstream.mockResolvedValueOnce(Response.json(body));
    const response = await request("/save", input());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "verification_failed:transcription",
    });
    expect(
      (await store.getOffer("vendor", input().model))?.capabilities,
    ).toEqual(["chat", "streaming", "tool-calling"]);
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
    upstream.mockRejectedValueOnce(new Error("server-secret provider error"));
    const response = await request("/save", input());
    expect(await response.text()).not.toContain("server-secret");
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
    await store.createSupplier(
      supplierFixture({ id: "vendor", kind: "agent" }),
    );
    expect((await request("/save", input())).status).toBe(409);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("requires the actual selected embedding contract, not any successful JSON", async () => {
    const body = {
      ...input(),
      operations: ["embeddings"],
      pricing: {
        ...DEFAULT_PRICING,
        operationPricing: {
          embeddings: {
            ...input().pricing.operationPricing.transcription,
            inputUnit: "token",
            outputUnit: "token",
          },
        },
      },
    };
    upstream.mockResolvedValueOnce(
      Response.json({ data: [{ embedding: [] }] }),
    );
    expect((await request("/save", body)).status).toBe(422);
    upstream.mockResolvedValueOnce(
      Response.json({ data: [{ embedding: [0.2, -0.7] }] }),
    );
    expect((await request("/save", body)).status).toBe(200);
    expect(
      (await store.getOffer("vendor", input().model))?.capabilities,
    ).toEqual(["embeddings"]);
  });

  it.each([
    ["chat", undefined, { choices: [{ message: { content: "OK" } }] }],
    ["image-generation", "image", { data: [{ b64_json: "aW1hZ2U=" }] }],
    ["video-generation", "video-second", { video: { base64: "dmlkZW8=" } }],
  ] as const)(
    "requires usable output, not an asynchronous job ID, for %s",
    async (operation, outputUnit, valid) => {
      const body = {
        ...input(),
        operations: [operation],
        pricing: {
          ...DEFAULT_PRICING,
          operationPricing:
            operation === "chat"
              ? {}
              : {
                  [operation]: {
                    ...input().pricing.operationPricing.transcription,
                    inputUnit: "token",
                    outputUnit,
                  },
                },
        },
      };
      upstream.mockResolvedValueOnce(
        Response.json({ video: { id: "queued" }, data: [{ id: "queued" }] }),
      );
      expect((await request("/save", body)).status).toBe(422);
      upstream.mockResolvedValueOnce(Response.json(valid));
      expect((await request("/save", body)).status).toBe(200);
    },
  );
});
