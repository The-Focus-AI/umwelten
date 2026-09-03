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
import { createLandingHandler } from "./client-surface/landing.js";
import {
  createAccountSurfaceHandler,
  createClientSurfaceHandler,
} from "./client-surface/serve.js";
import {
  createCustomerHandler,
  type CustomerHandlerOptions,
} from "./customer/handler.js";
import {
  createBuyerHandler,
  type BuyerHandlerOptions,
} from "./buyer/handler.js";
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
  /** Injectable Clerk identity verification for customer-control tests. */
  verifyCustomerOperator?: CustomerHandlerOptions["verifyOperator"];
  clerkIssuer?: string;
  clerkAuthorizedParties?: string[];
  selfServiceCreditLimitMicroDollars?: number;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  publicOrigin?: string;
  staleAfterMs?: number;
  /**
   * How the relay reaches a Supplier. Defaults to an OpenAI-compatible POST at
   * its `baseUrl`; a machine Supplier's Connection supplies its own (ADR 0023).
   */
  resolveTransport?: BuyerHandlerOptions["resolveTransport"];
  /** How long a dialled-in socket may stay open without saying hello. */
  handshakeTimeoutMs?: number;
  /**
   * Directory of agent-authored client-surface components (#410) — served
   * live with mtime-versioned HMR. A dev-instance affordance; the deployed
   * surface promotes components into the repo instead.
   */
  componentsDir?: string;
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
  opts: Pick<
    ExchangeServerOptions,
    | "verifyCaller"
    | "verifyCustomerOperator"
    | "clerkIssuer"
    | "clerkAuthorizedParties"
    | "selfServiceCreditLimitMicroDollars"
    | "stripeSecretKey"
    | "stripeWebhookSecret"
    | "publicOrigin"
    | "staleAfterMs"
    | "resolveTransport"
    | "componentsDir"
  > & {
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
          const http = createHttpTransport({
            readCredential: (name) => name && process.env[name],
          });
          const overConnection = createConnectionTransport({
            registry: connections,
          });
          return (supplier: Supplier) =>
            supplier.kind === "agent"
              ? overConnection(supplier)
              : http(supplier);
        })()
      : undefined);

  const buyerHandler = createBuyerHandler({
    store,
    verifyCaller: opts.verifyCaller,
    staleAfterMs: opts.staleAfterMs,
    resolveTransport,
    // Connected is available; disconnected is withdrawn. Passed in rather
    // than reached for, so Dispatch stays a pure function (ADR 0023).
    connectedSupplierIds: connections
      ? () => connections.connectedSupplierIds()
      : undefined,
  });

  const handlers = [
    // The hostname root is the separately built marketing application. Its
    // static bundle also carries the trusted Clerk provider used by /account/.
    createLandingHandler(),
    // The customer console is an assembly on the same substrate as /shell/.
    // Its fixed providers may authenticate and mutate; no agent-authored
    // component directory enters this trust realm.
    createAccountSurfaceHandler(),
    createCustomerHandler({
      store,
      verifyOperator: opts.verifyCustomerOperator,
      clerkIssuer: opts.clerkIssuer ?? process.env.MYCEL_CLERK_ISSUER,
      authorizedParties:
        opts.clerkAuthorizedParties ??
        process.env.MYCEL_CLERK_AUTHORIZED_PARTIES?.split(",").map((party) =>
          party.trim(),
        ),
      completeChat: buyerHandler.handleAs,
      supplierConnection: connections
        ? (supplierId) => connections.get(supplierId)
        : undefined,
      defaultCreditLimitMicroDollars:
        opts.selfServiceCreditLimitMicroDollars ??
        Number(process.env.MYCEL_SELF_SERVICE_CREDIT_LIMIT_MICRO_DOLLARS ?? 0),
      stripeSecretKey:
        opts.stripeSecretKey ?? process.env.MYCEL_STRIPE_SECRET_KEY,
      stripeWebhookSecret:
        opts.stripeWebhookSecret ?? process.env.MYCEL_STRIPE_WEBHOOK_SECRET,
      publicOrigin: opts.publicOrigin ?? process.env.MYCEL_PUBLIC_ORIGIN,
    }),
    // The operational surface remains a provider-free, read-only assembly.
    createClientSurfaceHandler({ componentsDir: opts.componentsDir }),
    createSupplyHandler({ store }),
    createModelsHandler({
      store,
      connectedSupplierIds: connections
        ? () => connections.connectedSupplierIds()
        : undefined,
    }),
    buyerHandler,
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
  // Machine Suppliers dial in on the same port. Empty on boot, which is the
  // correct state: nothing is connected, because nothing is.
  const connections = new ConnectionRegistry({ store: opts.store });

  const app = createExchangeApp(opts.store, {
    verifyCaller: opts.verifyCaller,
    verifyCustomerOperator: opts.verifyCustomerOperator,
    clerkIssuer: opts.clerkIssuer,
    clerkAuthorizedParties: opts.clerkAuthorizedParties,
    selfServiceCreditLimitMicroDollars: opts.selfServiceCreditLimitMicroDollars,
    stripeSecretKey: opts.stripeSecretKey,
    stripeWebhookSecret: opts.stripeWebhookSecret,
    publicOrigin: opts.publicOrigin,
    staleAfterMs: opts.staleAfterMs,
    resolveTransport: opts.resolveTransport,
    componentsDir: opts.componentsDir,
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
  await new Promise<void>((resolve) =>
    server.listen(opts.port ?? DEFAULT_PORT, host, resolve),
  );

  const address = server.address();
  const port =
    typeof address === "object" && address
      ? address.port
      : (opts.port ?? DEFAULT_PORT);

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
