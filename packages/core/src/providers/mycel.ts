/**
 * The Exchange as an umwelten provider.
 *
 * A habitat points at a running Exchange and its model calls are dispatched to
 * whichever Supplier can serve them — a commercial vendor, or a DGX on a desk —
 * metered and charged on the way through. Nothing in a habitat changes beyond a
 * base URL and a credential, which is the whole reason the Exchange speaks
 * OpenAI-compatible.
 *
 * **This file imports nothing from `@umwelten/mycel` and must not.** `core`
 * sits at the root of the dependency DAG; importing a package that depends on
 * `core` would introduce the repo's first cycle. The relationship is one-way
 * and over HTTP — see `CONTEXT-MAP.md`.
 *
 * Auth: the Exchange verifies a token the *Application* signs (ADR 0014), so
 * the credential here is whatever the caller has been issued. For a habitat
 * that is a service token; for a multi-user Application it is a per-request
 * user assertion, which is why the key is read per call rather than captured.
 */

import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";

const DEFAULT_BASE_URL = "http://localhost:7438";

export interface MycelAIOptions {
  apiKey: string;
  /** Stable application-scoped user identity. Create one provider per request. */
  endUser: string;
  baseUrl?: string;
  requiredCapabilities?: string[];
  requiredGuarantees?: string[];
  fetch?: typeof fetch;
}

/** Small AI SDK 7-native factory for server-side applications. */
export function createMycelAI(options: MycelAIOptions): OpenAIProvider {
  const base = (options.baseUrl ?? process.env.MYCEL_URL ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  if (!options.apiKey) throw new Error("Mycel requires an Application credential.");
  if (!options.endUser.trim()) throw new Error("Mycel requires a stable End User.");
  const provider = createOpenAI({
    name: "mycel",
    baseURL: `${base}/v1`,
    apiKey: options.apiKey,
    headers: {
      "X-Mycel-End-User": options.endUser,
      ...(options.requiredCapabilities?.length
        ? {
            "X-Exchange-Require-Capability":
              options.requiredCapabilities.join(","),
          }
        : {}),
      ...(options.requiredGuarantees?.length
        ? {
            "X-Exchange-Require-Guarantee": options.requiredGuarantees.join(","),
          }
        : {}),
    },
    fetch: options.fetch,
  });
  // OpenAI's callable defaults to its Responses API. Mycel's portable text
  // contract is Chat Completions, while named embedding/image/transcription
  // methods retain their native OpenAI paths.
  return Object.assign(
    (modelId: string) => provider.chat(modelId),
    provider,
    { languageModel: (modelId: string) => provider.chat(modelId) },
  ) as OpenAIProvider;
}

/** Shape of `GET /v1/models` on the Exchange. Duplicated rather than imported. */
interface MycelModelEntry {
  id: string;
  pricing?: { prompt?: number; completion?: number };
  capabilities?: string[];
  guarantees?: string[];
  context_length?: number;
}

export class MycelProvider extends BaseProvider {
  constructor(
    apiKey?: string,
    baseUrl: string = DEFAULT_BASE_URL,
    private readonly endUser =
      process.env.MYCEL_END_USER?.trim() || process.env.HABITAT_ID?.trim(),
  ) {
    super(apiKey, baseUrl);
  }

  /**
   * The Exchange's catalogue is public — a client has to be able to discover
   * what it may ask for before it asks — so listing does not require a key.
   */
  protected get requiresApiKey(): boolean {
    return false;
  }

  private get base(): string {
    return (this.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  async listModels(): Promise<ModelDetails[]> {
    const response = await fetch(`${this.base}/v1/models`, {
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
    });
    const data = await response.json();

    if (!response.ok || !Array.isArray(data?.data)) {
      throw new Error(
        `Exchange API error: ${data?.error ?? response.statusText ?? "unexpected response format"}`,
      );
    }

    return (data.data as MycelModelEntry[]).map((model) => ({
      provider: "mycel",
      name: model.id,
      contextLength: model.context_length,
      costs: {
        // The Exchange quotes retail in dollars per million tokens, which is
        // what a buyer is actually charged — not what the Supplier is owed.
        promptTokens: model.pricing?.prompt ?? 0,
        completionTokens: model.pricing?.completion ?? 0,
      },
      details: {
        capabilities: model.capabilities ?? [],
        guarantees: model.guarantees ?? [],
      },
    })) as ModelDetails[];
  }

  getLanguageModel(route: ModelRoute): LanguageModel {
    if (!this.endUser)
      throw new Error("MYCEL_END_USER or HABITAT_ID is required for Mycel calls.");
    const exchange = createMycelAI({
      apiKey: this.apiKey ?? "",
      baseUrl: this.base,
      endUser: this.endUser,
    });
    return exchange(route.name);
  }
}

export function createMycelProvider(
  apiKey?: string,
  baseUrl?: string,
  endUser?: string,
): MycelProvider {
  return new MycelProvider(
    apiKey,
    baseUrl ?? process.env.MYCEL_URL,
    endUser,
  );
}

export function getMycelModelUrl(_modelId: string): string {
  return process.env.MYCEL_URL ?? DEFAULT_BASE_URL;
}
