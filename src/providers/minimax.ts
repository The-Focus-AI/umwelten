import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";

const DEFAULT_BASE_URL = "https://api.minimax.io/v1";
const DEFAULT_MODEL_URL = "https://platform.minimax.io/docs/api-reference/text-openai-api";

type MiniMaxCatalogEntry = {
  name: string;
  contextLength: number;
  costs: {
    promptTokens: number;
    completionTokens: number;
  };
  details: {
    description: string;
    family: string;
    outputSpeedTps?: number;
    availability?: string;
  };
};

const MINIMAX_MODEL_CATALOG: MiniMaxCatalogEntry[] = [
  {
    name: "MiniMax-M2.5",
    contextLength: 204800,
    costs: {
      promptTokens: 0.3,
      completionTokens: 1.2,
    },
    details: {
      family: "MiniMax M2.5",
      description: "Peak Performance. Ultimate Value. Master the Complex.",
      outputSpeedTps: 60,
    },
  },
  {
    name: "MiniMax-M2.5-highspeed",
    contextLength: 204800,
    costs: {
      promptTokens: 0.6,
      completionTokens: 2.4,
    },
    details: {
      family: "MiniMax M2.5",
      description: "Same performance as M2.5 with faster and more agile inference.",
      outputSpeedTps: 100,
    },
  },
  {
    name: "MiniMax-M2.1",
    contextLength: 204800,
    costs: {
      promptTokens: 0.3,
      completionTokens: 1.2,
    },
    details: {
      family: "MiniMax M2.1",
      description:
        "Powerful multi-language programming capabilities with enhanced reasoning.",
      outputSpeedTps: 60,
    },
  },
  {
    name: "MiniMax-M2.1-highspeed",
    contextLength: 204800,
    costs: {
      promptTokens: 0.6,
      completionTokens: 2.4,
    },
    details: {
      family: "MiniMax M2.1",
      description: "Same performance as M2.1 with faster and more agile inference.",
      outputSpeedTps: 100,
    },
  },
  {
    name: "MiniMax-M2",
    contextLength: 204800,
    costs: {
      promptTokens: 0.3,
      completionTokens: 1.2,
    },
    details: {
      family: "MiniMax M2",
      description: "Agentic capabilities with advanced reasoning.",
    },
  },
];

const MINIMAX_MODEL_ALIASES: Record<string, string> = {
  "codex-MiniMax-M2.5": "MiniMax-M2.5",
  "codex-MiniMax-M2.1": "MiniMax-M2.1",
};

function getCatalogEntry(name: string): MiniMaxCatalogEntry | undefined {
  return MINIMAX_MODEL_CATALOG.find((entry) => entry.name === name);
}

function mapCatalogEntryToModel(entry: MiniMaxCatalogEntry): ModelDetails {
  return {
    provider: "minimax",
    name: entry.name,
    contextLength: entry.contextLength,
    costs: entry.costs,
    details: {
      ...entry.details,
      apiStyle: "openai-compatible",
    },
  };
}

function normaliseModelId(modelId: string): string {
  return MINIMAX_MODEL_ALIASES[modelId] ?? modelId;
}

function buildStaticCatalog(): ModelDetails[] {
  return MINIMAX_MODEL_CATALOG.map(mapCatalogEntryToModel);
}

/**
 * MiniMax streaming sends delta.role as "" but the AI SDK expects "assistant".
 * This fetch wraps streaming responses and normalizes role so validation passes.
 */
