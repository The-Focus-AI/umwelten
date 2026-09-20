import { z } from "zod";
import { calculateCost } from "../costs/costs.js";
import { parseAnswers, validateRequest, wireQuestions } from "./schema.js";
import type {
  JudgmentBackend,
  JudgmentQuestions,
  JudgmentRequest,
  JudgmentResult,
} from "./types.js";
import { JudgmentError } from "./types.js";

const routes = {
  openrouter: {
    endpoint: "https://openrouter.ai/api/alpha/decisions",
    model: "typesafe/jev-1.13",
    env: "OPENROUTER_API_KEY",
  },
  typesafe: {
    endpoint: "https://api.typesafe.ai/v1/systemone",
    model: "jev-1.13.0",
    env: "TYPESAFE_API_KEY",
  },
  mycel: {
    endpoint: "https://mycel.thefocus.ai/v1/decisions",
    model: "typesafe/jev-1.13",
    env: "MYCEL_API_KEY",
  },
} as const;

export interface JevOptions {
  provider: keyof typeof routes;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  endUser?: string;
  /** Explicit, dated pricing supplied by the caller, in USD per million tokens. */
  costs?: { promptTokens: number; completionTokens: number };
  fetch?: typeof fetch;
}

const responseSchema = z.object({
  model: z.string().min(1),
  id: z.string().optional(),
  answers: z.unknown(),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
      cost: z.number().nonnegative().optional(),
    })
    .optional(),
});

/** One attempt per call. The experiment records failures, never hides retries. */
export function createJevBackend(options: JevOptions): JudgmentBackend {
  const route = routes[options.provider];
  const model = options.model ?? route.model;
  const mycel = options.provider === "mycel";
  const endpoint = mycel
    ? `${(options.baseUrl ?? process.env.MYCEL_URL ?? "https://mycel.thefocus.ai").replace(/\/+$/, "")}/v1/decisions`
    : route.endpoint;
  return {
    identity: JSON.stringify({
      adapter: "jev-v1",
      provider: options.provider,
      model,
      costs: options.costs,
      ...(mycel && { endpoint }),
    }),
    async judge<const Q extends JudgmentQuestions>(
      request: JudgmentRequest<Q>,
      callOptions?: { signal?: AbortSignal },
    ): Promise<JudgmentResult<Q>> {
      validateRequest(request);
      callOptions?.signal?.throwIfAborted();
      const apiKey = options.apiKey ?? process.env[route.env];
      if (!apiKey)
        throw new Error(`${route.env} is required for ${options.provider} Jev`);
      const endUser =
        options.endUser ?? process.env.MYCEL_END_USER ?? process.env.HABITAT_ID;
      if (mycel && !endUser)
        throw new Error("MYCEL_END_USER is required for Mycel Jev");
      const startedAt = new Date().toISOString();
      const start = performance.now();
      const response = await (options.fetch ?? fetch)(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(mycel && { "x-mycel-end-user": endUser! }),
        },
        body: JSON.stringify({
          model,
          state: request.state,
          questions: wireQuestions(request.questions),
        }),
        signal: callOptions?.signal,
      });
      // Do not echo response bodies: a gateway can include credentials or input.
      if (!response.ok)
        throw new JudgmentError("http", { status: response.status });
      const raw: unknown = await response.json();
      let parsed: z.infer<typeof responseSchema>;
      let answers: JudgmentResult<Q>["answers"];
      try {
        parsed = responseSchema.parse(raw);
        answers = parseAnswers(request.questions, parsed.answers);
      } catch (cause) {
        throw new JudgmentError("invalid-response", { raw }, { cause });
      }
      const usage = parsed.usage && {
        promptTokens: parsed.usage.input_tokens,
        completionTokens: parsed.usage.output_tokens,
        total: parsed.usage.input_tokens + parsed.usage.output_tokens,
      };
      const calculated =
        usage &&
        options.costs &&
        calculateCost(
          { name: model, provider: options.provider, costs: options.costs },
          usage,
        );
      const cost = mycel
        ? undefined
        : parsed.usage?.cost !== undefined
          ? { usd: parsed.usage.cost, source: "provider-reported" as const }
          : calculated
            ? { usd: calculated.totalCost, source: "pricing-table" as const }
            : undefined;
      return {
        answers,
        raw,
        metadata: {
          provider: options.provider,
          requestedModel: model,
          model: parsed.model,
          probabilitySource: "native",
          execution: "shared-state",
          startedAt,
          durationMs: performance.now() - start,
          ...(usage && { usage }),
          ...(cost && { cost }),
          ...(mycel &&
            parsed.usage?.cost !== undefined && {
              upstreamCostUsd: parsed.usage.cost,
            }),
          ...(parsed.id && { requestId: parsed.id }),
          ...(mycel &&
            response.headers.get("x-mycel-request-id") && {
              requestId: response.headers.get("x-mycel-request-id")!,
            }),
        },
      };
    },
  };
}
