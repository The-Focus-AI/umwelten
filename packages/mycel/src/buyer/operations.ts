/** OpenAI-compatible non-chat operations and durable media lifecycle. */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  CapabilityName,
  Offer,
  OperationName,
  OperationPricing,
  StoredFile,
  UsageUnitName,
  VideoJob,
} from "../types.js";
import type { ExchangeStore } from "../store/types.js";
import { dispatch } from "../dispatch.js";
import {
  AuthError,
  END_USER_HEADER,
  createIdentityVerifier,
  type Caller,
} from "../auth/identity.js";
import {
  Balances,
  creditFloorFor,
  resolveChargeOwner,
  type BalanceOwner,
} from "../metering/balances.js";
import type {
  ResolveTransport,
  SupplierRequest,
} from "./transport.js";
import { createHttpTransport } from "./transport.js";
import {
  BuyerError,
  REQUIRE_CAPABILITY_HEADER,
  REQUIRE_GUARANTEE_HEADER,
} from "./handler.js";

export const EMBEDDINGS_PATH = "/v1/embeddings";
export const TRANSCRIPTIONS_PATH = "/v1/audio/transcriptions";
export const IMAGE_GENERATIONS_PATH = "/v1/images/generations";
export const FILES_PATH = "/v1/files";
export const VIDEOS_PATH = "/v1/videos";

const MAX_JSON_BYTES = 10_000_000;
const MAX_MEDIA_BYTES = 100_000_000;

interface OperationHandlerOptions {
  store: ExchangeStore;
  verifyCaller?: (authorization: string | undefined, endUser?: string) => Promise<Caller>;
  resolveTransport?: ResolveTransport;
  connectedSupplierIds?: () => Set<string>;
  staleAfterMs?: number;
  fetchImpl?: typeof fetch;
  readCredential?: (envName: string | undefined) => string | undefined;
}

interface PreparedOperation {
  operation: Exclude<OperationName, "chat">;
  capability: CapabilityName;
  supplierRequest: SupplierRequest;
  model: string;
  inputByUnit: Partial<Record<UsageUnitName, number>>;
  estimatedOutputByUnit: Partial<Record<UsageUnitName, number>>;
  countOutput: (body: Uint8Array, contentType: string) => Partial<Record<UsageUnitName, number>>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function headerList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value.join(",") : value)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function readBytes(req: IncomingMessage, limit: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > limit) throw new Error(BuyerError.BODY_TOO_LARGE);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseJson(bytes: Uint8Array): Record<string, unknown> {
  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8") || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(BuyerError.INVALID_BODY);
  }
  return parsed as Record<string, unknown>;
}

function textUnits(value: unknown): number {
  const text =
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value.join("\n")
        : JSON.stringify(value ?? "");
  return Math.max(1, Math.ceil(text.length / 4));
}

function imageCount(body: Uint8Array): number {
  try {
    const parsed = JSON.parse(Buffer.from(body).toString("utf8")) as {
      data?: unknown[];
    };
    return Math.max(0, parsed.data?.length ?? 0);
  } catch {
    return 0;
  }
}

function transcriptionTokens(body: Uint8Array): number {
  try {
    const parsed = JSON.parse(Buffer.from(body).toString("utf8")) as { text?: unknown };
    return typeof parsed.text === "string" ? textUnits(parsed.text) : 0;
  } catch {
    return 0;
  }
}

function unitsFor(
  pricing: OperationPricing,
  input: PreparedOperation["inputByUnit"],
  output: PreparedOperation["estimatedOutputByUnit"],
): { input: number; output: number } {
  return {
    input: Math.max(0, input[pricing.inputUnit] ?? 0),
    output: Math.max(0, output[pricing.outputUnit] ?? 0),
  };
}

