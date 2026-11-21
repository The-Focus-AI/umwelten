/**
 * Stage 2 of the supplier agent: discover local GPU runtimes.
 *
 * Knocks directly on each local runtime's HTTP model-list endpoint (`/api/tags`
 * for Ollama, `/v1/models` for LM Studio, LlamaBarn, llama-swap, and vLLM) —
 * zero provider classes needed in `@umwelten/core`.
 */

import type { MachineState } from "./types.js";

export class VllmAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VllmAuthError";
  }
}

async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`);
  if (!res.ok) {
    throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { models?: Array<{ name?: string }> };
  return (body.models ?? [])
    .map((m) => m.name)
    .filter((n): n is string => Boolean(n));
}

async function listOpenAICompatModels(
  baseUrl: string,
  opts: { apiKey?: string; authErrorsFatal?: boolean } = {},
): Promise<string[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers: {
      accept: "application/json",
      ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
    },
  });
  if (opts.authErrorsFatal && (res.status === 401 || res.status === 403)) {
    throw new VllmAuthError(
      `vLLM rejected VLLM_API_KEY (${res.status} ${res.statusText})`,
    );
  }
  if (!res.ok) {
    throw new Error(`Runtime API error: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as {
    data?: Array<{ id?: string }>;
    models?: Array<{ id?: string; name?: string }>;
  };
  const items = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.models)
      ? body.models
      : [];
  return items
    .map((m) => (m as { id?: string; name?: string }).id ?? (m as { name?: string }).name)
    .filter((n): n is string => Boolean(n));
}

const RUNTIMES: {
  provider: string;
  probe: () => Promise<string[]>;
}[] = [
  {
    provider: "ollama",
    probe: () =>
      listOllamaModels(process.env.OLLAMA_HOST ?? "http://localhost:11434"),
  },
  {
    provider: "lmstudio",
    probe: () => listOpenAICompatModels("http://localhost:1234/v1"),
  },
  {
    provider: "llamabarn",
    probe: () =>
      listOpenAICompatModels(
        process.env.LLAMABARN_HOST ?? "http://localhost:2276/v1",
      ),
  },
  {
    provider: "llamaswap",
    probe: () =>
      listOpenAICompatModels(
        process.env.LLAMASWAP_HOST ?? "http://localhost:8080/v1",
      ),
  },
  {
    provider: "vllm",
    probe: () =>
      listOpenAICompatModels(
        process.env.VLLM_BASE_URL ?? "http://localhost:8000/v1",
        { apiKey: process.env.VLLM_API_KEY, authErrorsFatal: true },
      ),
  },
];

export async function discoverRuntimes(
  only?: string[],
): Promise<MachineState["runtimes"][number][]> {
  const wanted = only?.length
    ? RUNTIMES.filter((r) => only.includes(r.provider))
    : RUNTIMES;

  return Promise.all(
    wanted.map(
      async ({
        provider,
        probe,
      }): Promise<MachineState["runtimes"][number]> => {
        try {
          const models = await probe();
          return {
            provider,
            reachable: true,
            models: [...models].sort(),
          };
        } catch (error) {
          if (error instanceof VllmAuthError) throw error;
          return {
            provider,
            reachable: false,
            models: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    ),
  );
}

export function toProbeTargets(
  runtimes: MachineState["runtimes"][number][],
  modelFilter?: string,
): { provider: string; model: string }[] {
  return runtimes
    .filter((r) => r.reachable)
    .flatMap((r) => r.models.map((model) => ({ provider: r.provider, model })))
    .filter((t) => !modelFilter || t.model.includes(modelFilter));
}
