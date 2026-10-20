import { Operator } from "../operator.js";
import { dispatch } from "../dispatch.js";
import {
  DEFAULT_PRICING,
  OPERATION_UNITS,
  type Offer,
  type OfferPricing,
  type OperationName,
  type Supplier,
} from "../types.js";
import type { ExchangeStore } from "../store/types.js";
import { supplierRequestUrl, type SupplierPath } from "../buyer/transport.js";
import { decisionsUsage } from "../buyer/decisions.js";

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
  "decisions",
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
const OPERATION_LABELS: Record<OperationName, string> = {
  chat: "Chat",
  embeddings: "Embeddings",
  decisions: "Decisions",
  transcription: "Speech to text (STT)",
  "image-generation": "Image generation",
  "video-generation": "Video generation",
};
type OperationJudgment =
  | "pass"
  | "contract"
  | "auth"
  | "rejected"
  | "unobserved"
  | "not-run";
type OperationFinding = {
  operation: OperationName;
  judgment: OperationJudgment;
};
type ProbeSettlement =
  | { effect: "record"; capabilities: OperationName[] }
  | {
      effect: "leave-unchanged";
      error: "upstream_unauthorized" | "upstream_unobserved";
    };
type PresentedFinding = OperationFinding & { label: string; summary: string };
const JUDGMENT_SUMMARY: Record<OperationJudgment, string> = {
  pass: "Supported.",
  contract: "No usable response for this fixture.",
  rejected:
    "The upstream refused this operation. That does not mean the model lacks it.",
  auth: "Credential rejected. That does not mean the model lacks this operation.",
  unobserved: "No result. That does not mean the model lacks this operation.",
  "not-run": "Not sent.",
};

export class CatalogueError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly findings?: readonly PresentedFinding[],
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

function present(finding: OperationFinding): PresentedFinding {
  return {
    ...finding,
    label: OPERATION_LABELS[finding.operation],
    summary: JUDGMENT_SUMMARY[finding.judgment],
  };
}
function settle(findings: readonly OperationFinding[]): ProbeSettlement {
  const capabilities = findings
    .filter((finding) => finding.judgment === "pass")
    .map((finding) => finding.operation);
  if (
    findings.some((finding) => finding.judgment === "auth") &&
    capabilities.length === 0
  )
    return { effect: "leave-unchanged", error: "upstream_unauthorized" };
  // A stored row means these passed a completed check. A missing answer is not absence.
  if (findings.some((finding) => finding.judgment === "unobserved"))
    return { effect: "leave-unchanged", error: "upstream_unobserved" };
  return { effect: "record", capabilities };
}
function chatRate(
  existing: Offer | null,
  passed: boolean,
  key: (typeof CHAT_PRICES)[number],
): number {
  if (!passed) return 0;
  if (existing?.capabilities.includes("chat")) return existing[key];
  return DEFAULT_PRICING[key];
}
function pricingForRecord(
  existing: Offer | null,
  capabilities: readonly OperationName[],
): OfferPricing {
  const chat = capabilities.includes("chat");
  const operationPricing: NonNullable<OfferPricing["operationPricing"]> = {};
  for (const operation of capabilities) {
    if (operation === "chat") continue;
    const stored = existing?.capabilities.includes(operation)
      ? existing.operationPricing?.[operation]
      : undefined;
    operationPricing[operation] = stored
      ? { ...stored }
      : {
          inputUnit: OPERATION_UNITS[operation].input,
          outputUnit: OPERATION_UNITS[operation].output,
          wholesaleInputPerMillion: 0,
          wholesaleOutputPerMillion: 0,
          retailInputPerMillion: 100_000,
          retailOutputPerMillion: 400_000,
        };
  }
  return {
    wholesalePromptPerMillion: chatRate(
      existing,
      chat,
      "wholesalePromptPerMillion",
    ),
    wholesaleCompletionPerMillion: chatRate(
      existing,
      chat,
      "wholesaleCompletionPerMillion",
    ),
    retailPromptPerMillion: chatRate(existing, chat, "retailPromptPerMillion"),
    retailCompletionPerMillion: chatRate(
      existing,
      chat,
      "retailCompletionPerMillion",
    ),
    operationPricing,
  };
}
function enabledForRecord(
  existing: Offer | null,
  capabilities: readonly OperationName[],
): boolean {
  if (!existing?.adminManaged) return false;
  const discovered = capabilities.some(
    (operation) => !existing.capabilities.includes(operation),
  );
  return discovered ? false : existing.enabled;
}
function aborted(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}
async function discard(
  response: Response,
  judgment: OperationJudgment,
): Promise<OperationJudgment> {
  await response.body?.cancel().catch(() => undefined);
  return judgment;
}

