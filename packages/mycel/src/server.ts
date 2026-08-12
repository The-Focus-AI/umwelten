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
import { createBuyerHandler, type BuyerHandlerOptions } from "./buyer/handler.js";
import { createModelsHandler } from "./buyer/models.js";
import { ConnectionRegistry } from "./supply/connections.js";
import { attachConnectionServer } from "./supply/connection-server.js";
import type { ExchangeStore } from "./store/types.js";

/**
 * Mycel's port.
 *
 * In umwelten's 74xx block but **below 7440**, where Gaia begins assigning
 * ports sequentially to the habitat containers it manages. A fixed service
 * inside that range gets its port taken by whichever child Gaia starts next.
 */
export const DEFAULT_PORT = 7438;

export interface ExchangeServerOptions {
  store: ExchangeStore;
  port?: number;
  host?: string;
  /** Injectable identity verification, so tests need no JWKS endpoint. */
  verifyCaller?: BuyerHandlerOptions["verifyCaller"];
  staleAfterMs?: number;
  /**
   * How the relay reaches a Supplier. Defaults to an OpenAI-compatible POST at
   * its `baseUrl`; a machine Supplier's Connection supplies its own (ADR 0023).
   */
  resolveTransport?: BuyerHandlerOptions["resolveTransport"];
  /** How long a dialled-in socket may stay open without saying hello. */
  handshakeTimeoutMs?: number;
}

export interface RunningExchange {
  server: Server;
  port: number;
  url: string;
  /** Which machine Suppliers are connected right now (ADR 0023). */
  connections: ConnectionRegistry;
  close: () => Promise<void>;
}

export function createExchangeApp(
  store: ExchangeStore,
  opts: Pick<ExchangeServerOptions, "verifyCaller" | "staleAfterMs" | "resolveTransport"> = {},
) {
  const handlers = [
    createSupplyHandler({ store }),
    createModelsHandler({ store }),
    createBuyerHandler({
      store,
      verifyCaller: opts.verifyCaller,
      staleAfterMs: opts.staleAfterMs,
      resolveTransport: opts.resolveTransport,
    }),
  ];

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
  const app = createExchangeApp(opts.store, {
    verifyCaller: opts.verifyCaller,
    staleAfterMs: opts.staleAfterMs,
    resolveTransport: opts.resolveTransport,
  });
  await opts.store.setup();

  const server = http.createServer((req, res) => {
    app(req, res).catch(() => {
      if (!res.writableEnded) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal_error" }));
      }
    });
  });

  // Machine Suppliers dial in on the same port. Empty on boot, which is the
  // correct state: nothing is connected, because nothing is.
  const connections = new ConnectionRegistry({ store: opts.store });
  const connectionServer = attachConnectionServer({
    server,
    store: opts.store,
    registry: connections,
    handshakeTimeoutMs: opts.handshakeTimeoutMs,
  });

  const host = opts.host ?? "0.0.0.0";
  await new Promise<void>((resolve) => server.listen(opts.port ?? DEFAULT_PORT, host, resolve));

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : (opts.port ?? DEFAULT_PORT);

  return {
    server,
    port,
    url: `http://${host}:${port}`,
    connections,
    close: async () => {
      // Hang up on machines deliberately, so their last log entry says
      // `shutdown` rather than looking like every socket died at once.
      await connections.closeAll();
      connectionServer.close();
      await new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}
