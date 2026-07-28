/**
 * The Exchange as a listening service.
 *
 * A tracer bullet has to be demoable, and for an HTTP service that means you
 * can curl it. Everything the tests exercise runs in-process without this —
 * `createExchangeServer` only wires the same handlers to a socket.
 *
 * Deployment (where it runs, TLS, secrets) is #301.
 */

import http from "node:http";
import type { Server } from "node:http";
import { createSupplyHandler } from "./supply/handler.js";
import { createBuyerHandler } from "./buyer/handler.js";
import type { ExchangeStore } from "./store/types.js";

export interface ExchangeServerOptions {
  store: ExchangeStore;
  port?: number;
  host?: string;
}

export interface RunningExchange {
  server: Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

export function createExchangeApp(store: ExchangeStore) {
  const handlers = [createSupplyHandler({ store }), createBuyerHandler({ store })];

  return async function handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (req.url === "/health") {
      // Reports whether the store is reachable, not merely whether the process
      // is up — a service that answers while its database is gone is worse
      // than one that does not answer.
      try {
        await store.listSuppliers();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } catch (error) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            status: "degraded",
            store: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }

    for (const handler of handlers) {
      if (await handler(req, res)) return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  };
}

export async function createExchangeServer(
  opts: ExchangeServerOptions,
): Promise<RunningExchange> {
  const app = createExchangeApp(opts.store);
  await opts.store.setup();

  const server = http.createServer((req, res) => {
    app(req, res).catch(() => {
      if (!res.writableEnded) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal_error" }));
      }
    });
  });

  const host = opts.host ?? "0.0.0.0";
  await new Promise<void>((resolve) => server.listen(opts.port ?? 7450, host, resolve));

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : (opts.port ?? 0);

  return {
    server,
    port,
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
