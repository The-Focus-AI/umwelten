import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  createMycelAI,
  getPiModels,
  listMycelModels,
  loadPiModelsJsonInto,
  registerPiProvider,
  runPiStructuredObject,
  runPiTurn,
  tool,
} from "./models.js";

describe("@umwelten/pi direct Pi-AI helpers", () => {
  const savedEnv = { ...process.env };
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = undefined;
    }
    for (const k of Object.keys(process.env)) {
      if (!(k in savedEnv)) delete process.env[k];
    }
    Object.assign(process.env, savedEnv);
  });

  it("leaves maxTokens undefined on uncapped turns and passes explicit maxTokens when specified", async () => {
    const seenMaxTokens: Array<number | undefined> = [];
    const faux = fauxProvider({
      provider: "faux-cap-check",
      models: [{ id: "m1" }],
    });
    faux.setResponses([
      (_ctx, opts) => {
        seenMaxTokens.push(opts?.maxTokens);
        return fauxAssistantMessage("uncapped");
      },
      (_ctx, opts) => {
        seenMaxTokens.push(opts?.maxTokens);
        return fauxAssistantMessage("capped");
      },
    ]);
    registerPiProvider(faux.provider);

    await runPiTurn({
      model: { provider: "faux-cap-check", name: "m1" },
      prompt: "first",
    });
    await runPiTurn({
      model: { provider: "faux-cap-check", name: "m1" },
      prompt: "second",
      maxTokens: 250,
    });

    expect(seenMaxTokens).toEqual([undefined, 250]);
  });

  it("executes multi-step tool loops and constrained structured objects over pi-ai", async () => {
    const faux = fauxProvider({
      provider: "faux-tools",
      models: [{ id: "t1" }],
    });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("add", { a: 19, b: 23 })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("42"),
      fauxAssistantMessage(
        [fauxToolCall("__structured_output", { city: "Tokyo", pop: 14 })],
        { stopReason: "toolUse" },
      ),
    ]);
    registerPiProvider(faux.provider);

    const turn = await runPiTurn({
      model: { provider: "faux-tools", name: "t1" },
      prompt: "19 + 23",
      tools: {
        add: tool({
          description: "Add two numbers",
          inputSchema: z.object({ a: z.number(), b: z.number() }),
          execute: ({ a, b }) => ({ sum: a + b }),
        }),
      },
    });
    expect(turn.content).toBe("42");
    expect(turn.toolCalls).toHaveLength(1);

    const structured = await runPiStructuredObject({
      model: { provider: "faux-tools", name: "t1" },
      schema: z.object({ city: z.string(), pop: z.number() }),
      prompt: "Tokyo stats",
    });
    expect(structured.object).toEqual({ city: "Tokyo", pop: 14 });
  });

  it("loads ~/.pi/agent/models.json and talks to Mycel Exchange HTTP endpoints", async () => {
    expect(getPiModels().getProvider("minimax")).toBeDefined();
    expect(getPiModels().getProvider("openrouter")).toBeDefined();

    const dir = mkdtempSync(join(tmpdir(), "pi-models-cfg-"));
    try {
      const cfgPath = join(dir, "models.json");
      writeFileSync(
        cfgPath,
        JSON.stringify({
          providers: {
            "custom-gw": {
              baseUrl: "http://127.0.0.1:9999/v1",
              models: [{ id: "gw-1", contextWindow: 32768 }],
            },
          },
        }),
      );
      const m = createModels();
      loadPiModelsJsonInto(m, cfgPath);
      expect(m.getModel("custom-gw", "gw-1")?.contextWindow).toBe(32768);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    server = createServer((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            data: [{ id: "m-1", pricing: { prompt: 0.1, completion: 0.4 } }],
          }),
        );
        return;
      }
      if (req.url === "/v1/embeddings") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ embedding: [0.5, 0.25] }], model: "m-1" }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const listed = await listMycelModels("sk-1", baseUrl);
    expect(listed[0]?.name).toBe("m-1");

    const mycel = createMycelAI({ apiKey: "sk-1", endUser: "u-1", baseUrl });
    const emb = await mycel.embed("m-1", "hi");
    expect(emb.embedding).toEqual([0.5, 0.25]);
  });
});
