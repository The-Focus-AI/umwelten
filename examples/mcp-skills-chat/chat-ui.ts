/**
 * Chat UI for an umwelten skills agent.
 *
 * A thin web client: it serves one page and forwards `/api/*` to the agent's
 * host API (`agent.ts`). It holds no model, no MCP connections, and no state;
 * the agent owns all of that and would keep running without it.
 *
 *   pnpm tsx examples/mcp-skills-chat/chat-ui.ts --port 7700 --agent http://127.0.0.1:7702
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export interface RunningChatUi {
  url: string;
  close(): Promise<void>;
}

export async function startChatUi(options: { port?: number; agentUrl: string }): Promise<RunningChatUi> {
  const agentUrl = options.agentUrl.replace(/\/$/, "");
  const page = fileURLToPath(new URL("./ui/index.html", import.meta.url));
  /** Markdown renderer for the page, served from the installed `marked` package. */
  const markedJs = createRequire(import.meta.url).resolve("marked").replace(/[^/]*$/, "marked.esm.js");

  const http: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(await readFile(page, "utf-8"));
        return;
      }
      if (req.method === "GET" && url.pathname === "/vendor/marked.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "max-age=3600" });
        res.end(await readFile(markedJs, "utf-8"));
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        let body: string | undefined;
        if (req.method !== "GET" && req.method !== "HEAD") {
          body = "";
          for await (const chunk of req) body += chunk;
        }
        const upstream = await fetch(agentUrl + url.pathname + url.search, {
          method: req.method,
          headers: { "content-type": "application/json" },
          body,
        });
        res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
        res.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      res.writeHead(404).end();
    } catch (error) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `Agent at ${agentUrl} is unreachable: ${String(error)}` }));
    }
  });
  await new Promise<void>((r) => http.listen(options.port ?? 7700, "127.0.0.1", r));
  const address = http.address();
  return {
    url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : options.port}`,
    async close() {
      http.closeAllConnections();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      port: { type: "string", default: "7700" },
      agent: { type: "string", default: "http://127.0.0.1:7702" },
    },
  });
  const ui = await startChatUi({ port: Number(values.port), agentUrl: values.agent });
  console.log(`Chat UI: ${ui.url} → agent ${values.agent}`);
}
