/**
 * [vLLM](https://github.com/vllm-project/vllm) over its OpenAI-compatible API.
 *
 * The same shape as the other local runtimes, with one difference that runs
 * through the whole file: **vLLM can require an API key.** `--api-key` is how a
 * box stops everything else on the host spending its GPU outside whatever is
 * metering it, so the key is normal rather than exceptional here — but it is
 * still optional, because a box on a private network often runs without one.
 *
 * That optionality is exactly where a missing key becomes dangerous to report
 * casually. vLLM answers `401` when the key is wrong or absent, and the
 * discovery layer above treats an unreachable runtime as "not running, carry
 * on". Collapsing those would have a box with a typo'd key silently drop out of
 * the catalogue, so `listModels` distinguishes them: a refused key throws
 * something that says so, and only a connection failure means "not running".
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import { installLocalFetchDispatcher } from "./local-fetch.js";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";

/**
 * vLLM's own default is 8000. Nothing in umwelten's 74xx block applies — this
 * is somebody else's server that we are pointing at.
 */
const DEFAULT_BASE_URL = "http://localhost:8000/v1";

export interface VllmProviderOptions {
  /** Key the server was started with (`vllm serve --api-key …`). */
  apiKey?: string;
  /** Provider identity reported by listModels() — see llamaswap.ts for why. */
  providerId?: string;
}

/**
 * A key the server rejected, as distinct from a server that is not there.
 *
 * Named so callers can tell the two apart without matching on message text.
 * The distinction is the point: "unreachable" is a normal state that discovery
 * skips over, and a rejected key is a misconfiguration somebody has to fix.
 */
export class VllmAuthError extends Error {
  readonly kind = "auth";
  constructor(message: string) {
    super(message);
    this.name = "VllmAuthError";
  }
}

export class VllmProvider extends BaseProvider {
  private readonly providerId: string;

  constructor(baseUrl: string = DEFAULT_BASE_URL, options: VllmProviderOptions = {}) {
    super(options.apiKey ?? process.env.VLLM_API_KEY, baseUrl);
    this.providerId = options.providerId ?? "vllm";
    // Prompt eval on a large model can outrun undici's 300s header timeout,
    // which then surfaces as a connection failure rather than slow inference.
    installLocalFetchDispatcher();
  }

  protected get requiresApiKey(): boolean {
    // Optional, not absent. A box on a private network legitimately runs
    // without one, and demanding a key here would make those undiscoverable.
    return false;
  }

  private get url(): string {
    return (this.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  private get headers(): Record<string, string> {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
  }

  async listModels(): Promise<ModelDetails[]> {
    let response: Response;
    try {
      response = await fetch(`${this.url}/models`, { headers: this.headers });
    } catch (error) {
      // Nothing listening. The normal state for a runtime this box does not
      // run, and discovery reports it rather than failing. The original is
      // kept as `cause` — "connection refused" and "DNS failed" are different
      // problems, and the summary above loses that.
      throw new Error(
        `vLLM not reachable at ${this.url}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    if (response.status === 401 || response.status === 403) {
      // Loud, and specifically about the key. A box whose key is wrong is
      // running fine and would otherwise vanish from the catalogue with no
      // indication of why.
      throw new VllmAuthError(
        this.apiKey
          ? `vLLM at ${this.url} rejected the API key. Check --api-key, or VLLM_API_KEY.`
          : `vLLM at ${this.url} requires an API key. Pass one, or set VLLM_API_KEY.`,
      );
    }
    if (!response.ok) {
      throw new Error(`vLLM at ${this.url} returned ${response.status} listing models.`);
    }

    const data = (await response.json()) as {
      data?: { id?: string; max_model_len?: number; owned_by?: string; created?: number }[];
    };
    if (!Array.isArray(data.data)) return [];

    return data.data.map((model): ModelDetails => {
      const created =
        typeof model.created === "number" ? new Date(model.created * 1000) : undefined;
      return {
        provider: this.providerId,
        name: model.id ?? "",
        // vLLM reports the context it was actually started with, which is the
        // number worth having: it reflects this server's flags rather than the
        // weights' theoretical maximum.
        contextLength: typeof model.max_model_len === "number" ? model.max_model_len : undefined,
        costs: { promptTokens: 0, completionTokens: 0 },
        details: { ownedBy: model.owned_by },
        addedDate: created,
        lastUpdated: created,
      };
    });
  }

  getLanguageModel(route: ModelRoute): LanguageModel {
    const vllm = createOpenAICompatible({
      name: "vllm",
      baseURL: this.url,
      includeUsage: true,
      // vLLM implements guided decoding against a JSON schema, so structured
      // output goes through the native path rather than being coaxed out with
      // prompting. Omitting this would have the probe report the capability
      // missing on a server that has it.
      supportsStructuredOutputs: true,
      ...(this.apiKey ? { apiKey: this.apiKey } : {}),
    });
    return vllm(route.name);
  }
}

export function createVllmProvider(
  baseUrl?: string,
  options?: VllmProviderOptions,
): VllmProvider {
  return new VllmProvider(baseUrl, options);
}
