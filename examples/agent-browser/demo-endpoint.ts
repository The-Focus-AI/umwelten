/**
 * Demo endpoint for the agent browser — one process that answers as BOTH
 * protocols, so the example works with no external servers and no keys:
 *
 *   - MCP server at        http://localhost:7434/mcp     (add + roll_dice tools)
 *   - A2A agent card at    http://localhost:7434/.well-known/agent-card.json
 *   - A2A message/send at  http://localhost:7434/a2a     (an echo valet)
 *
 *   pnpm tsx examples/agent-browser/demo-endpoint.ts
 *
 * Point the agent browser at http://localhost:7434/mcp to get the MCP face,
 * or http://localhost:7434 to get the A2A face.
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const port = Number(process.env.PORT ?? 7434);

const agentCard = {
  protocolVersion: "0.2.5",
  name: "Echo Valet",
  description: "A demo A2A agent that politely repeats whatever it is asked.",
  version: "1.0.0",
  url: `http://localhost:${port}/a2a`,
  capabilities: { streaming: false, pushNotifications: false },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [
    {
      id: "echo",
      name: "Echo",
      description: "Repeats your message back, with valet-grade courtesy.",
      tags: ["demo"],
    },
  ],
};

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = createServer((req, res) => {
  void (async () => {
    const path = new URL(req.url ?? "/", `http://localhost:${port}`).pathname;

    if (req.method === "GET" && path === "/.well-known/agent-card.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(agentCard));
      return;
    }

    if (req.method === "POST" && path === "/a2a") {
      const rpc = JSON.parse(await readBody(req));
      const parts: Array<{ kind?: string; text?: string }> =
        rpc?.params?.message?.parts ?? [];
      const asked = parts
        .filter((p) => p.kind === "text")
        .map((p) => p.text)
        .join(" ");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id ?? null,
          result: {
            kind: "message",
            messageId: randomUUID(),
            role: "agent",
            parts: [
              {
                kind: "text",
                text: `Very good. You said: "${asked}". Will there be anything else?`,
              },
            ],
          },
        }),
      );
      return;
    }

    if (path === "/mcp") {
      const raw = await readBody(req);
      let parsed: unknown;
      try {
        parsed = raw ? JSON.parse(raw) : undefined;
      } catch {
        res.writeHead(400).end();
        return;
      }
      const mcp = new McpServer({ name: "demo-tools", version: "1.0.0" });
      mcp.registerTool(
        "add",
        { description: "Add two numbers", inputSchema: { a: z.number(), b: z.number() } },
        async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
      );
      mcp.registerTool(
        "roll_dice",
        {
          description: "Roll N six-sided dice and return the results",
          inputSchema: { count: z.number().int().min(1).max(20) },
        },
        async ({ count }) => {
          const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * 6));
          return { content: [{ type: "text", text: JSON.stringify({ rolls, total: rolls.reduce((s, n) => s + n, 0) }) }] };
        },
      );
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, parsed);
      await transport.close();
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("try /mcp, /a2a, or /.well-known/agent-card.json");
  })().catch((err) => {
    if (!res.headersSent) {
      res.writeHead(500);
      res.end(String(err));
    }
  });
});

server.listen(port, () => {
  console.log(`demo endpoint: http://localhost:${port}`);
  console.log(`  MCP:        http://localhost:${port}/mcp`);
  console.log(`  A2A card:   http://localhost:${port}/.well-known/agent-card.json`);
});
