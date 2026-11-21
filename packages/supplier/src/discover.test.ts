import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { discoverRuntimes, VllmAuthError } from "./discover.js";

describe("discoverRuntimes vLLM auth handling", () => {
  const savedEnv = { ...process.env };
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    for (const k of Object.keys(process.env)) {
      if (!(k in savedEnv)) delete process.env[k];
    }
    Object.assign(process.env, savedEnv);
  });

  it("throws VllmAuthError loudly on 401/403 instead of reporting vLLM unreachable", async () => {
    server = createServer((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid key" }));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    process.env.VLLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
    process.env.VLLM_API_KEY = "bad-key";

    await expect(discoverRuntimes(["vllm"])).rejects.toBeInstanceOf(
      VllmAuthError,
    );
  });
});
