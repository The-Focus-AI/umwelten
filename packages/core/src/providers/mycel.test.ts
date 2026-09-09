/**
 * The Exchange provider, against a stand-in for the Exchange.
 *
 * Deliberately not the real `@umwelten/mycel`: `core` sits at the root of
 * the dependency DAG and importing a package that depends on it would create
 * the repo's first cycle. That constraint is the point of the last assertion
 * here — the whole relationship is one HTTP call, so a fake that speaks the
 * same shape is a faithful test.
 */

import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import {
  embed,
  experimental_transcribe,
  generateImage,
  generateText,
  stepCountIs,
  tool,
} from "ai";
import { z } from "zod";
import { createMycelAI, createMycelProvider } from "./mycel.js";

let server: http.Server | undefined;

async function startFakeExchange(
  respond: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<string> {
  server = http.createServer(respond);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe("MycelProvider", () => {
  it("lists models from the Exchange catalogue", async () => {
    const url = await startFakeExchange((req, res) => {
      expect(req.url).toBe("/v1/models");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [
            {
              id: "gemma-4-26b",
              object: "model",
              pricing: { prompt: 0.1, completion: 0.4 },
              capabilities: ["chat", "tool-calling"],
              guarantees: ["on-premise"],
              context_length: 131072,
            },
          ],
        }),
      );
    });

    const models = await createMycelProvider(undefined, url).listModels();
    expect(models).toHaveLength(1);
    expect(models[0].provider).toBe("mycel");
    expect(models[0].name).toBe("gemma-4-26b");
    expect(models[0].contextLength).toBe(131072);
    // Retail — what a buyer is charged, not what the Supplier is owed.
    expect(models[0].costs?.promptTokens).toBe(0.1);
    expect(models[0].costs?.completionTokens).toBe(0.4);
  });

  it("lists without a credential", async () => {
    // The catalogue is not secret. Requiring a key to list would mean a client
    // cannot discover what it may ask for before it asks.
    const url = await startFakeExchange((req, res) => {
      expect(req.headers.authorization).toBeUndefined();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [] }));
    });

    await expect(createMycelProvider(undefined, url).listModels()).resolves.toEqual([]);
  });

  it("presents a credential when it has one", async () => {
    let seen: string | undefined;
    const url = await startFakeExchange((req, res) => {
      seen = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [] }));
    });

    await createMycelProvider("app-token", url).listModels();
    expect(seen).toBe("Bearer app-token");
  });

  it("surfaces an Exchange error rather than returning an empty catalogue", async () => {
    // An empty list and a broken Exchange must not look the same — one means
    // "nothing to serve", the other means "ask again later".
    const url = await startFakeExchange((_req, res) => {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no_eligible_offer" }));
    });

    await expect(createMycelProvider(undefined, url).listModels()).rejects.toThrow(
      /Exchange API error/,
    );
  });

  it("builds a language model pointed at the Exchange's /v1", async () => {
    const url = await startFakeExchange((_req, res) => res.end("{}"));
    const model = createMycelProvider("k", url, "test-user").getLanguageModel({
      name: "gemma-4-26b",
      provider: "mycel",
    });
    expect(model).toBeDefined();
  });

  it("attributes Habitat completion calls to a stable Mycel End User", async () => {
    let endUser: string | undefined;
    const url = await startFakeExchange((req, res) => {
      endUser = req.headers["x-mycel-end-user"] as string | undefined;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "completion-1",
          object: "chat.completion",
          created: 1,
          model: "gemma-4-26b",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "hello" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
    });
    const model = createMycelProvider(
      "app-token",
      url,
      "habitat-twitter",
    ).getLanguageModel({ name: "gemma-4-26b", provider: "mycel" });

    await generateText({ model, prompt: "hi" });

    expect(endUser).toBe("habitat-twitter");
  });

  it("completes an AI SDK 7 multi-step tool round trip", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const url = await startFakeExchange(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw) as Record<string, unknown>;
      bodies.push(body);
      const secondStep = bodies.length === 2;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: `completion-${bodies.length}`,
          object: "chat.completion",
          created: 1,
          model: "tool-model",
          choices: [
            secondStep
              ? {
                  index: 0,
                  message: { role: "assistant", content: "The answer is 42." },
                  finish_reason: "stop",
                }
              : {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "call-1",
                        type: "function",
                        function: {
                          name: "multiply",
                          arguments: JSON.stringify({ a: 6, b: 7 }),
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
    });
    const mycel = createMycelAI({
      apiKey: "application-key",
      endUser: "walking-thoughts:user-1",
      baseUrl: url,
    });
    const result = await generateText({
      model: mycel("tool-model"),
      prompt: "What is 6 × 7?",
      tools: {
        multiply: tool({
          inputSchema: z.object({ a: z.number(), b: z.number() }),
          execute: async ({ a, b }) => ({ product: a * b }),
        }),
      },
      stopWhen: stepCountIs(2),
    });

    expect(result.text).toBe("The answer is 42.");
    expect(bodies).toHaveLength(2);
  });

  it("provides AI SDK embedding, image, and transcription models", async () => {
    const paths: string[] = [];
    const endUsers: Array<string | undefined> = [];
    const url = await startFakeExchange(async (req, res) => {
      paths.push(req.url ?? "");
      endUsers.push(req.headers["x-mycel-end-user"] as string | undefined);
      for await (const _chunk of req) {
        // Consume multipart and JSON bodies so the SDK can finish its upload.
      }
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/v1/embeddings") {
        res.end(
          JSON.stringify({
            object: "list",
            data: [{ object: "embedding", index: 0, embedding: [0.2, 0.8] }],
            model: "embed-model",
            usage: { prompt_tokens: 1, total_tokens: 1 },
          }),
        );
      } else if (req.url === "/v1/images/generations") {
        res.end(JSON.stringify({ created: 1, data: [{ b64_json: "aW1hZ2U=" }] }));
      } else {
        res.end(JSON.stringify({ text: "hello", language: "en", duration: 1 }));
      }
    });
    const mycel = createMycelAI({
      apiKey: "application-key",
      endUser: "walking-thoughts:user-1",
      baseUrl: url,
    });

    const embedding = await embed({
      model: mycel.embedding("embed-model"),
      value: "remember this",
    });
    const image = await generateImage({
      model: mycel.image("image-model"),
      prompt: "mycelium",
    });
    const transcript = await experimental_transcribe({
      model: mycel.transcription("transcribe-model"),
      audio: new Uint8Array([82, 73, 70, 70]),
    });

    expect(embedding.embedding).toEqual([0.2, 0.8]);
    expect(image.image.base64).toBe("aW1hZ2U=");
    expect(transcript.text).toBe("hello");
    expect(paths).toEqual([
      "/v1/embeddings",
      "/v1/images/generations",
      "/v1/audio/transcriptions",
    ]);
    expect(endUsers).toEqual([
      "walking-thoughts:user-1",
      "walking-thoughts:user-1",
      "walking-thoughts:user-1",
    ]);
  });

  it("tolerates a trailing slash on the base URL", async () => {
    const url = await startFakeExchange((req, res) => {
      // Not "/v1//models".
      expect(req.url).toBe("/v1/models");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [] }));
    });

    await createMycelProvider(undefined, `${url}/`).listModels();
  });
});
