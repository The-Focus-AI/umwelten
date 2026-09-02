import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { fetchFromContainer, postToContainer } from "./proxy.js";
import type { GaiaHabitatEntry } from "./types.js";

const previousMode = process.env.GAIA_CHILD_ADDRESS_MODE;
let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
    server = undefined;
  }
  if (previousMode === undefined) delete process.env.GAIA_CHILD_ADDRESS_MODE;
  else process.env.GAIA_CHILD_ADDRESS_MODE = previousMode;
});

function entry(port: number): GaiaHabitatEntry {
  return {
    id: "local-child",
    name: "Local Child",
    config: { name: "Local Child", agents: [] },
    secretBindings: [],
    apiKey: "child-key",
    createdAt: "2026-09-02T00:00:00.000Z",
    containerPort: port,
  };
}

async function listen(): Promise<number> {
  server = createServer((request, response) => {
    expect(request.headers.authorization).toBe("Bearer child-key");
    if (request.method === "POST") {
      response.writeHead(204).end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  return address.port;
}

describe("host-run Gaia child requests", () => {
  it("fetches health through the child's published loopback port", async () => {
    process.env.GAIA_CHILD_ADDRESS_MODE = "loopback";
    const port = await listen();
    await expect(fetchFromContainer(entry(port), "/health")).resolves.toEqual({
      ok: true,
    });
  });

  it("posts internal events through the child's published loopback port", async () => {
    process.env.GAIA_CHILD_ADDRESS_MODE = "loopback";
    const port = await listen();
    await expect(
      postToContainer(entry(port), "/internal/preview-activity/a"),
    ).resolves.toBeUndefined();
  });
});
