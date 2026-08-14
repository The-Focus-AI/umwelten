/**
 * Where machine Suppliers dial in.
 *
 * A WebSocket upgrade on the Exchange's own port. The machine opens it outbound
 * and holds it; the Exchange never dials a machine, and the machine accepts no
 * inbound connections at all (ADR 0023).
 *
 * Authentication reuses the credential path the publish endpoint already uses —
 * hash the presented bearer, look the Supplier up by that hash, compare. One
 * auth path rather than two, because a second one is a second thing to get
 * wrong.
 */

import type { Server } from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { credentialsMatch, hashCredential } from "../auth/credentials.js";
import type { ExchangeStore } from "../store/types.js";
import type { ConnectionRegistry, Channel } from "./connections.js";
import {
  CLOSE,
  CONNECT_PATH,
  WIRE_VERSION,
  parseFrame,
  type HelloFrame,
} from "./wire.js";

/** How long a socket may stay open without saying hello. */
const HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * How often the Exchange pings a held Connection.
 *
 * Not a heartbeat in the sense ADR 0023 deletes — that one existed so the
 * Exchange could *infer* liveness from republishing. This is TCP-level, and it
 * exists because a NAT or load balancer will silently drop an idle connection
 * and neither end finds out until something is sent.
 */
const PING_INTERVAL_MS = 30_000;

export interface ConnectionServerOptions {
  server: Server;
  store: ExchangeStore;
  registry: ConnectionRegistry;
  /** Injectable so a test does not have to wait out the real one. */
  handshakeTimeoutMs?: number;
  pingIntervalMs?: number;
}

/** Refuse the upgrade before a WebSocket exists, so the client sees a status. */
function refuse(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function attachConnectionServer(opts: ConnectionServerOptions): { close: () => void } {
  const { server, store, registry } = opts;
  const handshakeTimeoutMs = opts.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const pingIntervalMs = opts.pingIntervalMs ?? PING_INTERVAL_MS;
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if ((req.url ?? "").split("?")[0] !== CONNECT_PATH) return;

    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return refuse(socket, 401, "Unauthorized");

    const presented = hashCredential(auth.slice("Bearer ".length).trim());
    const supplier = await store.getSupplierByCredentialHash(presented);
    if (!supplier || !credentialsMatch(supplier.credentialHash, presented)) {
      return refuse(socket, 401, "Unauthorized");
    }
    if (!supplier.enabled) {
      // Distinct from unauthorized, same as the publish path: the credential is
      // real, the Supplier is out of rotation. "Wrong key" and "you disabled
      // me" are different things to debug.
      return refuse(socket, 403, "Supplier Disabled");
    }
    if (supplier.kind !== "agent") {
      // A vendor is dialled out to, because a public API is reachable by
      // definition. Something dialling in with a vendor's credential is
      // misconfigured at best, and letting it hold a Connection would make
      // Dispatch believe in a transport that will never carry work.
      return refuse(socket, 403, "Not An Agent");
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      void onConnected(ws, supplier.id);
    });
  };

  async function onConnected(ws: WebSocket, supplierId: string): Promise<void> {
    // Nothing is registered until the machine says hello. A socket that opens
    // and goes quiet is not a Supplier the Exchange should route to.
    let registered = false;
    const handshake = setTimeout(() => {
      if (!registered) ws.close(CLOSE.BAD_HANDSHAKE, "no hello");
    }, handshakeTimeoutMs);
    // Never hold the process open on account of a socket that went quiet.
    handshake.unref?.();

    ws.once("message", async (raw) => {
      clearTimeout(handshake);
      const hello = parseFrame<HelloFrame>(String(raw));
      if (!hello || hello.type !== "hello") {
        ws.close(CLOSE.BAD_HANDSHAKE, "expected hello");
        return;
      }
      if (hello.wireVersion !== WIRE_VERSION) {
        // Refused rather than guessed at. A machine serving under a
        // misunderstood protocol is worse than one that failed to connect.
        send(ws, { type: "goodbye", reason: `wire version ${WIRE_VERSION} required` });
        ws.close(CLOSE.WIRE_VERSION, "wire version");
        return;
      }

      registered = true;
      await registry.connect(supplierId, channelFor(ws));
      send(ws, { type: "welcome", wireVersion: WIRE_VERSION, supplierId });
    });

    // Keep the socket warm. An idle connection through a NAT is dropped
    // silently, and neither end learns until something is sent.
    let alive = true;
    ws.on("pong", () => {
      alive = true;
    });
    const ping = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, pingIntervalMs);
    ping.unref?.();

    ws.once("close", () => {
      clearTimeout(handshake);
      clearInterval(ping);
    });
  }

  server.on("upgrade", (req, socket, head) => {
    void onUpgrade(req, socket as Duplex, head).catch(() => {
      // A failure while authenticating must not leave a half-open socket
      // attached to the process.
      try {
        (socket as Duplex).destroy();
      } catch {
        /* already gone */
      }
    });
  });

  return {
    close: () => {
      wss.close();
    },
  };
}

function send(ws: WebSocket, frame: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
}

/** Adapt a live socket to what the registry and the relay need from one. */
function channelFor(ws: WebSocket): Channel {
  return {
    close: () => ws.close(CLOSE.DISPLACED, "displaced"),
    send: (frame) => {
      if (ws.readyState === ws.OPEN) ws.send(frame);
    },
    // `on`, not `once`: the handshake consumed the first message, and every
    // frame after it is work.
    onMessage: (listener) => ws.on("message", (raw) => listener(String(raw))),
    onClose: (listener) => ws.once("close", (code: number) => listener(isCleanClose(code))),
  };
}

/**
 * Did the machine hang up, or did the link break?
 *
 * 1000 is a stated normal closure and 1005 is "closed with no code given",
 * which is what a deliberate `close()` with no arguments produces. Everything
 * else — 1006 above all, the code the runtime invents when a connection dies
 * without a close frame — is the link failing.
 */
function isCleanClose(code: number): boolean {
  return code === 1000 || code === 1005;
}
