/**
 * The Exchange as an umwelten provider.
 *
 * A habitat points at a running Exchange and its model calls are dispatched to
 * whichever Supplier can serve them — a commercial vendor, or a DGX on a desk —
 * metered and charged on the way through. Nothing in a habitat changes beyond a
 * base URL and a credential, which is the whole reason the Exchange speaks
 * OpenAI-compatible.
 *
 * **This file imports nothing from `@umwelten/exchange` and must not.** `core`
 * sits at the root of the dependency DAG; importing a package that depends on
 * `core` would introduce the repo's first cycle. The relationship is one-way
 * and over HTTP — see `CONTEXT-MAP.md`.
 *
 * Auth: the Exchange verifies a token the *Application* signs (ADR 0014), so
 * the credential here is whatever the caller has been issued. For a habitat
 * that is a service token; for a multi-user Application it is a per-request
 * user assertion, which is why the key is read per call rather than captured.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";

const DEFAULT_BASE_URL = "http://localhost:7450";

/** Shape of `GET /v1/models` on the Exchange. Duplicated rather than imported. */
interface ExchangeModelEntry {
  id: string;
  pricing?: { prompt?: number; completion?: number };
  capabilities?: string[];
  guarantees?: string[];
  context_length?: number;
}

export class ExchangeProvider extends BaseProvider {
  constructor(apiKey?: string, baseUrl: string = DEFAULT_BASE_URL) {
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

    return (data.data as ExchangeModelEntry[]).map((model) => ({
      provider: "exchange",
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
    const exchange = createOpenAICompatible({
      name: "exchange",
      baseURL: `${this.base}/v1`,
      apiKey: this.apiKey,
      includeUsage: true,
      // The Exchange relays whatever the chosen Supplier supports, and its
      // llama.cpp-family Suppliers implement json_schema response formats.
      supportsStructuredOutputs: true,
    });
    return exchange(route.name);
  }
}

export function createExchangeProvider(apiKey?: string, baseUrl?: string): ExchangeProvider {
  return new ExchangeProvider(apiKey, baseUrl ?? process.env.EXCHANGE_URL);
}

export function getExchangeModelUrl(_modelId: string): string {
  return process.env.EXCHANGE_URL ?? DEFAULT_BASE_URL;
}