export function priceOperation(
  pricing: OperationPricing,
  inputUnits: number,
  outputUnits: number,
  additionalInputUnits: Partial<Record<UsageUnitName, number>> = {},
): { cost: number; charge: number } {
  const price = (
    input: number,
    output: number,
    side: "wholesalePerMillion" | "retailPerMillion",
  ) => {
    let numerator = inputUnits * input + outputUnits * output;
    for (const [unit, units] of Object.entries(additionalInputUnits)) {
      numerator +=
        units * (pricing.additionalInputPricing?.[unit as UsageUnitName]?.[side] ?? 0);
    }
    return Math.ceil(numerator / 1_000_000);
  };
  return {
    cost: price(
      pricing.wholesaleInputPerMillion,
      pricing.wholesaleOutputPerMillion,
      "wholesalePerMillion",
    ),
    charge: price(
      pricing.retailInputPerMillion,
      pricing.retailOutputPerMillion,
      "retailPerMillion",
    ),
  };
}

async function authenticate(
  req: IncomingMessage,
  res: ServerResponse,
  verifyCaller: OperationHandlerOptions["verifyCaller"],
): Promise<Caller | undefined> {
  try {
    return await verifyCaller!(
      req.headers.authorization,
      req.headers[END_USER_HEADER] as string | undefined,
    );
  } catch (error) {
    const reason = error instanceof AuthError ? error.reason : "invalid_signature";
    void reason;
    sendJson(res, 401, { error: BuyerError.UNAUTHORIZED });
    return undefined;
  }
}

function ownedBy(file: StoredFile, caller: Caller): boolean {
  return (
    file.applicationId === caller.application.id && file.subject === caller.subject
  );
}

async function prepareJsonOperation(
  path: string,
  bytes: Uint8Array,
): Promise<PreparedOperation> {
  const body = parseJson(bytes);
  const model = typeof body.model === "string" ? body.model : "";
  if (!model) throw new Error("model_required");

  if (path === EMBEDDINGS_PATH) {
    return {
      operation: "embeddings",
      capability: "embeddings",
      supplierRequest: { path: "/embeddings", contentType: "application/json", body },
      model,
      inputByUnit: { token: textUnits(body.input) },
      estimatedOutputByUnit: {},
      countOutput: () => ({}),
    };
  }
  if (path === IMAGE_GENERATIONS_PATH) {
    const count = Math.max(1, Number(body.n ?? 1));
    return {
      operation: "image-generation",
      capability: "image-generation",
      supplierRequest: {
        path: "/images/generations",
        contentType: "application/json",
        body,
      },
      model,
      inputByUnit: { token: textUnits(body.prompt) },
      estimatedOutputByUnit: { image: count },
      countOutput: (response) => ({ image: imageCount(response) }),
    };
  }
  throw new Error(BuyerError.INVALID_BODY);
}

async function prepareTranscription(
  bytes: Uint8Array,
  contentType: string,
): Promise<PreparedOperation> {
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new Error("multipart_required");
  }
  const form = await new Request("http://mycel.invalid", {
    method: "POST",
    headers: { "content-type": contentType },
    body: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  }).formData();
  const model = String(form.get("model") ?? "");
  const file = form.get("file");
  if (!model || !(file instanceof Blob)) throw new Error("model_and_file_required");
  return {
    operation: "transcription",
    capability: "transcription",
    supplierRequest: {
      path: "/audio/transcriptions",
      contentType,
      body: bytes,
    },
    model,
    // Byte metering is provider-independent and survives compressed formats;
    // operators that sell transcription should price this physical unit.
    inputByUnit: { byte: file.size },
    estimatedOutputByUnit: {},
    countOutput: (response) => ({ token: transcriptionTokens(response) }),
  };
}

async function selectOffer(
  opts: OperationHandlerOptions,
  caller: Caller,
  req: IncomingMessage,
  operation: PreparedOperation["operation"],
  capabilities: CapabilityName | CapabilityName[],
  model: string,
) {
  return dispatch(
    await opts.store.listOffers(),
    {
      model,
      operation,
      guarantees: [
        ...new Set([
          ...caller.application.requiredGuarantees,
          ...headerList(req.headers[REQUIRE_GUARANTEE_HEADER]),
        ]),
      ],
      capabilities: [
        ...new Set([
          ...(Array.isArray(capabilities) ? capabilities : [capabilities]),
          ...headerList(req.headers[REQUIRE_CAPABILITY_HEADER]),
        ]),
      ] as CapabilityName[],
      allowedModels: caller.application.allowedModels,
    },
    {
      staleAfterMs: opts.staleAfterMs,
      connectedSupplierIds: opts.connectedSupplierIds?.(),
    },
  );
}

