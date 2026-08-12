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
 * The first frame, and for now the only one an agent sends. Publishing Offers
 * over the Connection arrives in #379; work frames in #380.
 */
export interface HelloFrame {
  type: "hello";
  wireVersion: number;
  /** The agent's own version, for operator diagnosis. Never trusted for logic. */
  agentVersion?: string;
}

/** Accepted, and holding. Sent once, immediately after the handshake. */
export interface WelcomeFrame {
  type: "welcome";
  wireVersion: number;
  supplierId: string;
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

export type AgentFrame = HelloFrame;
export type ExchangeFrame = WelcomeFrame | GoodbyeFrame;

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
} as const;

export function parseFrame<T>(raw: string): T | undefined {
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