function usableChatContent(content: unknown): boolean {
  if (typeof content === "string") return true;
  if (!Array.isArray(content)) return false;
  return content.some((part) => {
    if (typeof part === "string") return true;
    if (!part || typeof part !== "object") return false;
    return typeof (part as { text?: unknown }).text === "string";
  });
}

async function probe(
  supplier: Supplier,
  model: string,
  operation: OperationName,
  doFetch: typeof fetch,
  credential?: string,
): Promise<OperationJudgment> {
  let path: SupplierPath;
  let body: BodyInit;
  const questions = { ok: { type: "noul", instructions: "Does the state say OK?" } };
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
    const chatBody: Record<string, unknown> = {
      model,
      max_tokens: 64,
      messages: [{ role: "user", content: "Say OK." }],
    };
    // A short fixture with reasoning left on often returns null content.
    if (supplier.baseUrl.includes("openrouter.ai")) {
      chatBody.reasoning = { effort: "none" };
      chatBody.include_reasoning = false;
    }
    const requests = {
      chat: ["/chat/completions", chatBody],
      embeddings: ["/embeddings", { model, input: "capability probe" }],
      decisions: ["/decisions", { model, state: "OK", questions }],
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
  let response: Response;
  try {
    response = await doFetch(supplierRequestUrl(supplier.baseUrl, path), {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return "unobserved";
  }
  if (response.status === 401) return discard(response, "auth");
  if (response.status === 403) return discard(response, "rejected");
  if (
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500
  )
    return discard(response, "unobserved");
  try {
    if (!response.ok || !response.body) return discard(response, "contract");
    // Bound even a lying Content-Length. Media responses may be larger than chat.
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 10_000_000) return "contract";
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
    if (operation === "decisions") {
      decisionsUsage(result, questions);
      supported = true;
    }
    if (operation === "chat")
      supported = usableChatContent(result.choices?.[0]?.message?.content);
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
    return supported ? "pass" : "contract";
  } catch (error) {
    if (aborted(error)) return "unobserved";
    return "contract";
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
  const api = {
    async models(id: unknown) {
      const s = await supplier(id);
      if (s.kind !== "vendor")
        throw new CatalogueError(409, "agent_catalogue_not_supported");
      if (!ready(s)) throw new CatalogueError(409, "credential_not_configured");
      try {
        const credential = s.upstreamCredentialEnv
          ? readCredential(s.upstreamCredentialEnv)
          : undefined;
        const response = await (options.fetch ?? fetch)(
          `${s.baseUrl.replace(/\/$/, "")}/models`,
          {
            headers: credential ? { authorization: `Bearer ${credential}` } : {},
            redirect: "error",
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (!response.ok || !response.body) throw new Error();
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
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
        const payload = JSON.parse(Buffer.concat(chunks).toString());
        if (!Array.isArray(payload?.data)) throw new Error();
        const models = new Map<string, { id: string; name: string }>();
        for (const item of payload.data) {
          if (!item || typeof item.id !== "string" || !item.id.trim() || item.id.length > 200)
            continue;
          models.set(item.id, {
            id: item.id,
            name: typeof item.name === "string" ? item.name.slice(0, 200) : item.id,
          });
        }
        return { models: [...models.values()].sort((a, b) => a.id.localeCompare(b.id)) };
      } catch {
        throw new CatalogueError(502, "upstream_catalogue_unavailable");
      }
    },
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
        labels: { ...OPERATION_LABELS },
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
    async check(input: unknown) {
      const body = object(input);
      exact(body, ["supplierId", "model", "confirmPaidProbe"]);
      const model = name(body.model);
      if (body.confirmPaidProbe !== true) invalid();
      const s = await supplier(body.supplierId);
      if (s.kind !== "vendor")
        throw new CatalogueError(
          409,
          "agent_capabilities_are_published_by_agent",
        );
      if (!ready(s)) throw new CatalogueError(409, "credential_not_configured");
      const credential = s.upstreamCredentialEnv
        ? readCredential(s.upstreamCredentialEnv)
        : undefined;
      const findings: OperationFinding[] = [];
      for (const operation of OPERATIONS) {
        const judgment = await probe(
          s,
          model,
          operation,
          options.fetch ?? fetch,
          credential,
        );
        findings.push({ operation, judgment });
        if (judgment === "auth") {
          // A rejected credential is the supplier's, so later calls would bill the same refusal.
          for (const later of OPERATIONS.slice(findings.length))
            findings.push({ operation: later, judgment: "not-run" });
          break;
        }
      }
      const presented = findings.map(present);
      // An all-miss check is not a verified empty catalogue. Leave any stored offer alone.
      const completedMiss = findings.every(
        (finding) =>
          finding.judgment === "contract" || finding.judgment === "rejected",
      );
      if (completedMiss) return { ...(await api.list()), findings: presented };
      const settlement = settle(findings);
      if (settlement.effect === "leave-unchanged")
        throw new CatalogueError(422, settlement.error, presented);
      const existing = await store.getOffer(s.id, model);
      await store.saveAdminOffer(
        s.id,
        {
          model,
          capabilities: settlement.capabilities,
          servingMode: "adapted",
        },
        pricingForRecord(existing, settlement.capabilities),
        enabledForRecord(existing, settlement.capabilities),
        new Date(),
      );
      return { ...(await api.list()), findings: presented };
    },
    async save(input: unknown) {
      const body = object(input);
      exact(body, ["supplierId", "model", "operations", "pricing", "enabled"]);
      const model = name(body.model);
      if (typeof body.enabled !== "boolean") invalid();
      if (
        !Array.isArray(body.operations) ||
        !body.operations.length ||
        body.operations.length > OPERATIONS.length ||
        body.operations.some((op) => !OPERATIONS.includes(op)) ||
        new Set(body.operations).size !== body.operations.length
      )
        invalid();
      const requested = body.operations as OperationName[];
      const pricing = object(body.pricing);
      exact(pricing, [...CHAT_PRICES, "operationPricing"]);
      prices(pricing, CHAT_PRICES);
      const operationPricing = object(pricing.operationPricing ?? {});
      exact(
        operationPricing,
        requested.filter((op) => op !== "chat"),
      );
      for (const operation of requested) {
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
      const s = await supplier(body.supplierId);
      if (s.kind !== "vendor")
        throw new CatalogueError(
          409,
          "agent_capabilities_are_published_by_agent",
        );
      const offer = await store.getOffer(s.id, model);
      if (!offer) throw new CatalogueError(404, "offer_not_found");
      if (!offer.adminManaged || !offer.verifiedAt)
        throw new CatalogueError(409, "probe_before_publishing");
      const billable = new Set(
        offer.capabilities.filter((capability): capability is OperationName =>
          OPERATIONS.includes(capability as OperationName),
        ),
      );
      if (requested.some((operation) => !billable.has(operation)))
        throw new CatalogueError(409, "not_a_checked_capability");
      const operations = OPERATIONS.filter((operation) =>
        requested.includes(operation),
      );
      await store.saveAdminOffer(
        s.id,
        { model, capabilities: operations, servingMode: "adapted" },
        { ...pricing, operationPricing } as OfferPricing,
        body.enabled,
        offer.verifiedAt,
      );
    },
  };
  return api;
}
