/**
 * Same-process MCP test harness: an SDK 2.x `McpServer` behind
 * `createMcpHandler`, reachable either in-process (the handler's web-standard
 * `fetch`, no sockets) or over a real loopback HTTP port, plus helpers to
 * connect `RemoteMcpClient`s to it.
 *
 * Used by the protocol/habitat contract tests and the `mcp-skills-chat`
 * example's end-to-end run; also handy for any host that wants to embed a
 * local MCP server next to its client.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import type { SkillsExtension } from "@modelcontextprotocol/server/ext/skills";
import { RemoteMcpClient, type RemoteMcpClientOptions } from "./client/remote.js";

export interface TestMcpServerOptions {
  name?: string;
  version?: string;
  instructions?: string;
  /** Skills extension attached to every per-request server. */
  skills?: SkillsExtension;
  /**
   * Reject requests whose Host/Origin is not localhost (DNS-rebinding protection)
   * on the Node face. Default true: this harness serves same-host clients.
   */
  localhostOnly?: boolean;
  /** Register tools/resources/prompts on each per-request server. */
  register?: (server: McpServer) => void | Promise<void>;
}

export interface TestMcpServer {
  readonly handler: McpHttpHandler;
  /** Node `(req, res)` adapter over `handler`, for embedding in another http server. */
  readonly nodeHandler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  /** In-process URL; only meaningful together with `fetch`. */
  readonly url: string;
  /** Web-standard fetch that routes straight into the handler. */
  readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  /** Connect a `RemoteMcpClient` to this server in-process under `label`. */
  connect(label: string, options?: Partial<RemoteMcpClientOptions>): Promise<RemoteMcpClient>;
  /** Serve over real HTTP on 127.0.0.1 (port 0 = any); resolves the `/mcp` URL. */
  listen(port?: number): Promise<string>;
  close(): Promise<void>;
}

export function createTestMcpServer(options: TestMcpServerOptions = {}): TestMcpServer {
  const handler = createMcpHandler(async () => {
    const server = new McpServer(
      { name: options.name ?? "umwelten-test-server", version: options.version ?? "0.0.0" },
      options.instructions ? { instructions: options.instructions } : undefined,
    );
    options.skills?.attach(server);
    await options.register?.(server);
    return server;
  });
  const url = `http://in-process.test/${encodeURIComponent(options.name ?? "mcp")}/mcp`;
  const fetchImpl = (input: string | URL | Request, init?: RequestInit) =>
    handler.fetch(input instanceof Request ? input : new Request(input, init));
  let httpServer: Server | undefined;
  const clients: RemoteMcpClient[] = [];
  const sdkNode = toNodeHandler(handler);
  const checkHost = localhostHostValidation();
  const checkOrigin = localhostOriginValidation();
  const node = async (req: IncomingMessage, res: ServerResponse) => {
    if (options.localhostOnly !== false && (!checkHost(req, res) || !checkOrigin(req, res))) return;
    await sdkNode(req, res);
  };

  return {
    handler,
    nodeHandler: (req, res) => node(req, res),
    url,
    fetch: fetchImpl,
    async connect(label, clientOptions = {}) {
      const client = new RemoteMcpClient({
        serverUrl: url,
        label,
        interactiveAuth: false,
        fetch: fetchImpl,
        ...clientOptions,
      });
      await client.connect();
      clients.push(client);
      return client;
    },
    async listen(port = 0) {
      httpServer = createServer((req, res) => {
        if (new URL(req.url ?? "/", "http://x").pathname !== "/mcp") {
          res.writeHead(404).end();
          return;
        }
        void node(req, res);
      });
      await new Promise<void>((resolve) => httpServer!.listen(port, "127.0.0.1", resolve));
      const address = httpServer.address();
      const actual = typeof address === "object" && address ? address.port : port;
      return `http://127.0.0.1:${actual}/mcp`;
    },
    async close() {
      await Promise.all(clients.splice(0).map((c) => c.disconnect()));
      await handler.close();
      if (httpServer) {
        httpServer.closeAllConnections?.();
        await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
      }
    },
  };
}
