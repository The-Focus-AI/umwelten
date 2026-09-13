import { Operator } from "../operator.js";
import { dispatch } from "../dispatch.js";
import {
  OPERATION_UNITS,
  type OfferPricing,
  type OperationName,
  type Supplier,
} from "../types.js";
import type { ExchangeStore } from "../store/types.js";

// These bindings are code-owned. An admin cannot pair an arbitrary URL with
// a server environment variable, or read a credential through the API.
const VENDORS = [
  {
    id: "openai",
    displayName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    upstreamCredentialEnv: "OPENAI_API_KEY",
  },
  {
    id: "groq",
    displayName: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    upstreamCredentialEnv: "GROQ_API_KEY",
  },
  {
    id: "together",
    displayName: "Together",
    baseUrl: "https://api.together.xyz/v1",
    upstreamCredentialEnv: "TOGETHER_API_KEY",
  },
] as const;
const OPERATIONS: OperationName[] = [
  "chat",
  "embeddings",
  "transcription",
  "image-generation",
  "video-generation",
];
const CHAT_PRICES = [
  "wholesalePromptPerMillion",
  "wholesaleCompletionPerMillion",
  "retailPromptPerMillion",
  "retailCompletionPerMillion",
] as const;
const OP_PRICES = [
  "wholesaleInputPerMillion",
  "wholesaleOutputPerMillion",
  "retailInputPerMillion",
  "retailOutputPerMillion",
] as const;

export class CatalogueError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function invalid(): never {
  throw new CatalogueError(400, "invalid_catalogue_input");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function exact(body: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(body).some((key) => !keys.includes(key))) invalid();
}
function name(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 200 ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    invalid();
  return value.trim();
}
function prices(body: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    if (!Number.isSafeInteger(body[key]) || (body[key] as number) < 0)
      invalid();
  }
}

/** A one-second PCM fixture, matching the actual multipart STT serving path. */
function silentWav(): Uint8Array<ArrayBuffer> {
  const wav = Buffer.alloc(44 + 16000);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(16000, 40);
  return new Uint8Array(wav);
}

/** Verify only the selected operation. No response text or upstream error is exposed. */
async function verify(
  supplier: Supplier,
  model: string,
  operation: OperationName,
  doFetch: typeof fetch,
  credential?: string,
): Promise<void> {
  let path: string;
  let body: BodyInit;
  const headers: Record<string, string> = credential
    ? { authorization: `Bearer ${credential}` }
    : {};
  if (operation === "transcription") {
    path = "/audio/transcriptions";
    const form = new FormData();
    form.set("model", model);
    form.set(
      "file",
      new Blob([silentWav()], { type: "audio/wav" }),
      "probe.wav",
    );
    form.set("response_format", "verbose_json");
    body = form;
  } else {
    headers["content-type"] = "application/json";
    const requests = {
      chat: [
        "/chat/completions",
        {
          model,
          max_tokens: 8,
          messages: [{ role: "user", content: "Say OK." }],
        },
      ],
      embeddings: ["/embeddings", { model, input: "capability probe" }],
      "image-generation": [
        "/images/generations",
        {
          model,
          prompt: "A black square",
          n: 1,
          size: "256x256",
          response_format: "b64_json",
        },
      ],
      "video-generation": [
        "/videos/generations",
        { model, prompt: "A still black frame", seconds: 1 },
      ],
    } as const;
    path = requests[operation][0];
    body = JSON.stringify(requests[operation][1]);
  }
  try {
    const response = await doFetch(
      `${supplier.baseUrl.replace(/\/$/, "")}${path}`,
      {
        method: "POST",
        headers,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok || !response.body) throw new Error();
    // Bound even a lying Content-Length. Media responses may be larger than chat.
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 10_000_000) throw new Error();
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const result = JSON.parse(Buffer.concat(chunks).toString()) as {
      choices?: { message?: { content?: unknown } }[];
      data?: { embedding?: unknown; b64_json?: unknown; url?: unknown }[];
      text?: unknown;
      duration?: unknown;
      usage?: { seconds?: unknown };
      video?: unknown;
    };
    let supported = false;
    if (operation === "chat")
      supported = typeof result.choices?.[0]?.message?.content === "string";
    if (operation === "embeddings") {
      const embedding = result.data?.[0]?.embedding;
      supported =
        Array.isArray(embedding) &&
        embedding.length > 0 &&
        embedding.every((v) => typeof v === "number" && Number.isFinite(v));
    }
    if (operation === "transcription") {
      const seconds = Number(result.usage?.seconds ?? result.duration);
      supported =
        typeof result.text === "string" &&
        Number.isFinite(seconds) &&
        seconds > 0;
    }
    const media = (value: unknown) => {
      if (!value || typeof value !== "object") return false;
      const item = value as Record<string, unknown>;
      return [item.b64_json, item.base64, item.url].some(
        (v) => typeof v === "string" && v.length > 0,
      );
    };
    if (operation === "image-generation")
      supported =
        Array.isArray(result.data) &&
        result.data.length > 0 &&
        result.data.every(media);
    if (operation === "video-generation")
      supported = media(result.data?.[0] ?? result.video);
    if (!supported) throw new Error();
  } catch {
    throw new CatalogueError(422, `verification_failed:${operation}`);
  }
}

