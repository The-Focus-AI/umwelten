import { afterEach, describe, expect, it, vi } from "vitest";
import { tool, type Tool } from "ai";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHabitatMcpServer } from "./mcp-local-server.js";
import type { Habitat } from "./habitat.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function versionTool(version: number): Tool {
  return tool({
    description: "Return the current version",
    inputSchema: z.object({}),
    execute: async () => ({ version }),
  });
}

describe("live Habitat MCP tools", () => {
  it("observes add, replace, and removal without restarting the server", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const stable = versionTool(0);
    let tools: Record<string, Tool> = { stable };
    const habitat = {
      getTools: () => ({ ...tools }),
    } as Habitat;
    const server = await startHabitatMcpServer({
      habitat,
      host: "127.0.0.1",
      port: 0,
    });
    const client = new Client({ name: "live-tools-test", version: "0.0.0" });

    try {
      await client.connect(
        new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${server.port}/mcp`),
        ),
      );
      expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([
        "stable",
      ]);

      tools = { stable, current_version: versionTool(1) };
      expect(
        (await client.listTools()).tools.map(({ name }) => name).sort(),
      ).toEqual(["current_version", "stable"]);
      let result = await client.callTool({
        name: "current_version",
        arguments: {},
      });
      expect(result.content).toEqual([
        { type: "text", text: '{\n  "version": 1\n}' },
      ]);

      tools = { stable, current_version: versionTool(2) };
      result = await client.callTool({
        name: "current_version",
        arguments: {},
      });
      expect(result.content).toEqual([
        { type: "text", text: '{\n  "version": 2\n}' },
      ]);

      tools = { stable };
      expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([
        "stable",
      ]);
    } finally {
      await client.close();
      server.close();
    }
  });
});