async function ownerAndFloor(
  caller: Caller,
  balances: Balances,
  store: ExchangeStore,
): Promise<{ owner: BalanceOwner; floor: number }> {
  const owner = await resolveChargeOwner(caller, balances);
  return {
    owner,
    floor: await creditFloorFor(owner, caller.application.clientId, store),
  };
}

async function recordOperation(opts: {
  store: ExchangeStore;
  balances: Balances;
  owner: BalanceOwner;
  requestId: string;
  caller: Caller;
  offer: Offer;
  operation: Exclude<OperationName, "chat">;
  pricing: OperationPricing;
  inputUnits: number;
  outputUnits: number;
  additionalInputUnits?: Partial<Record<UsageUnitName, number>>;
  startedAt: Date;
  outcome?: "completed" | "supply-failed";
}): Promise<void> {
  const priced = priceOperation(
    opts.pricing,
    opts.inputUnits,
    opts.outputUnits,
    opts.additionalInputUnits,
  );
  await opts.store.recordRequest({
    id: opts.requestId,
    applicationId: opts.caller.application.id,
    subject: opts.caller.subject,
    supplierId: opts.offer.supplierId,
    model: opts.offer.model,
    operation: opts.operation,
    inputUnits: opts.inputUnits,
    outputUnits: opts.outputUnits,
    inputUnit: opts.pricing.inputUnit,
    outputUnit: opts.pricing.outputUnit,
    additionalInputUnits: opts.additionalInputUnits,
    promptTokens: opts.pricing.inputUnit === "token" ? opts.inputUnits : 0,
    completionTokens: 0,
    cost: priced.cost,
    charge: priced.charge,
    outcome: opts.outcome ?? "completed",
    startedAt: opts.startedAt,
    finishedAt: new Date(),
  });
  await opts.balances.debit(opts.owner, priced.charge, opts.requestId);
}

async function extractVideoOutput(
  response: Response,
  fetchImpl: typeof fetch,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  if (contentType.startsWith("video/")) {
    const bytes = await readResponseBytes(response, MAX_MEDIA_BYTES);
    return { bytes, mediaType: contentType };
  }
  const json = (await response.json()) as Record<string, unknown>;
  const candidate = Array.isArray(json.data) ? json.data[0] : json.video ?? json;
  if (!candidate || typeof candidate !== "object") {
    throw new Error("supplier returned no durable video output");
  }
  const item = candidate as Record<string, unknown>;
  const encoded = item.b64_json ?? item.base64;
  if (typeof encoded === "string") {
    if (encoded.length > Math.ceil((MAX_MEDIA_BYTES * 4) / 3) + 100) {
      throw new Error("video output too large");
    }
    const bytes = Buffer.from(encoded.replace(/^data:[^,]+,/, ""), "base64");
    if (bytes.byteLength > MAX_MEDIA_BYTES) throw new Error("video output too large");
    return {
      bytes,
      mediaType:
        typeof item.media_type === "string" ? item.media_type : "video/mp4",
    };
  }
  if (typeof item.url === "string") {
    const downloaded = await fetchImpl(item.url);
    if (!downloaded.ok) throw new Error("video output download failed");
    const bytes = await readResponseBytes(downloaded, MAX_MEDIA_BYTES);
    return {
      bytes,
      mediaType: downloaded.headers.get("content-type") ?? "video/mp4",
    };
  }
  throw new Error("supplier returned no durable video output");
}

