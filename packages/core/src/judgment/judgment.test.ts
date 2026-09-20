import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { Interaction } from "../interaction/core/interaction.js";
import { createJevBackend } from "./jev.js";
import { createLlmJudgmentBackend } from "./llm.js";
import { parseAnswers, validateRequest } from "./schema.js";
import type { JudgmentRequest } from "./types.js";

const request = {
  state: { ticket: "The invoice is wrong. Refund me." },
  questions: {
    refund: { kind: "binary", instructions: "Refund requested?" },
    route: {
      kind: "choice",
      instructions: "Which team?",
      options: { billing: "Invoices", technical: "Bugs", other: "Neither" },
    },
    impact: {
      kind: "ordinal",
      instructions: "Impact?",
      levels: ["None", "Limited", "Critical"],
    },
  },
} as const satisfies JudgmentRequest;
const answers = () => ({
  refund: { type: "noul", noul: 0.8 },
  route: {
    type: "choice",
    choice: "billing",
    probabilities: { billing: 0.65, technical: 0.25, other: 0.1 },
    confidence: 0.2,
  },
  impact: {
    type: "score",
    probabilities: { "0": 0.1, "1": 0.3, "2": 0.6 },
    score: 1.5,
    confidence: 0.3,
  },
});
afterEach(() => vi.restoreAllMocks());

describe("judgment contract", () => {
  it("keeps literal option types and distributions, not provider confidence", () => {
    validateRequest(request);
    const result = parseAnswers(request.questions, answers());
    expectTypeOf(result.route.selected).toEqualTypeOf<
      "billing" | "technical" | "other"
    >();
    expect(result.refund.probabilityTrue).toBe(0.8);
    expect(result.route.probabilities.technical).toBe(0.25);
    expect(result.route).not.toHaveProperty("confidence");
    expect(result.impact.probabilities).toEqual([0.1, 0.3, 0.6]);
    expect(result.impact.expectedIndex).toBeCloseTo(1.5);
  });

  it.each([
    [
      "missing question",
      (a: Record<string, unknown>) => {
        delete a.refund;
      },
    ],
    [
      "extra question",
      (a: Record<string, unknown>) => {
        a.extra = { type: "noul", noul: 1 };
      },
    ],
    [
      "wrong kind",
      (a: Record<string, unknown>) => {
        a.refund = { type: "choice", choice: "yes" };
      },
    ],
    [
      "NaN",
      (a: Record<string, unknown>) => {
        a.refund = { type: "noul", noul: NaN };
      },
    ],
    [
      "negative",
      (a: Record<string, unknown>) => {
        a.refund = { type: "noul", noul: -0.01 };
      },
    ],
    [
      "over one",
      (a: Record<string, unknown>) => {
        a.refund = { type: "noul", noul: 1.01 };
      },
    ],
    [
      "missing option",
      (a: Record<string, unknown>) => {
        a.route = {
          type: "choice",
          choice: "billing",
          probabilities: { billing: 0.8, technical: 0.2 },
        };
      },
    ],
    [
      "extra option",
      (a: Record<string, unknown>) => {
        a.route = {
          type: "choice",
          choice: "billing",
          probabilities: {
            billing: 0.65,
            technical: 0.25,
            other: 0.1,
            surprise: 0,
          },
        };
      },
    ],
    [
      "wrong total",
      (a: Record<string, unknown>) => {
        a.route = {
          type: "choice",
          choice: "billing",
          probabilities: { billing: 0.6, technical: 0.2, other: 0.1 },
        };
      },
    ],
    [
      "wrong winner",
      (a: Record<string, unknown>) => {
        a.route = { ...answers().route, choice: "other" };
      },
    ],
    [
      "missing level",
      (a: Record<string, unknown>) => {
        a.impact = { type: "score", probabilities: { "0": 0.1, "1": 0.9 } };
      },
    ],
  ])("rejects %s", (_label, mutate) => {
    const raw = answers();
    mutate(raw);
    expect(() => parseAnswers(request.questions, raw)).toThrow();
  });

  it("allows small rounding error without silently normalizing it", () => {
    const raw = answers();
    raw.route.probabilities.other = 0.10005;
    expect(parseAnswers(request.questions, raw).route.probabilities.other).toBe(
      0.10005,
    );
    raw.route.probabilities.other = 0.1002;
    expect(() => parseAnswers(request.questions, raw)).toThrow();
  });

  it("rejects invalid definitions before inference", () => {
    expect(() => validateRequest({ state: "", questions: {} })).toThrow();
    expect(() =>
      validateRequest({
        state: "",
        questions: {
          x: { kind: "choice", instructions: "?", options: { only: "one" } },
        },
      }),
    ).toThrow();
    expect(() =>
      validateRequest({
        state: "",
        questions: {
          x: { kind: "ordinal", instructions: "?", levels: ["same", "same"] },
        },
      }),
    ).toThrow();
  });
});

