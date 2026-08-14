/**
 * Which machine Suppliers are connected, right now.
 *
 * A machine dials in and holds a Connection; the Exchange never dials it, and
 * it accepts no inbound connections at all (ADR 0023). Its being connected *is*
 * its availability — connected is available, disconnected is withdrawn, with no
 * staleness window to tune and no heartbeat to schedule.
 *
 * **Current state lives here and nowhere else.** There is no `connected` column
 * and there will not be one: a boolean written before a crash still reads
 * `connected` after the restart, and something would have to remember to
 * correct it. This map is empty on boot, which is exactly right — nothing is
 * connected, because nothing is. The store keeps the *history*, which is a
 * different question and one a boolean cannot answer.
 *
 * Nothing here touches the network. A live socket arrives as a `Channel` — the
 * two things the registry needs from it — so displacement, counting and logging
 * are all testable without one.
 */

import { randomUUID } from "node:crypto";
import type { ConnectionEvent, DisconnectReason } from "../types.js";
import type { ExchangeStore } from "../store/types.js";

/**
 * The registry's view of a live socket: something that can be hung up, and
 * something that tells us when it went away on its own.
 */
export interface Channel {
  close(): void;
  /** Push a frame to the machine. Silently ignored once the socket is gone. */
  send(frame: string): void;
  /** Every frame the machine sends after the handshake. */
  onMessage(listener: (frame: string) => void): void;
  /**
   * Fires when the far end goes away without being asked to.
   *
   * `clean` says whether the far end hung up deliberately or the link broke.
   * The adapter decides which is which, because that judgement is transport
   * specific; the registry only writes down which one it was. An operator
   * reading the log needs to tell "thor's operator stopped it" from "thor fell
   * off the network", and one reason for both cannot answer that.
   */
  onClose(listener: (clean: boolean) => void): void;
}

export interface Connection {
  supplierId: string;
  channel: Channel;
  connectedAt: Date;
  /**
   * Requests pushed down this Connection and not yet finished. Mycel is the
   * only party that can know this, because Mycel issued every one of them.
   *
   * Counted, deliberately not capped. The obvious limit — the measured
   * saturation verdict — rests on a sampling range calibrated for
   * llama.cpp-class runtimes, which samples a vLLM box serving 32–64
   * concurrently entirely below its knee. Capping from it would throttle a box
   * that batches well. The real limit derives from observed throughput, and
   * this count is its prerequisite (ADR 0023).
   */
  inFlight: number;
}

export interface ConnectionRegistryOptions {
  store: ExchangeStore;
  /** Injectable so tests need no wall clock. */
  now?: () => Date;
  /** Injectable so tests get stable ids. */
  newId?: () => string;
}

export class ConnectionRegistry {
  private readonly live = new Map<string, Connection>();
  private readonly store: ExchangeStore;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(opts: ConnectionRegistryOptions) {
    this.store = opts.store;
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? (() => randomUUID());
  }

  /**
   * Register a newly-dialled Connection, displacing any this Supplier already
   * held.
   *
   * The new socket is *provably* alive — packets just arrived on it. The old
   * one is only presumed alive, and half-open detection is exactly the thing
   * that is slow and unreliable: a slept laptop leaves a socket that looks fine
   * and is not. Preferring the provable one needs no timer and no heuristic,
   * and makes reconnect-after-sleep the normal path rather than a race.
   *
   * Displacing kills whatever was in flight on the old Connection. Those
   * requests end as truncated responses recorded `supply-failed`, and the
   * Exchange bears the cost (ADR 0025) — a displaced Connection is a dropped
   * one noticed sooner.
   */
  async connect(supplierId: string, channel: Channel): Promise<Connection> {
    await this.displace(supplierId);

    const connection: Connection = {
      supplierId,
      channel,
      connectedAt: this.now(),
      inFlight: 0,
    };
    this.live.set(supplierId, connection);

    // Only this Connection's own departure counts. A stale listener from a
    // socket that was already displaced must not evict its replacement.
    channel.onClose((clean) => {
      if (this.live.get(supplierId) === connection) {
        void this.disconnect(supplierId, clean ? "closed" : "transport-error");
      }
    });

    await this.log(supplierId, "connected");
    return connection;
  }

  /** Hang up on a Supplier's Connection, if it has one. */
  async disconnect(supplierId: string, reason: DisconnectReason): Promise<void> {
    const existing = this.live.get(supplierId);
    if (!existing) return;

    this.live.delete(supplierId);
    // Closing an already-dead socket is normal — the far end going away is how
    // most Connections end — so a throw here is noise, not news.
    try {
      existing.channel.close();
    } catch {
      /* already gone */
    }
    await this.log(supplierId, "disconnected", reason);
  }

  /** True while this Supplier holds a Connection. What Dispatch consults. */
  isConnected(supplierId: string): boolean {
    return this.live.has(supplierId);
  }

  /** Every connected Supplier. Empty on boot, because nothing is connected. */
  connectedSupplierIds(): Set<string> {
    return new Set(this.live.keys());
  }

  get(supplierId: string): Connection | undefined {
    return this.live.get(supplierId);
  }

  /** Requests currently in flight on a Supplier's Connection. Zero if none. */
  inFlight(supplierId: string): number {
    return this.live.get(supplierId)?.inFlight ?? 0;
  }

  /**
   * Bracket a request pushed down a Connection. Returns a function to call when
   * it finishes, however it finishes — the count must come back down on a
   * truncated stream and an aborted buyer exactly as on a clean completion.
   */
  trackInFlight(supplierId: string): () => void {
    const connection = this.live.get(supplierId);
    if (!connection) return () => {};

    connection.inFlight += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      connection.inFlight = Math.max(0, connection.inFlight - 1);
    };
  }

  /** Hang up on everything. For a deliberate shutdown, not a crash. */
  async closeAll(): Promise<void> {
    for (const supplierId of [...this.live.keys()]) {
      await this.disconnect(supplierId, "shutdown");
    }
  }

  private async displace(supplierId: string): Promise<void> {
    if (this.live.has(supplierId)) await this.disconnect(supplierId, "displaced");
  }

  private async log(
    supplierId: string,
    event: ConnectionEvent["event"],
    reason?: DisconnectReason,
  ): Promise<void> {
    await this.store.appendConnectionEvent({
      id: this.newId(),
      supplierId,
      event,
      reason,
      at: this.now(),
    });
  }
}