async function readResponseBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new Error("video output too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createOperationHandler(options: OperationHandlerOptions) {
  const opts = {
    ...options,
    verifyCaller:
      options.verifyCaller ?? createIdentityVerifier({ store: options.store }),
  };
  const resolveTransport =
    options.resolveTransport ??
    createHttpTransport({
      fetchImpl: options.fetchImpl,
      readCredential:
        options.readCredential ??
        ((name) => (name ? process.env[name] : undefined)),
    });
  const fetchImpl = options.fetchImpl ?? fetch;
  const balances = new Balances(options.store);

  async function runVideoJob(job: VideoJob): Promise<void> {
    const application = await opts.store.getApplication(job.applicationId);
    const offer = await opts.store.getOffer(job.supplierId, job.model);
    const supplier = await opts.store.getSupplier(job.supplierId);
    if (!application || !offer || !supplier) {
      await opts.store.updateVideoJob(job.id, {
        status: "failed",
        error: "job dependencies no longer exist",
        updatedAt: new Date(),
      });
      return;
    }
    const pricing = offer.operationPricing?.["video-generation"];
    if (!pricing) return;
    const caller: Caller = { application, subject: job.subject };
    const { owner } = await ownerAndFloor(caller, balances, opts.store);
    await opts.store.updateVideoJob(job.id, { status: "running", updatedAt: new Date() });
    const startedAt = new Date();
    let request = { ...job.request };
    let inputBytes = 0;
    if (job.inputFileId) {
      const file = await opts.store.getFile(job.inputFileId);
      if (!file || !ownedBy(file, caller)) throw new Error("video input expired");
      inputBytes = file.bytes;
      request = {
        ...request,
        input_video: { media_type: file.mediaType, data: file.dataBase64 },
      };
      delete request.input_file_id;
    }
    const seconds = Math.max(1, Number(request.seconds ?? request.duration ?? 1));
    try {
      const response = await resolveTransport(supplier)(
        {
          path: "/videos/generations",
          contentType: "application/json",
          body: request,
          headers: {
            "x-mycel-request-id": job.requestId,
            "idempotency-key": job.requestId,
          },
        },
        new AbortController().signal,
      );
      if (!response.ok) throw new Error(`supplier returned ${response.status}`);
      const output = await extractVideoOutput(response, fetchImpl);
      const outputFileId = `file-${randomUUID()}`;
      await opts.store.createFile({
        id: outputFileId,
        applicationId: application.id,
        subject: job.subject,
        purpose: "video-output",
        mediaType: output.mediaType,
        bytes: output.bytes.byteLength,
        dataBase64: Buffer.from(output.bytes).toString("base64"),
        createdAt: new Date(),
      });
      const measured = unitsFor(
        pricing,
        { byte: inputBytes, token: textUnits(request.prompt) },
        { "video-second": seconds },
      );
      await recordOperation({
        store: opts.store,
        balances,
        owner,
        requestId: job.requestId,
        caller,
        offer,
        operation: "video-generation",
        pricing,
        inputUnits: measured.input,
        outputUnits: measured.output,
        additionalInputUnits:
          inputBytes && pricing.inputUnit !== "byte"
            ? { byte: inputBytes }
            : undefined,
        startedAt,
      });
      await opts.store.updateVideoJob(job.id, {
        status: "succeeded",
        outputFileId,
        updatedAt: new Date(),
      });
    } catch (error) {
      await opts.store.updateVideoJob(job.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      });
    }
  }

  async function safelyRunVideoJob(job: VideoJob): Promise<void> {
    try {
      await runVideoJob(job);
    } catch (error) {
      await opts.store.updateVideoJob(job.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      });
    }
  }

  let recovered = false;
  async function recover(): Promise<void> {
    if (recovered) return;
    recovered = true;
    for (const job of await opts.store.listVideoJobs(["queued", "running"])) {
      void safelyRunVideoJob(job);
    }
  }

  return async function handleOperations(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const path = (req.url ?? "").split("?")[0];
    const operationPath = [
      EMBEDDINGS_PATH,
      TRANSCRIPTIONS_PATH,
      IMAGE_GENERATIONS_PATH,
    ].includes(path);
    const fileMatch = path.match(/^\/v1\/files\/([^/]+)(\/content)?$/);
    const videoMatch = path.match(/^\/v1\/videos\/([^/]+)$/);
    if (!operationPath && path !== FILES_PATH && path !== VIDEOS_PATH && !fileMatch && !videoMatch) {
      return false;
    }
    await recover();
    const caller = await authenticate(req, res, opts.verifyCaller);
    if (!caller) return true;

    if (path === FILES_PATH) {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: BuyerError.METHOD_NOT_ALLOWED });
        return true;
      }
      const mediaType = String(req.headers["content-type"] ?? "");
      if (!mediaType.startsWith("video/")) {
        sendJson(res, 400, { error: "video_content_type_required" });
        return true;
      }
      try {
        const bytes = await readBytes(req, MAX_MEDIA_BYTES);
        const file: StoredFile = {
          id: `file-${randomUUID()}`,
          applicationId: caller.application.id,
          subject: caller.subject,
          purpose: "video-input",
          mediaType,
          bytes: bytes.byteLength,
          dataBase64: Buffer.from(bytes).toString("base64"),
          createdAt: new Date(),
        };
        await opts.store.createFile(file);
        sendJson(res, 201, {
          id: file.id,
          object: "file",
          purpose: file.purpose,
          bytes: file.bytes,
          created_at: Math.floor(file.createdAt.getTime() / 1000),
        });
      } catch {
        sendJson(res, 413, { error: BuyerError.BODY_TOO_LARGE });
      }
      return true;
    }

    if (fileMatch) {
      const file = await opts.store.getFile(fileMatch[1]);
      if (!file || !ownedBy(file, caller)) {
        sendJson(res, 404, { error: "not_found" });
        return true;
      }
      if (req.method === "DELETE" && !fileMatch[2]) {
        await opts.store.deleteFile(file.id);
        sendJson(res, 200, { id: file.id, deleted: true });
        return true;
      }
      if (req.method !== "GET") {
        sendJson(res, 405, { error: BuyerError.METHOD_NOT_ALLOWED });
        return true;
      }
      if (fileMatch[2]) {
        res.writeHead(200, {
          "content-type": file.mediaType,
          "content-length": String(file.bytes),
        });
        res.end(Buffer.from(file.dataBase64, "base64"));
      } else {
        sendJson(res, 200, {
          id: file.id,
          object: "file",
          purpose: file.purpose,
          bytes: file.bytes,
        });
      }
      return true;
    }

    if (videoMatch) {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: BuyerError.METHOD_NOT_ALLOWED });
        return true;
      }
      const job = await opts.store.getVideoJob(videoMatch[1]);
      if (!job || job.applicationId !== caller.application.id || job.subject !== caller.subject) {
        sendJson(res, 404, { error: "not_found" });
        return true;
      }
      sendJson(res, 200, {
        id: job.id,
        object: "video",
        status: job.status,
        model: job.model,
        request_id: job.requestId,
        output_file_id: job.outputFileId,
        error: job.error,
      });
      return true;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: BuyerError.METHOD_NOT_ALLOWED });
      return true;
    }

    if (path === VIDEOS_PATH) {
      let body: Record<string, unknown>;
      try {
        body = parseJson(await readBytes(req, MAX_JSON_BYTES));
      } catch (error) {
        sendJson(res, error instanceof Error && error.message === BuyerError.BODY_TOO_LARGE ? 413 : 400, {
          error: error instanceof Error ? error.message : BuyerError.INVALID_JSON,
        });
        return true;
      }
      const model = typeof body.model === "string" ? body.model : "";
      if (!model) {
        sendJson(res, 400, { error: BuyerError.INVALID_BODY, message: "`model` is required." });
        return true;
      }
      const inputFileId = typeof body.input_file_id === "string" ? body.input_file_id : undefined;
      if (inputFileId) {
        const file = await opts.store.getFile(inputFileId);
        if (!file || !ownedBy(file, caller) || file.purpose !== "video-input") {
          sendJson(res, 400, { error: "invalid_input_file" });
          return true;
        }
      }
      const decision = await selectOffer(
        opts,
        caller,
        req,
        "video-generation",
        inputFileId
          ? ["video-generation", "video-input"]
          : "video-generation",
        model,
      );
      const offer = decision.offer;
      if (!offer) {
        sendJson(res, 503, { error: BuyerError.NO_ELIGIBLE_OFFER, considered: decision.considered });
        return true;
      }
      const pricing = offer.operationPricing?.["video-generation"];
      if (!pricing) {
        sendJson(res, 503, { error: BuyerError.NO_ELIGIBLE_OFFER });
        return true;
      }
      const inputFile = inputFileId ? await opts.store.getFile(inputFileId) : undefined;
      const estimated = unitsFor(
        pricing,
        { byte: inputFile?.bytes ?? 0, token: textUnits(body.prompt) },
        { "video-second": Math.max(1, Number(body.seconds ?? body.duration ?? 1)) },
      );
      const { owner, floor } = await ownerAndFloor(caller, balances, opts.store);
      const extraInput =
        inputFile?.bytes && pricing.inputUnit !== "byte"
          ? { byte: inputFile.bytes }
          : undefined;
      if (!(await balances.canCover(
        owner,
        priceOperation(pricing, estimated.input, estimated.output, extraInput).charge,
        floor,
      ))) {
        sendJson(res, 402, { error: BuyerError.INSUFFICIENT_BALANCE });
        return true;
      }
      const now = new Date();
      const job: VideoJob = {
        id: `video-${randomUUID()}`,
        requestId: randomUUID(),
        applicationId: caller.application.id,
        subject: caller.subject,
        model,
        supplierId: offer.supplierId,
        status: "queued",
        request: body,
        inputFileId,
        createdAt: now,
        updatedAt: now,
      };
      await opts.store.createVideoJob(job);
      void safelyRunVideoJob(job);
      res.setHeader("x-mycel-request-id", job.requestId);
      sendJson(res, 202, {
        id: job.id,
        object: "video",
        status: job.status,
        request_id: job.requestId,
      });
      return true;
    }

    let prepared: PreparedOperation;
    try {
      const contentType = String(req.headers["content-type"] ?? "application/json");
      const bytes = await readBytes(
        req,
        path === TRANSCRIPTIONS_PATH ? MAX_MEDIA_BYTES : MAX_JSON_BYTES,
      );
      prepared =
        path === TRANSCRIPTIONS_PATH
          ? await prepareTranscription(bytes, contentType)
          : await prepareJsonOperation(path, bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : BuyerError.INVALID_BODY;
      sendJson(res, message === BuyerError.BODY_TOO_LARGE ? 413 : 400, {
        error: message,
      });
      return true;
    }
    const decision = await selectOffer(
      opts,
      caller,
      req,
      prepared.operation,
      prepared.capability,
      prepared.model,
    );
    if (!decision.offer) {
      sendJson(res, 503, {
        error: BuyerError.NO_ELIGIBLE_OFFER,
        considered: decision.considered,
      });
      return true;
    }
    const offer = decision.offer;
    const supplier = await opts.store.getSupplier(offer.supplierId);
    const pricing = offer.operationPricing?.[prepared.operation];
    if (!supplier || !pricing) {
      sendJson(res, 503, { error: BuyerError.NO_ELIGIBLE_OFFER });
      return true;
    }
    const estimate = unitsFor(pricing, prepared.inputByUnit, prepared.estimatedOutputByUnit);
    const { owner, floor } = await ownerAndFloor(caller, balances, opts.store);
    if (!(await balances.canCover(owner, priceOperation(pricing, estimate.input, estimate.output).charge, floor))) {
      sendJson(res, 402, { error: BuyerError.INSUFFICIENT_BALANCE });
      return true;
    }
    const requestId = randomUUID();
    res.setHeader("x-mycel-request-id", requestId);
    const startedAt = new Date();
    let upstream: Response;
    try {
      upstream = await resolveTransport(supplier)(
        {
          ...prepared.supplierRequest,
          headers: {
            "x-mycel-request-id": requestId,
            "idempotency-key": requestId,
          },
        },
        new AbortController().signal,
      );
    } catch (error) {
      sendJson(res, 502, {
        error: BuyerError.UPSTREAM_ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    const responseBody = new Uint8Array(await upstream.arrayBuffer());
    if (!upstream.ok) {
      sendJson(res, upstream.status, {
        error: BuyerError.UPSTREAM_ERROR,
        supplierId: supplier.id,
        upstreamStatus: upstream.status,
        body: Buffer.from(responseBody).toString("utf8").slice(0, 2000),
      });
      return true;
    }
    const measured = unitsFor(
      pricing,
      prepared.inputByUnit,
      prepared.countOutput(
        responseBody,
        upstream.headers.get("content-type") ?? "application/json",
      ),
    );
    await recordOperation({
      store: opts.store,
      balances,
      owner,
      requestId,
      caller,
      offer,
      operation: prepared.operation,
      pricing,
      inputUnits: measured.input,
      outputUnits: measured.output,
      startedAt,
    });
    res.writeHead(200, {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "x-mycel-request-id": requestId,
    });
    res.end(Buffer.from(responseBody));
    return true;
  };
}
