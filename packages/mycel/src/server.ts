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
import { createClientSurfaceHandler } from "./client-surface/serve.js";
import { createBuyerHandler, type BuyerHandlerOptions } from "./buyer/handler.js";
import { createModelsHandler } from "./buyer/models.js";
import { ConnectionRegistry } from "./supply/connections.js";
import { attachConnectionServer } from "./supply/connection-server.js";
import { createConnectionTransport } from "./supply/connection-transport.js";
import { createHttpTransport } from "./buyer/transport.js";
import type { ExchangeStore } from "./store/types.js";
import type { Supplier } from "./types.js";

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
  opts: Pick<ExchangeServerOptions, "verifyCaller" | "staleAfterMs" | "resolveTransport"> & {
    connections?: ConnectionRegistry;
  } = {},
) {
  // Which transport a Supplier gets is decided by its kind, and nothing further
  // down asks. A vendor is dialled out to because a public API is reachable by
  // definition; a machine is served over the Connection it dialled in on
  // (ADR 0023).
  const connections = opts.connections;
  const resolveTransport =
    opts.resolveTransport ??
    (connections
      ? (() => {
          const http = createHttpTransport({ readCredential: (name) => name && process.env[name] });
          const overConnection = createConnectionTransport({ registry: connections });
          return (supplier: Supplier) =>
            supplier.kind === "agent" ? overConnection(supplier) : http(supplier);
        })()
      : undefined);

  const handlers = [
    // The Client surface (ADR 0026, #409): the standard Shell plus read-only
    // components over /health and /v1/models. Serves static assets only —
    // no new endpoints, and nothing that moves money.
    createClientSurfaceHandler(),
    createSupplyHandler({ store }),
    createModelsHandler({ store }),
    createBuyerHandler({
      store,
      verifyCaller: opts.verifyCaller,
      staleAfterMs: opts.staleAfterMs,
      resolveTransport,
      // Connected is available; disconnected is withdrawn. Passed in rather
      // than reached for, so Dispatch stays a pure function (ADR 0023).
      connectedSupplierIds: connections
        ? () => connections.connectedSupplierIds()
        : undefined,
    }),
  ];

  return async function handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (req.method === "GET" && (req.url ?? "/").split("?")[0] === "/") {
      // A person landing on the Exchange's hostname gets the Client surface.
      res.writeHead(302, { location: "/shell/" });
      res.end();
      return;
    }
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
  // Machine Suppliers dial in on the same port. Empty on boot, which is the
  // correct state: nothing is connected, because nothing is.
  const connections = new ConnectionRegistry({ store: opts.store });

  const app = createExchangeApp(opts.store, {
    verifyCaller: opts.verifyCaller,
    staleAfterMs: opts.staleAfterMs,
    resolveTransport: opts.resolveTransport,
    connections,
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
