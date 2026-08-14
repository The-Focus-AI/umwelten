/**
 * The dial-in wire protocol, as the Exchange sees it.
 *
 * **Deliberately duplicated in `@umwelten/supplier`.** ADR 0023 says the wire
 * protocol is "a shared shape, and a shared *type* at most, never a shared
 * database driver" — and there is nowhere honest to put a shared module.
 * `@umwelten/mycel` has no internal dependencies at all, because it is its own
 * bounded context (CONTEXT-MAP.md); `@umwelten/supplier` deliberately cannot
 * reach it, so a GPU box never installs a Postgres driver. Introducing a
 * package to hold two small interfaces would buy less than it costs.
 *
 * So the wire is the contract, and each side declares it. That is the normal
 * arrangement across a context boundary, and the protocol version below is what
 * catches the two definitions drifting apart.
 */

/**
 * Bumped when a frame's meaning changes in a way an older peer would
 * misinterpret. The Exchange refuses a version it does not speak rather than
 * guessing — a machine serving under a misunderstood protocol is worse than a
 * machine that failed to connect.
 */
export const WIRE_VERSION = 1;

/** Where a machine Supplier dials in. */
export const CONNECT_PATH = "/suppliers/connect";

/**
 * The first frame an agent sends, carrying its catalogue.
 *
 * Offers ride the handshake rather than arriving in a frame after it, so there
 * is never a moment where the Exchange believes a machine is available but does
 * not know what it serves. Availability and catalogue land together or the
 * Connection is refused.
 */
export interface HelloFrame {
  type: "hello";
  wireVersion: number;
  /** The agent's own version, for operator diagnosis. Never trusted for logic. */
  agentVersion?: string;
  /**
   * This machine's Offer set, in the same shape `POST /suppliers/offers`
   * accepts, and validated by the same code. Publishing is total: what arrives
   * replaces the whole set, so a Model the machine stopped serving stops being
   * advertised without anyone deleting anything.
   *
   * Omitted entirely means "do not touch my catalogue" — not "I have none".
   * A machine whose Offers the operator publishes on its behalf must be able to
   * dial in without wiping them.
   */
  offers?: unknown[];
  /**
   * Guarantees the machine believes it is offered under. Echoed for
   * confirmation, never authoritative — the operator's grant decides, and a
   * claim beyond it is refused rather than downgraded (ADR 0012).
   */
  guarantees?: string[];
}

/** Accepted, and holding. Sent once, immediately after the handshake. */
export interface WelcomeFrame {
  type: "welcome";
  wireVersion: number;
  supplierId: string;
}

/**
 * Work, pushed down the Connection.
 *
 * **The Exchange pushes; the machine never asks.** A machine that polled for
 * work would need a queue to poll, and a queue is a component with a depth, an
 * eviction policy and a failure mode of its own (ADR 0023). Pushing keeps the
 * Exchange's knowledge of what is outstanding exact, which is also the only
 * reason it can count what is in flight.
 *
 * Every frame after the handshake carries an `id`, because one Connection
 * carries many concurrent requests and their tokens must not interleave.
 */
export interface RequestFrame {
  type: "request";
  id: string;
  /** The buyer's OpenAI-shaped payload, forwarded unmodified. */
  body: Record<string, unknown>;
}

/**
 * Stop generating. Sent when the buyer hung up, or credit ran out mid-stream.
 *
 * Without this the machine keeps burning GPU seconds on tokens nobody will
 * receive and nobody will pay for.
 */
export interface CancelFrame {
  type: "cancel";
  id: string;
}

/** The machine's runtime answered. Status first, so a 4xx is relayed as one. */
export interface ResponseHeadFrame {
  type: "response-head";
  id: string;
  status: number;
  headers?: Record<string, string>;
}

/** A piece of the body, as produced. Not buffered, not batched. */
export interface ChunkFrame {
  type: "chunk";
  id: string;
  data: string;
}

/** The body finished normally. */
export interface EndFrame {
  type: "end";
  id: string;
}

/**
 * The machine could not serve it, or stopped part way.
 *
 * Distinct from a non-2xx `response-head`: that is the runtime answering, this
 * is the agent unable to get an answer at all.
 */
export interface RequestErrorFrame {
  type: "request-error";
  id: string;
  message: string;
}

/**
 * The Exchange hanging up with a reason, before closing. A machine that is
 * refused should learn why rather than guess from a close code — an operator
 * debugging a silent agent needs "you are registered as a vendor", not 1008.
 */
export interface GoodbyeFrame {
  type: "goodbye";
  reason: string;
}

export type AgentFrame =
  | HelloFrame
  | ResponseHeadFrame
  | ChunkFrame
  | EndFrame
  | RequestErrorFrame;
export type ExchangeFrame = WelcomeFrame | GoodbyeFrame | RequestFrame | CancelFrame;

/** Close codes. 4000+ is the application-defined range. */
export const CLOSE = {
  /** A newer Connection for the same Supplier took over. */
  DISPLACED: 4000,
  /** The Exchange is shutting down. */
  SHUTDOWN: 4001,
  /** The hello frame never arrived, or was not a hello. */
  BAD_HANDSHAKE: 4002,
  /** Wire versions do not match. */
  WIRE_VERSION: 4003,
  /**
   * The catalogue in the hello was rejected — malformed, or claiming a
   * Guarantee the operator never granted.
   *
   * The Connection is refused rather than held without it. A machine the
   * Exchange believes is available but whose catalogue it could not accept is
   * exactly the state this frame exists to prevent.
   */
  PUBLISH_REJECTED: 4004,
} as const;

export function parseFrame<T>(raw: string): T | undefined {
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