export function createCatalogue(
  store: ExchangeStore,
  options: {
    fetch?: typeof fetch;
    readCredential?: (name: string) => string | undefined;
    connected?: (id: string) => boolean;
  } = {},
) {
  const readCredential =
    options.readCredential ?? ((name: string) => process.env[name]);
  const ready = (s: { upstreamCredentialEnv?: string }) =>
    !s.upstreamCredentialEnv ||
    Boolean(readCredential(s.upstreamCredentialEnv));
  async function supplier(id: unknown) {
    const found = await store.getSupplier(name(id));
    if (!found) throw new CatalogueError(404, "supplier_not_found");
    return found;
  }
  return {
    async list() {
      const suppliers = await store.listSuppliers();
      const connectedSupplierIds = new Set(
        suppliers.filter((s) => options.connected?.(s.id)).map((s) => s.id),
      );
      return {
        presets: VENDORS.map(({ id, displayName, upstreamCredentialEnv }) => ({
          id,
          displayName,
          credentialConfigured: ready({ upstreamCredentialEnv }),
          credentialEnv: upstreamCredentialEnv,
        })),
        operations: OPERATIONS,
        units: OPERATION_UNITS,
        suppliers: await Promise.all(
          suppliers.map(async (s) => ({
            id: s.id,
            displayName: s.displayName,
            kind: s.kind,
            enabled: s.enabled,
            credentialConfigured: ready(s),
            connected: connectedSupplierIds.has(s.id),
            offers: (await store.listOffersBySupplier(s.id)).map((offer) => ({
              ...offer,
              availability: !s.enabled
                ? "supplier-disabled"
                : !ready(s)
                  ? "credential-missing"
                  : offer.capabilities
                      .map((operation) => {
                        if (!OPERATIONS.includes(operation as OperationName))
                          return null;
                        const result = dispatch(
                          [offer],
                          {
                            model: offer.model,
                            operation: operation as OperationName,
                            capabilities: [operation],
                          },
                          { connectedSupplierIds },
                        );
                        return `${operation}: ${result.offer ? "eligible" : result.considered[0]?.reason}`;
                      })
                      .filter(Boolean)
                      .join("; "),
            })),
          })),
        ),
      };
    },
    async connect(input: unknown) {
      const body = object(input);
      exact(body, ["preset"]);
      const preset = VENDORS.find((v) => v.id === body.preset);
      if (!preset) invalid();
      if (!ready(preset))
        throw new CatalogueError(409, "credential_not_configured");
      if (await store.getSupplier(preset.id))
        throw new CatalogueError(409, "supplier_already_exists");
      // Vendor credentials authenticate publishers, not upstream requests. Never return one.
      await new Operator(store).registerSupplier(preset);
    },
    async enabled(input: unknown) {
      const body = object(input);
      exact(body, ["supplierId", "model", "enabled"]);
      const s = await supplier(body.supplierId);
      if (typeof body.enabled !== "boolean") invalid();
      if (body.model !== undefined) {
        const model = name(body.model);
        const offer = await store.getOffer(s.id, model);
        if (!offer) throw new CatalogueError(404, "offer_not_found");
        if (!offer.adminManaged)
          throw new CatalogueError(
            409,
            "verify_and_save_before_managing_offer",
          );
        await store.setOfferEnabled(s.id, model, body.enabled);
      } else await store.setSupplierEnabled(s.id, body.enabled);
    },
    async save(input: unknown) {
      const body = object(input);
      exact(body, [
        "supplierId",
        "model",
        "operations",
        "pricing",
        "enabled",
        "confirmPaidProbe",
      ]);
      const s = await supplier(body.supplierId);
      if (s.kind !== "vendor")
        throw new CatalogueError(
          409,
          "agent_capabilities_are_published_by_agent",
        );
      const model = name(body.model);
      if (typeof body.enabled !== "boolean" || body.confirmPaidProbe !== true)
        invalid();
      if (
        !Array.isArray(body.operations) ||
        !body.operations.length ||
        body.operations.length > OPERATIONS.length ||
        body.operations.some((op) => !OPERATIONS.includes(op)) ||
        new Set(body.operations).size !== body.operations.length
      )
        invalid();
      const operations = body.operations as OperationName[];
      const pricing = object(body.pricing);
      exact(pricing, [...CHAT_PRICES, "operationPricing"]);
      prices(pricing, CHAT_PRICES);
      const operationPricing = object(pricing.operationPricing ?? {});
      exact(
        operationPricing,
        operations.filter((op) => op !== "chat"),
      );
      for (const operation of operations) {
        if (operation === "chat") continue;
        const price = object(operationPricing[operation]);
        exact(price, [...OP_PRICES, "inputUnit", "outputUnit"]);
        prices(price, OP_PRICES);
        if (
          price.inputUnit !== OPERATION_UNITS[operation].input ||
          price.outputUnit !== OPERATION_UNITS[operation].output
        )
          invalid();
      }
      if (!ready(s)) throw new CatalogueError(409, "credential_not_configured");
      for (const operation of operations) {
        await verify(
          s,
          model,
          operation,
          options.fetch ?? fetch,
          s.upstreamCredentialEnv
            ? readCredential(s.upstreamCredentialEnv)
            : undefined,
        );
      }
      await store.saveAdminOffer(
        s.id,
        { model, capabilities: operations, servingMode: "adapted" },
        { ...pricing, operationPricing } as unknown as OfferPricing,
        body.enabled,
        new Date(),
      );
    },
  };
}
