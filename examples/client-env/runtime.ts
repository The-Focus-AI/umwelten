/**
 * Untrusted Zero-Secret `HabitatRuntime` Container Equivalent.
 *
 * Receives ONLY:
 *   - `perimeterUrl` (internal network address of `perimeter-gateway`)
 *   - `habitatToken` (scoped caller token for this Habitat — NOT an Intuit or Anthropic/Mycel key)
 *   - `workDir` (persistent `habitat.sqlite`)
 *   - `ontologyDir` (mounted read-only client ontology)
 *
 * All LLM inference routes through `${perimeterUrl}/llm/v1` (which forwards to
 * client-local Mycel) and all QuickBooks calls route through `${perimeterUrl}/egress/quickbooks`.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createModels, createProvider, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { DurableHabitat } from "@umwelten/habitat";
import { tool } from "@umwelten/pi";
import { z } from "zod";

export interface ClientHabitatRuntimeOptions {
  habitatId: string;
  name: string;
  description: string;
  perimeterUrl: string;
  habitatToken: string;
  workDir: string;
  ontologyDir: string;
  modelId?: string;
}

export interface TracedAskResult {
  traceId: string;
  speakerId: string;
  text: string;
  answerEntryId?: string;
}

export interface ClientHabitatRuntime {
  habitatId: string;
  habitat: DurableHabitat;
  askWithTrace: (input: {
    speakerId: string;
    prompt: string;
    traceId: string;
  }) => Promise<TracedAskResult>;
  close: () => Promise<void>;
}

export async function startClientHabitatRuntime(
  options: ClientHabitatRuntimeOptions,
): Promise<ClientHabitatRuntime> {
  const modelId = options.modelId ?? "gemma-4-26b";
  const providerId = "client-perimeter-llm";
  const baseUrl = `${options.perimeterUrl}/llm/v1`;

  let activeTraceId = "tr-boot";
  let activeSpeakerId = "system";

  const currentHeaders = (): Record<string, string> => ({
    "x-habitat-id": options.habitatId,
    "x-trace-id": activeTraceId,
    "x-speaker-id": activeSpeakerId,
  });

  const piModel: Model<"openai-completions"> = {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: providerId,
    baseUrl,
    input: ["text"],
    cost: { input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: 131072,
    maxTokens: 4096,
    compat: {
      supportsUsageInStreaming: true,
      maxTokensField: "max_tokens",
    },
  };

  const models = createModels({
    identity: { userAgent: { custom: "umwelten-client-env/0.6.0" }, attribution: null },
  });

  models.setProvider(
    createProvider({
      id: providerId,
      name: "Client Perimeter LLM Proxy",
      baseUrl,
      auth: {
        apiKey: {
          name: "Perimeter Habitat Token",
          resolve: async () => ({
            source: "explicit",
            auth: {
              apiKey: options.habitatToken,
              baseUrl,
              headers: currentHeaders(),
            },
          }),
        },
      },
      models: [piModel],
      api: openAICompletionsApi(),
    }),
  );

  const callQuickBooksProxy = async (pathSuffix: string): Promise<string> => {
    const res = await fetch(`${options.perimeterUrl}/egress/quickbooks${pathSuffix}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${options.habitatToken}`,
        "x-habitat-id": options.habitatId,
        "x-trace-id": activeTraceId,
        "x-speaker-id": activeSpeakerId,
      },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Perimeter proxy returned HTTP ${res.status}: ${text}`);
    }
    return text;
  };

  const habitat = await DurableHabitat.open({
    id: options.habitatId,
    name: options.name,
    description: options.description,
    workDir: options.workDir,
    models,
    model: { provider: providerId, modelId },
    instructions: [
      "You are a QuickBooks Financial Operations Habitat running inside an isolated Client Environment.",
      "Always call `qb_ar_aging` via the trusted perimeter proxy before reporting receivable balances.",
      "You have ZERO direct QuickBooks credentials; never guess numbers.",
    ].join(" "),
    mountedReadOnlyRoots: [options.ontologyDir],
    tools: {
      qb_ar_aging: tool({
        description:
          "Read current QuickBooks Aged Receivables via the trusted perimeter credential proxy.",
        inputSchema: z.object({
          asOf: z.string().optional().describe("ISO date for aging snapshot"),
        }),
        async execute() {
          return callQuickBooksProxy("/v3/company/acme/reports/AgedReceivables");
        },
      }),
      qb_ontology_glossary: tool({
        description: "Read the client's Mounted read-only GLOSSARY.md ontology rules.",
        inputSchema: z.object({}),
        async execute() {
          return readFile(join(options.ontologyDir, "GLOSSARY.md"), "utf8");
        },
      }),
    },
  });

  // Serialize active trace headers across turns while reusing the same durable Habitat
  let turnLock = Promise.resolve();

  const askWithTrace = async (input: {
    speakerId: string;
    prompt: string;
    traceId: string;
  }): Promise<TracedAskResult> => {
    const prev = turnLock;
    let release!: () => void;
    turnLock = new Promise<void>((r) => {
      release = r;
    });
    await prev;
    try {
      activeTraceId = input.traceId;
      activeSpeakerId = input.speakerId;
      const answer = await habitat.ask(input.prompt);
      return {
        traceId: input.traceId,
        speakerId: input.speakerId,
        text: answer.text,
        answerEntryId: answer.answerEntryId ? String(answer.answerEntryId) : undefined,
      };
    } finally {
      release();
    }
  };

  return {
    habitatId: options.habitatId,
    habitat,
    askWithTrace,
    async close() {
      await habitat.close();
    },
  };
}
