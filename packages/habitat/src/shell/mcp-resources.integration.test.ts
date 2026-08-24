/**
 * Components on the wire, verified with a STOCK MCP client (#406,
 * ADR 0032): the official SDK Client over Streamable HTTP against the same
 * per-request stateless server shape the container mounts. Nothing of ours
 * on the client side — the point is that any MCP client discovers and
 * fetches this habitat's components.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { listShellComponents, registerShellResources } from "./serve-shell.js";

let server: Server;
let baseUrl: string;
let customDir: string;

beforeAll(async () => {
  customDir = await mkdtemp(join(tmpdir(), "mcp-resources-"));
  await writeFile(join(customDir, "clock.js"), "export default { apply() {} };");

  // The container's /mcp shape: fresh stateless server per request, with
  // the shell roster re-enumerated each time (so created/removed custom
  // components appear and disappear without restarts).
  server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const mcp = new McpServer({ name: "resource-host", version: "1.0.0" });
    registerShellResources(
      mcp,
      await listShellComponents({ customComponentsDir: customDir }),
      "https://habitat.example",
      "resource-host",
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server?.close(r));
  await rm(customDir, { recursive: true, force: true });
});

async function stockClient(): Promise<Client> {
  const client = new Client({ name: "stock-test-client", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(baseUrl)),
  );
  return client;
}

describe("components as MCP resources", () => {
  it("resources/list names every panel in the ui://shell namespace — providers excluded", async () => {
    const client = await stockClient();
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri).sort();

    expect(uris).toContain("ui://shell/status");
    expect(uris).toContain("ui://shell/chat");
    expect(uris).toContain("ui://shell/secrets");
    expect(uris).toContain("ui://shell/sessions");
    expect(uris).toContain("ui://shell/custom:clock"); // agent-authored
    // Service-only providers render nothing and are not published.
    expect(uris).not.toContain("ui://shell/conversation");
    expect(uris).not.toContain("ui://shell/tools");
    await client.close();
  });

  it("resources/read returns the mcp-ui external-URL projection: the solo page", async () => {
    const client = await stockClient();
    const result = await client.readResource({ uri: "ui://shell/status" });
    expect(result.contents).toHaveLength(1);
    const content = result.contents[0];
    expect(content.mimeType).toBe("text/uri-list");
    expect(content.text).toBe("https://habitat.example/shell/solo/status/");
    await client.close();
  });

  it("an agent-authored component leaves the listing the moment its file is removed", async () => {
    const client = await stockClient();
    let { resources } = await client.listResources();
    expect(resources.some((r) => r.uri === "ui://shell/custom:clock")).toBe(true);
    await client.close();

    await rm(join(customDir, "clock.js"));

    const client2 = await stockClient();
    ({ resources } = await client2.listResources());
    expect(resources.some((r) => r.uri === "ui://shell/custom:clock")).toBe(false);
    await client2.close();

    // Restore for other tests.
    await writeFile(join(customDir, "clock.js"), "export default { apply() {} };");
  });
});
