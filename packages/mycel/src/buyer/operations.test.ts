import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memory-store.js";
import { supplierFixture } from "../store/conformance.js";
import { createExchangeServer, type RunningExchange } from "../server.js";
import { makeTestApplication, type TestApplicationKeys } from "../testing/application-keys.js";
import { createIdentityVerifier } from "../auth/identity.js";
import { Balances, endUserOwner } from "../metering/balances.js";
import type {
  CapabilityName,
  OfferPricing,
  OperationPricing,
  VideoJobStatus,
} from "../types.js";
import { DEFAULT_PRICING } from "../types.js";
import {
  normalizeSupplierRequest,
  type ResolveTransport,
  type SupplierRequest,
} from "./transport.js";

const MODEL = "multimodal-model";

function operationPricing(
  inputUnit: OperationPricing["inputUnit"],
  outputUnit: OperationPricing["outputUnit"],
): OperationPricing {
  return {
    inputUnit,
    outputUnit,
    wholesaleInputPerMillion: 10,
    wholesaleOutputPerMillion: 20,
    retailInputPerMillion: 100_000,
    retailOutputPerMillion: 1_000_000,
    additionalInputPricing: {
      byte: { wholesalePerMillion: 1, retailPerMillion: 10_000 },
    },
  };
}

describe("Mycel operation surfaces", () => {
  let store: MemoryStore;
  let exchange: RunningExchange;
  let application: TestApplicationKeys;
  let seen: SupplierRequest[];
  let resolveTransport: ResolveTransport;

  beforeEach(async () => {
    store = new MemoryStore();
    seen = [];
    await store.createSupplier(supplierFixture());
    await store.replaceOffers("office-spark", [
      {
        model: MODEL,
        capabilities: [
          "chat",
          "embeddings",
          "transcription",
          "image-generation",
          "video-generation",
          "video-input",
        ],
        servingMode: "managed",
      },
    ]);
    const pricing: OfferPricing = {
      ...DEFAULT_PRICING,
      operationPricing: {
        embeddings: operationPricing("token", "token"),
        transcription: operationPricing("byte", "token"),
        "image-generation": operationPricing("token", "image"),
        "video-generation": operationPricing("token", "video-second"),
      },
    };
    await store.setOfferPricing("office-spark", MODEL, pricing);
    application = await makeTestApplication();
    await store.createClient({ id: "acme", name: "Acme" });
    await store.createApplication(application.application);
    await new Balances(store).grant(
      endUserOwner({ application: application.application, subject: "user-1" }),
      1_000_000_000,
      "test",
    );
    resolveTransport = () => async (input) => {
      const request = normalizeSupplierRequest(input);
      seen.push(request);
      if (request.path === "/embeddings") {
        return Response.json({
          object: "list",
          data: [{ object: "embedding", index: 0, embedding: [0.25, 0.75] }],
          model: MODEL,
          usage: { prompt_tokens: 2, total_tokens: 2 },
        });
      }
      if (request.path === "/audio/transcriptions") {
        return Response.json({ text: "recorded thought" });
      }
      if (request.path === "/images/generations") {
        return Response.json({ created: 1, data: [{ b64_json: "aW1hZ2U=" }] });
      }
      if (request.path === "/videos/generations") {
        return Response.json({
          data: [{ b64_json: Buffer.from("video-bytes").toString("base64"), media_type: "video/mp4" }],
        });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    };
    exchange = await createExchangeServer({
      store,
      host: "127.0.0.1",
      port: 0,
      verifyCaller: createIdentityVerifier({
        store,
        makeKeySet: () => application.keySet,
      }),
      resolveTransport,
    });
  });

  afterEach(async () => exchange.close());

  async function headers(contentType = "application/json") {
    return {
      authorization: `Bearer ${await application.sign("user-1")}`,
      "content-type": contentType,
    };
  }

  it("relays embeddings, records token units, and exposes provenance", async () => {
    const response = await fetch(`${exchange.url}/v1/embeddings`, {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ model: MODEL, input: "walking thought" }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data[0].embedding).toEqual([0.25, 0.75]);
    const requestId = response.headers.get("x-mycel-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[0].headers).toMatchObject({
      "x-mycel-request-id": requestId,
      "idempotency-key": requestId,
    });
    const records = await store.listRequests();
    expect(records[0]).toMatchObject({
      id: requestId,
      operation: "embeddings",
      inputUnit: "token",
      outputUnits: 0,
    });
    expect(seen[0].path).toBe("/embeddings");
  });

  it("relays the original multipart transcription body and meters file bytes", async () => {
    const form = new FormData();
    form.set("model", MODEL);
    form.set("file", new Blob(["audio-data"], { type: "audio/webm" }), "thought.webm");
    const response = await fetch(`${exchange.url}/v1/audio/transcriptions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await application.sign("user-1")}`,
      },
      body: form,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).text).toBe("recorded thought");
    expect(seen[0].path).toBe("/audio/transcriptions");
    expect(seen[0].body).toBeInstanceOf(Uint8Array);
    expect((await store.listRequests())[0]).toMatchObject({
      operation: "transcription",
      inputUnit: "byte",
      inputUnits: 10,
      outputUnit: "token",
      outputUnits: 4,
    });
  });

  it("relays image generation and charges for the images actually returned", async () => {
    const response = await fetch(`${exchange.url}/v1/images/generations`, {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ model: MODEL, prompt: "mycelium", n: 1 }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toHaveLength(1);
    expect((await store.listRequests())[0]).toMatchObject({
      operation: "image-generation",
      outputUnit: "image",
      outputUnits: 1,
    });
  });

  it("keeps uploaded video private and persists asynchronous output", async () => {
    const upload = await fetch(`${exchange.url}/v1/files`, {
      method: "POST",
      headers: await headers("video/mp4"),
      body: "input-video",
    });
    expect(upload.status).toBe(201);
    const fileId = (await upload.json()).id as string;

    const created = await fetch(`${exchange.url}/v1/videos`, {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({
        model: MODEL,
        prompt: "grow",
        seconds: 3,
        input_file_id: fileId,
      }),
    });
    expect(created.status).toBe(202);
    const submitted = await created.json();
    expect(created.headers.get("x-mycel-request-id")).toBe(submitted.request_id);

    let job: {
      status?: VideoJobStatus;
      output_file_id?: string;
    } = {};
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = await fetch(`${exchange.url}/v1/videos/${submitted.id}`, {
        headers: await headers(),
      });
      job = await status.json();
      if (job.status === "succeeded") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(job.status).toBe("succeeded");
    const output = await fetch(
      `${exchange.url}/v1/files/${job.output_file_id}/content`,
      { headers: await headers() },
    );
    expect(output.headers.get("content-type")).toBe("video/mp4");
    expect(await output.text()).toBe("video-bytes");
    expect(seen.find((request) => request.path === "/videos/generations")?.body).toMatchObject({
      input_video: { media_type: "video/mp4" },
    });
    expect((await store.listRequests())[0]).toMatchObject({
      id: submitted.request_id,
      operation: "video-generation",
      outputUnit: "video-second",
      outputUnits: 3,
      additionalInputUnits: { byte: 11 },
    });
  });

  it("resumes a durable queued video job after the Exchange restarts", async () => {
    await exchange.close();
    const now = new Date();
    await store.createVideoJob({
      id: "video-recovered",
      requestId: "00000000-0000-4000-8000-000000000001",
      applicationId: application.application.id,
      subject: "user-1",
      model: MODEL,
      supplierId: "office-spark",
      status: "queued",
      request: { model: MODEL, prompt: "resume", seconds: 1 },
      createdAt: now,
      updatedAt: now,
    });
    exchange = await createExchangeServer({
      store,
      host: "127.0.0.1",
      port: 0,
      verifyCaller: createIdentityVerifier({
        store,
        makeKeySet: () => application.keySet,
      }),
      resolveTransport,
    });

    let status = "queued";
    for (let attempt = 0; attempt < 20 && status !== "succeeded"; attempt += 1) {
      const response = await fetch(`${exchange.url}/v1/videos/video-recovered`, {
        headers: await headers(),
      });
      status = (await response.json()).status;
      if (status !== "succeeded") await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(status).toBe("succeeded");
    expect(seen.filter((request) => request.path === "/videos/generations")).toHaveLength(1);
  });

  it("does not route a capability that was not verified on the Offer", async () => {
    await store.replaceOffers("office-spark", [
      { model: MODEL, capabilities: ["chat"] as CapabilityName[], servingMode: "managed" },
    ]);
    const response = await fetch(`${exchange.url}/v1/embeddings`, {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ model: MODEL, input: "no" }),
    });
    expect(response.status).toBe(503);
    expect(seen).toHaveLength(0);
  });
});
