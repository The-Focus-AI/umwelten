/**
 * Dialling in to the Exchange.
 *
 * The machine opens the Connection and holds it; the Exchange never connects
 * here, and this box accepts no inbound connections at all (ADR 0023). That is
 * the whole onboarding story — no tunnel, no ACL, no DNS, no firewall rule, and
 * it works from a coffee shop and from behind a corporate proxy, because it is
 * an outbound WebSocket over 443.
 *
 * The wire types are declared here and again in `@umwelten/mycel`, deliberately.
 * This package must not depend on the Exchange — a machine someone else owns
 * should never install a Postgres driver to sell tokens — so the wire is the
 * contract and `WIRE_VERSION` is what catches the two definitions drifting.
 */

import WebSocket from "ws";
import { createConnectionServer, type ServeEvent } from "./serve-connection.js";
import type { OfferDraft } from "./types.js";

export type { ServeEvent } from "./serve-connection.js";

/** Must match the Exchange's. Bumped when a frame's meaning changes. */
export const WIRE_VERSION = 1;
export const CONNECT_PATH = "/suppliers/connect";

export interface DialOptions {
  exchangeUrl: string;
  credential: string;
  agentVersion?: string;
  /** Backoff floor and ceiling. A dropped link should retry, not hammer. */
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /**
   * Close and redial when the Exchange's ping stream goes silent. The server
   * pings every 30 seconds; waiting for two missed pings avoids reconnecting
   * merely because one timer ran late.
   */
  heartbeatTimeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: DialEvent) => void;
  /** Injectable for tests; defaults to a real socket. */
  connect?: (url: string, credential: string) => DialSocket;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Where the local runtime listens. Without it this holds the Connection and
   * serves nothing — which is a legitimate way to run it while the rest of the
   * relay is being built, but not a Supplier anyone can buy from.
   */
  runtimeUrl?: string;
  runtimeCredential?: string;
  fetchImpl?: typeof fetch;
  onServeEvent?: (event: ServeEvent) => void;
  /**
   * This machine's catalogue, sent with the handshake so availability and
   * catalogue arrive together.
   *
   * Read from the cached probe, so reconnecting costs no measurement — the
   * agent re-probes only when its own fingerprint changes. Omitting this
   * entirely leaves the stored Offers alone, which is what a machine whose
   * catalogue the operator publishes on its behalf needs.
   */
  offers?: OfferDraft[];
  /** Echoed for confirmation. The operator's grant decides (ADR 0012). */
  guarantees?: string[];
}

export type DialEvent =
  | { type: "connecting"; attempt: number }
  | { type: "connected" }
  | { type: "disconnected"; code?: number; reason?: string }
  | { type: "refused"; status?: number; reason: string }
  | { type: "retrying"; inMs: number };

/** The little of a socket this needs, so tests need no server. */
export interface DialSocket {
  send(data: string): void;
  close(): void;
  terminate(): void;
  onOpen(listener: () => void): void;
  onMessage(listener: (data: string) => void): void;
  onPing(listener: () => void): void;
  onClose(listener: (code?: number, reason?: string) => void): void;
  onError(listener: (error: Error) => void): void;
}

const DEFAULT_MIN_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 75_000;

