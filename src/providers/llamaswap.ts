import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";

const DEFAULT_BASE_URL = "http://localhost:8080/v1";

export interface LlamaSwapProviderOptions {
  /**
   * Fields merged into every POST request body sent to /v1/chat/completions.
   * Used for e.g. `chat_template_kwargs: { enable_thinking: false }` on
   * llama-server (which supports per-request template kwargs to toggle
   * models' reasoning tokens on/off).
   */
  extraBody?: Record<string, unknown>;
  /**
   * Provider identity reported by `listModels()`. Used so that variant
   * registrations (e.g. `llamaswap-nothink`) can reuse this class but
   * preserve their own identity through validateModel() — otherwise the
   * validation path replaces the caller's `llamaswap-nothink` with the
   * default `llamaswap`, silently discarding the nothink wrapping.
   */
  providerId?: string;
}

/** Build a fetch that injects `extraBody` fields into outgoing JSON request
 *  bodies. Used as the `fetch` argument to `createOpenAICompatible`. */
function fetchWithExtraBody(extraBody: Record<string, unknown>): typeof fetch {
  return async (input, init) => {
    if (init?.body && typeof init.body === "string") {
      try {
        const parsed = JSON.parse(init.body);
        const merged = { ...extraBody, ...parsed };
        // Deep-merge known nested templating key so user-provided fields win
        if (extraBody.chat_template_kwargs && parsed.chat_template_kwargs) {
          merged.chat_template_kwargs = {
            ...(extraBody.chat_template_kwargs as object),
            ...parsed.chat_template_kwargs,
          };
        } else if (extraBody.chat_template_kwargs) {
          merged.chat_template_kwargs = extraBody.chat_template_kwargs;
        }
        return fetch(input, { ...init, body: JSON.stringify(merged) });
      } catch {
        // Not JSON — pass through
      }
    }
    return fetch(input, init);
  };
}

export class LlamaSwapProvider extends BaseProvider {
  private extraBody?: Record<string, unknown>;
  private providerId: string;

  constructor(baseUrl: string = DEFAULT_BASE_URL, options: LlamaSwapProviderOptions = {}) {
    super(undefined, baseUrl);
    this.extraBody = options.extraBody;
    this.providerId = options.providerId ?? "llamaswap";
  }

  protected get requiresApiKey(): boolean {
    return false;
  }

  async listModels(): Promise<ModelDetails[]> {
    const baseUrl = this.baseUrl || DEFAULT_BASE_URL;
    const response = await fetch(`${baseUrl}/models`);
    if (!response.ok) throw new Error("Failed to fetch llama-swap models");
    const data = await response.json();
    if (!data || !Array.isArray(data.data)) return [];
    return data.data.map((model: any) => {
      const created = typeof model.created === "number" ? new Date(model.created * 1000) : undefined;
      return {
        provider: this.providerId,
        name: model.id ?? "",
        costs: {
          promptTokens: 0,
          completionTokens: 0,
        },
        details: {
          ownedBy: model.owned_by,
        },
        addedDate: created,
        lastUpdated: created,
      } as ModelDetails;
    });
  }

  getLanguageModel(route: ModelRoute): LanguageModel {
    const baseUrl = this.baseUrl || DEFAULT_BASE_URL;
    const llamaswap = createOpenAICompatible({
      name: "llamaswap",
      baseURL: baseUrl,
      ...(this.extraBody ? { fetch: fetchWithExtraBody(this.extraBody) } : {}),
    });
    return llamaswap(route.name);
  }
}

export function createLlamaSwapProvider(
  baseUrl?: string,
  options?: LlamaSwapProviderOptions,
): LlamaSwapProvider {
  return new LlamaSwapProvider(baseUrl, options);
}
