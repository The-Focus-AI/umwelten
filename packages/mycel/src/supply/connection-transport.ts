/**
 * Serving a request over a machine's held Connection.
 *
 * This is the other half of the seam in `buyer/transport.ts`. The relay asks
 * for a `Response` and meters whatever comes back; a vendor's comes from
 * `fetch`, and a machine's comes from here. **The money path does not know the
 * difference**, which is the entire reason that seam exists: prompt counted at
 * admission, completion counted per chunk, Balance enforced during generation,
 * every exit path recorded — all of it already operates on a `Response` and
 * none of it changes to accommodate a socket.
 *
 * A dropped Connection mid-stream is therefore not a special case. It is a body
 * that ends early, which the relay already records as `supply-failed` and the
 * Exchange already bears (ADR 0025). No buffering, no replay, no re-dispatch:
 * the machine is a laptop and laptops close.
 *
 * One Connection carries many requests at once, so every frame is keyed by an
 * id and each request owns its own stream controller. Interleaving two buyers'
 * tokens would be the worst bug this file could have, and the id is what
 * prevents it.
 */

import { randomUUID } from "node:crypto";
import type { Supplier } from "../types.js";
import type { SupplierTransport, ResolveTransport } from "../buyer/transport.js";
import type { Connection, ConnectionRegistry } from "./connections.js";
import {
  parseFrame,
  type AgentFrame,
  type CancelFrame,
  type RequestFrame,
} from "./wire.js";

/** How long to wait for the machine's runtime to answer at all. */
const RESPONSE_HEAD_TIMEOUT_MS = 60_000;

/** One request in flight on one Connection. */
interface Pending {
  /** Resolves when the machine reports a status, so the relay gets a Response. */
  settle: (response: Response) => void;
  fail: (error: Error) => void;
  /** Feeds the body as chunks arrive. Undefined until the head frame lands. */
  controller?: ReadableStreamDefaultController<Uint8Array>;
  settled: boolean;
  /** Release this request's slot in the in-flight count, exactly once. */
  release: () => void;
}

/**
 * Route agent frames to the request that is waiting for them.
 *
 * Installed once per Connection rather than once per request: a socket has one
 * message listener, and a per-request listener would leak one for every request
 * the machine ever served.
 */
class ConnectionMultiplexer {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly connection: Connection) {
    connection.channel.onMessage((raw) => this.onFrame(raw));
    // A Connection ending mid-stream ends every body riding on it. Each one
    // becomes a truncated response the relay records as a supply failure — the
    // buyer's stream stops where the tokens stopped.
    connection.channel.onClose(() => {
      for (const id of [...this.pending.keys()]) {
        this.abandon(id, new Error("connection closed"));
      }
    });
  }

  track(id: string, entry: Pending): void {
    this.pending.set(id, entry);
  }

  private onFrame(raw: string): void {
    const frame = parseFrame<AgentFrame>(raw);
    if (!frame || !("id" in frame)) return;

    const entry = this.pending.get(frame.id);
    // A frame for a request that already finished is not an error worth
    // surfacing: cancellation and the machine's last chunk race by nature.
    if (!entry) return;

    switch (frame.type) {
      case "response-head": {
        if (entry.settled) return;
        entry.settled = true;
        const body = new ReadableStream<Uint8Array>({
          start: (controller) => {
            entry.controller = controller;
          },
        });
        entry.settle(
          new Response(body, { status: frame.status, headers: frame.headers ?? {} }),
        );
        return;
      }
      case "chunk": {
        // Enqueued the moment it arrives. Buffering here would defeat the point
        // of streaming and would also break mid-stream credit enforcement,
        // which only works because the relay sees tokens as they are produced.
        entry.controller?.enqueue(new TextEncoder().encode(frame.data));
        return;
      }
      case "end": {
        this.finish(frame.id, () => entry.controller?.close());
        return;
      }
      case "request-error": {
        this.abandon(frame.id, new Error(frame.message));
        return;
      }
    }
  }

  /** End a request normally. */
  private finish(id: string, close: () => void): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    entry.release();
    try {
      close();
    } catch {
      /* already closed by an abort */
    }
  }

  /**
   * End a request badly.
   *
   * Before the head frame this rejects, so the relay sees a transport failure.
   * After it, the body errors — which reaches the relay as a stream that ended
   * early, and that is deliberately the same shape as a vendor's connection
   * dying mid-response.
   */
  private abandon(id: string, error: Error): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    entry.release();
    if (!entry.settled) {
      entry.settled = true;
      entry.fail(error);
      return;
    }
    try {
      entry.controller?.error(error);
    } catch {
      /* already closed */
    }
  }

  cancel(id: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    send(this.connection, { type: "cancel", id } satisfies CancelFrame);
    this.abandon(id, new Error("cancelled"));
  }
}

function send(connection: Connection, frame: unknown): void {
  connection.channel.send(JSON.stringify(frame));
}

/**
 * One multiplexer per Connection, for as long as that Connection lives.
 *
 * Keyed by the Connection object rather than the supplier id: a machine that
 * reconnects gets a new Connection, and reusing the old multiplexer would point
 * new requests at a dead socket's pending map.
 */
export function createConnectionTransport(opts: {
  registry: ConnectionRegistry;
  responseHeadTimeoutMs?: number;
  newId?: () => string;
}): ResolveTransport {
  const multiplexers = new WeakMap<Connection, ConnectionMultiplexer>();
  const headTimeoutMs = opts.responseHeadTimeoutMs ?? RESPONSE_HEAD_TIMEOUT_MS;
  const newId = opts.newId ?? (() => randomUUID());

  return (supplier: Supplier): SupplierTransport => {
    return async (body, signal) => {
      const connection = opts.registry.get(supplier.id);
      // Dispatch should not have selected a disconnected machine (#381), so
      // this is a race — it disconnected between selection and relay — rather
      // than a routing mistake. Either way nothing was consumed.
      if (!connection) throw new Error(`supplier ${supplier.id} is not connected`);

      let multiplexer = multiplexers.get(connection);
      if (!multiplexer) {
        multiplexer = new ConnectionMultiplexer(connection);
        multiplexers.set(connection, multiplexer);
      }

      const id = newId();
      // Counted before the frame goes out, so the count is never lower than
      // what the machine is actually working on. Released on every ending —
      // normal, truncated, cancelled — by whoever ends it.
      const release = opts.registry.trackInFlight(supplier.id);

      const response = new Promise<Response>((resolve, reject) => {
        multiplexer.track(id, { settle: resolve, fail: reject, settled: false, release });
      });

      // The buyer hanging up and credit running out both arrive here, and both
      // mean the same thing to the machine: stop. Left unsent, it would keep
      // generating tokens nobody receives and nobody pays for.
      const onAbort = () => multiplexer.cancel(id);
      signal.addEventListener("abort", onAbort, { once: true });

      const timeout = setTimeout(() => multiplexer.cancel(id), headTimeoutMs);
      timeout.unref?.();

      send(connection, { type: "request", id, body } satisfies RequestFrame);

      try {
        const settled = await response;
        // Only the head is timed. Generation itself may legitimately take
        // longer than any timeout worth setting, and the relay is already
        // watching the stream.
        clearTimeout(timeout);
        return settled;
      } catch (error) {
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        throw error;
      }
    };
  };
}
