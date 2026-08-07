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
import { createMycelProvider } from "./mycel.js";

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
    const model = createMycelProvider("k", url).getLanguageModel({
      name: "gemma-4-26b",
      provider: "mycel",
    });
    expect(model).toBeDefined();
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