function createMiniMaxFetch(apiKey: string, baseUrl: string): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init);
    const contentType = response.headers.get("content-type") ?? "";
    const isStream =
      contentType.includes("text/event-stream") ||
      contentType.includes("application/x-ndjson") ||
      (response.body != null && init?.method === "POST" && contentType.includes("text/plain"));

    if (!response.ok || !response.body || !isStream) {
      return response;
    }

    let buffer = "";
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const transformed = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const payload = line.slice(6);
              if (payload === "[DONE]") {
                controller.enqueue(encoder.encode("data: [DONE]\n"));
                continue;
              }
              try {
                const obj = JSON.parse(payload) as {
                  choices?: Array<{ delta?: { role?: string; content?: string }; index?: number }>;
                };
                if (obj?.choices?.[0]?.delta?.role === "") {
                  obj.choices[0].delta.role = "assistant";
                }
                controller.enqueue(encoder.encode("data: " + JSON.stringify(obj) + "\n"));
              } catch {
                controller.enqueue(encoder.encode(line + "\n"));
              }
            } else {
              controller.enqueue(encoder.encode(line + "\n"));
            }
          }
        },
        flush(controller) {
          if (buffer) {
            if (buffer.startsWith("data: ")) {
              const payload = buffer.slice(6);
              if (payload !== "[DONE]") {
                try {
                  const obj = JSON.parse(payload) as {
                    choices?: Array<{ delta?: { role?: string }; index?: number }>;
                  };
                  if (obj?.choices?.[0]?.delta?.role === "") {
                    obj.choices[0].delta.role = "assistant";
                  }
                  buffer = "data: " + JSON.stringify(obj) + "\n";
                } catch {
                  // leave buffer as-is
                }
              }
            }
            controller.enqueue(encoder.encode(buffer));
          }
        },
      }),
    );

    return new Response(transformed, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

export class MiniMaxProvider extends BaseProvider {
  constructor(apiKey: string, baseUrl: string = DEFAULT_BASE_URL) {
    super(apiKey, baseUrl);
    this.validateConfig();
  }

  protected get requiresApiKey(): boolean {
    return true;
  }

  async listModels(): Promise<ModelDetails[]> {
    this.validateConfig();

    const baseUrl = this.baseUrl || DEFAULT_BASE_URL;
    const url = `${baseUrl.replace(/\/$/, "")}/models`;
    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
        },
      });
    } catch {
      return buildStaticCatalog();
    }

    if (!response.ok) {
      if ([404, 405, 501].includes(response.status)) {
        return buildStaticCatalog();
      }
      throw new Error(
        `Failed to fetch MiniMax models: ${response.status} ${response.statusText}`,
      );
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      return buildStaticCatalog();
    }

    if (!data || !Array.isArray(data.data)) {
      return buildStaticCatalog();
    }

    return data.data.map((model: any) => {
      const modelId = String(model.id ?? "");
      const catalogEntry = getCatalogEntry(normaliseModelId(modelId));

      return {
        provider: "minimax",
        name: modelId,
        contextLength:
          model.context_window ??
          model.context_length ??
          catalogEntry?.contextLength,
        costs: catalogEntry?.costs,
        details: {
          description:
            model.description ??
            catalogEntry?.details.description ??
            `MiniMax model: ${modelId}`,
          family:
            catalogEntry?.details.family ??
            normaliseModelId(modelId).replace(/^MiniMax-/, "MiniMax "),
          apiStyle: "openai-compatible",
          ownedBy: model.owned_by,
          object: model.object,
          ...(
            catalogEntry?.details.outputSpeedTps
              ? { outputSpeedTps: catalogEntry.details.outputSpeedTps }
              : {}
          ),
        },
      } as ModelDetails;
    });
  }

  getLanguageModel(route: ModelRoute): LanguageModel {
    this.validateConfig();

    const baseUrl = this.baseUrl || DEFAULT_BASE_URL;
    const provider = createOpenAICompatible({
      name: "minimax",
      baseURL: baseUrl,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      fetch: createMiniMaxFetch(this.apiKey!, baseUrl),
    });

    return provider(route.name);
  }
}

export function createMiniMaxProvider(
  apiKey: string,
  baseUrl?: string,
): MiniMaxProvider {
  return new MiniMaxProvider(apiKey, baseUrl);
}

export function getMiniMaxModelUrl(_modelId: string): string {
  return DEFAULT_MODEL_URL;
}

export function getMiniMaxCanonicalModelName(modelId: string): string {
  return normaliseModelId(modelId);
}