function websocketUrl(exchangeUrl: string): string {
  const url = new URL(CONNECT_PATH, exchangeUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function realSocket(url: string, credential: string): DialSocket {
  const ws = new WebSocket(url, {
    headers: { authorization: `Bearer ${credential}` },
  });
  return {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    terminate: () => ws.terminate(),
    onOpen: (l) => ws.on("open", l),
    onMessage: (l) => ws.on("message", (raw) => l(String(raw))),
    onPing: (l) => ws.on("ping", l),
    onClose: (l) =>
      ws.on("close", (code, reason) => l(code, String(reason ?? ""))),
    onError: (l) => ws.on("error", l),
  };
}

/**
 * Hold a Connection open, reconnecting until told to stop.
 *
 * Resolves only when the abort signal fires. A dropped link is the routine case
 * — this is a laptop and laptops close — so it is retried rather than reported
 * as a failure, with backoff so a Exchange that is down is not hammered by
 * every machine at once.
 */
export async function dialIn(opts: DialOptions): Promise<void> {
  const {
    exchangeUrl,
    credential,
    agentVersion,
    signal,
    onEvent = () => {},
    connect = realSocket,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  } = opts;

  const minBackoff = opts.minBackoffMs ?? DEFAULT_MIN_BACKOFF_MS;
  const maxBackoff = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const url = websocketUrl(exchangeUrl);

  let attempt = 0;
  let backoff = minBackoff;

  while (!signal?.aborted) {
    attempt += 1;
    onEvent({ type: "connecting", attempt });

    const outcome = await holdOne(url, credential, {
      agentVersion,
      signal,
      onEvent,
      connect,
      runtimeUrl: opts.runtimeUrl,
      runtimeCredential: opts.runtimeCredential,
      fetchImpl: opts.fetchImpl,
      onServeEvent: opts.onServeEvent,
      offers: opts.offers,
      guarantees: opts.guarantees,
      heartbeatTimeoutMs:
        opts.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
    });

    if (signal?.aborted) return;

    // A Connection that lived resets the backoff: a machine that has been up
    // for hours and drops once should come straight back, not wait thirty
    // seconds because of an outage last week.
    backoff =
      outcome === "connected" ? minBackoff : Math.min(backoff * 2, maxBackoff);

    onEvent({ type: "retrying", inMs: backoff });
    await sleep(backoff);
  }
}

/** One connection attempt, from dial to close. */
function holdOne(
  url: string,
  credential: string,
  ctx: {
    agentVersion?: string;
    signal?: AbortSignal;
    onEvent: (event: DialEvent) => void;
    connect: (url: string, credential: string) => DialSocket;
    runtimeUrl?: string;
    runtimeCredential?: string;
    fetchImpl?: typeof fetch;
    onServeEvent?: (event: ServeEvent) => void;
    offers?: OfferDraft[];
    guarantees?: string[];
    heartbeatTimeoutMs: number;
  },
): Promise<"connected" | "failed"> {
  return new Promise((resolve) => {
    let settled = false;
    let everConnected = false;
    let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (outcome: "connected" | "failed") => {
      if (settled) return;
      settled = true;
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      resolve(outcome);
    };

    let socket: DialSocket;
    try {
      socket = ctx.connect(url, credential);
    } catch (error) {
      ctx.onEvent({
        type: "refused",
        reason: error instanceof Error ? error.message : String(error),
      });
      finish("failed");
      return;
    }

    const hangUp = () => socket.close();
    ctx.signal?.addEventListener("abort", hangUp, { once: true });

    const expectHeartbeat = () => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(
        () => socket.terminate(),
        ctx.heartbeatTimeoutMs,
      );
      heartbeatTimer.unref?.();
    };

    // Scoped to this Connection. A machine that reconnects gets a fresh one,
    // because nothing in flight on the old socket can be delivered.
    const server = ctx.runtimeUrl
      ? createConnectionServer({
          runtimeUrl: ctx.runtimeUrl,
          runtimeCredential: ctx.runtimeCredential,
          fetchImpl: ctx.fetchImpl,
          send: (frame) => socket.send(frame),
          onEvent: ctx.onServeEvent,
        })
      : undefined;

    socket.onOpen(() => {
      expectHeartbeat();
      // The catalogue rides the handshake. The Exchange registers this machine
      // only once it has accepted both, so it never believes a machine is
      // available without knowing what it serves.
      socket.send(
        JSON.stringify({
          type: "hello",
          wireVersion: WIRE_VERSION,
          agentVersion: ctx.agentVersion,
          offers: ctx.offers,
          guarantees: ctx.guarantees,
        }),
      );
    });

    socket.onMessage((data) => {
      expectHeartbeat();
      const frame = safeParse(data);
      if (frame?.type === "welcome") {
        everConnected = true;
        ctx.onEvent({ type: "connected" });
        return;
      }
      if (frame?.type === "goodbye") {
        // The Exchange refusing us for a stated reason — a wire mismatch, say.
        // Worth surfacing rather than showing up as a bare close code.
        ctx.onEvent({
          type: "refused",
          reason: String(frame.reason ?? "refused"),
        });
        return;
      }
      // Everything else is work. Without a runtime configured this machine
      // holds the Connection and serves nothing, which is deliberate rather
      // than an error to report on every frame.
      server?.handleFrame(data);
    });

    // `ws` answers protocol pings automatically. Observing them separately is
    // what tells us the path is alive when no inference work is flowing.
    socket.onPing(expectHeartbeat);

    socket.onError((error) => {
      ctx.onEvent({ type: "refused", reason: error.message });
    });

    socket.onClose((code, reason) => {
      ctx.signal?.removeEventListener("abort", hangUp);
      // Stop generating for an Exchange that is no longer listening. Left
      // running, these would hold the GPU for responses nobody can receive.
      server?.stopAll();
      ctx.onEvent({ type: "disconnected", code, reason });
      finish(everConnected ? "connected" : "failed");
    });
  });
}

function safeParse(
  data: string,
): { type?: string; reason?: unknown } | undefined {
  try {
    const parsed = JSON.parse(data) as { type?: string; reason?: unknown };
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