describe("native Jev routes", () => {
  it("routes Mycel with subject and ledger request ID without treating upstream expense as the charge", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          model: "jev-version",
          id: "upstream-id",
          answers: answers(),
          usage: { input_tokens: 360, output_tokens: 62, cost: 0.00001512 },
        },
        { headers: { "x-mycel-request-id": "ledger-id" } },
      ),
    );
    const options = {
      provider: "mycel" as const,
      apiKey: "private-test-key",
      baseUrl: "https://exchange.example/",
      endUser: "jev-pilot",
      fetch: transport,
    };
    const backend = createJevBackend(options);
    const result = await backend.judge(request);
    expect(transport.mock.calls[0][0]).toBe(
      "https://exchange.example/v1/decisions",
    );
    expect(transport.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer private-test-key",
      "x-mycel-end-user": "jev-pilot",
    });
    expect(result.metadata.requestId).toBe("ledger-id");
    expect(result.metadata.upstreamCostUsd).toBe(0.00001512);
    expect(result.metadata.cost).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("private-test-key");
    expect(backend.identity).not.toContain("private-test-key");
    expect(backend.identity).not.toBe(
      createJevBackend({ ...options, baseUrl: "https://other.example" })
        .identity,
    );
  });

  it.each([
    [
      "openrouter",
      "https://openrouter.ai/api/alpha/decisions",
      "typesafe/jev-1.13",
    ],
    ["typesafe", "https://api.typesafe.ai/v1/systemone", "jev-1.13.0"],
  ] as const)(
    "uses %s's decision endpoint, preserving raw metadata",
    async (provider, endpoint, model) => {
      const raw = {
        model,
        id: "request-123",
        answers: answers(),
        usage: { input_tokens: 476, output_tokens: 70, cost: 0.000019992 },
      };
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(raw));
      const signal = new AbortController().signal;
      const result = await createJevBackend({
        provider,
        apiKey: "test-key",
        fetch: transport,
      }).judge(request, { signal });
      const [url, init] = transport.mock.calls[0];
      expect(url).toBe(endpoint);
      expect(init?.signal).toBe(signal);
      expect(JSON.parse(init?.body as string)).toEqual({
        model,
        state: request.state,
        questions: {
          refund: { type: "noul", instructions: "Refund requested?" },
          route: {
            type: "choice",
            instructions: "Which team?",
            criteria: request.questions.route.options,
          },
          impact: {
            type: "score",
            instructions: "Impact?",
            criteria: request.questions.impact.levels,
          },
        },
      });
      expect(result.metadata.cost).toEqual({
        usd: 0.000019992,
        source: "provider-reported",
      });
      expect(result.metadata.usage?.total).toBe(546);
      expect(result.raw).toEqual(raw);
      expect(JSON.stringify(result)).not.toContain("test-key");
    },
  );

  it("leaves unknown usage/cost unknown and prices free output correctly when rates are supplied", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ model: "jev-version", answers: answers() }),
      )
      .mockResolvedValueOnce(
        Response.json({
          model: "jev-version",
          answers: answers(),
          usage: { input_tokens: 1000, output_tokens: 50 },
        }),
      );
    const backend = createJevBackend({
      provider: "typesafe",
      apiKey: "test",
      fetch: transport,
      costs: { promptTokens: 0.042, completionTokens: 0 },
    });
    const missing = await backend.judge(request);
    expect(missing.metadata.usage).toBeUndefined();
    expect(missing.metadata.cost).toBeUndefined();
    const priced = await backend.judge(request);
    expect(priced.metadata.cost?.usd).toBeCloseTo(0.000042);
    expect(priced.metadata.model).toBe("jev-version");
  });

  it("retains invalid response evidence rather than treating it as a prediction", async () => {
    const raw = { model: "jev-version", answers: {} };
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(raw));
    await expect(
      createJevBackend({
        provider: "openrouter",
        apiKey: "test",
        fetch: transport,
      }).judge(request),
    ).rejects.toMatchObject({
      kind: "invalid-response",
      details: { raw },
    });
  });

  it.each([401, 402, 429, 529])(
    "records HTTP %s as failure, with no hidden retries or body leakage",
    async (status) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("sensitive gateway body", { status }));
      await expect(
        createJevBackend({
          provider: "openrouter",
          apiKey: "test",
          fetch: transport,
        }).judge(request),
      ).rejects.toThrow(`Decisions HTTP ${status}`);
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );

  it("does not call the service after cancellation", async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(
      createJevBackend({
        provider: "typesafe",
        apiKey: "test",
        fetch: transport,
      }).judge(request, { signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("generated baseline", () => {
  it("uses an isolated Interaction, forwards cancellation, and validates generated probabilities", async () => {
    const generate = vi
      .spyOn(Interaction.prototype, "generateObject")
      .mockResolvedValue({
        content: JSON.stringify(answers()),
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          provider: "mycel",
          model: "test-model",
          tokenUsage: { promptTokens: 0, completionTokens: 0 },
        },
      });
    const signal = new AbortController().signal;
    const backend = createLlmJudgmentBackend({
      provider: "mycel",
      name: "test-model",
    });
    const result = await backend.judge(request, { signal });
    expect(generate.mock.calls[0][1]).toBe(signal);
    expect(result.metadata.probabilitySource).toBe("generated");
    expect(result.metadata.usage).toBeUndefined();
    expect(result.metadata.cost).toBeUndefined();
    expect(
      (generate.mock.contexts[0] as Interaction).getMessages(),
    ).toHaveLength(2);
    await backend.judge(request);
    expect(generate.mock.instances[0]).not.toBe(generate.mock.instances[1]);
    generate.mockResolvedValueOnce({
      ...(result.raw as Awaited<ReturnType<Interaction["generateObject"]>>),
      content: JSON.stringify({}),
    });
    await expect(backend.judge(request)).rejects.toThrow();
  });
});
