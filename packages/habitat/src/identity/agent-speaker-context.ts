/**
 * Speaker context — the verified end-user on whose behalf the current A2A
 * request runs (ADR 0003 step 2).
 *
 * The habitat A2A surface authenticates a per-user signed grant (`jwtAuth`,
 * `sub` = the speaking user) but the A2A SDK's request handler does not carry
 * that identity into the executor. Rather than thread it through every
 * `execute()` / `handleMessage()` signature, we stash it in an
 * AsyncLocalStorage so it follows the async call tree — the same pattern as
 * {@link ../identity/agent-call-context.ts} (the agent_ask recursion guard).
 *
 * The container server wraps `transportHandler.handle()` in
 * {@link runWithSpeaker}; the executor reads it with {@link getSpeaker}.
 *
 * `contextId` (the thread) and `sub` (the speaker) are deliberately separate:
 * one thread can carry many speakers, so the speaker is per-request, not
 * per-session.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** The verified speaker for the current request. */
export interface Speaker {
  /** Stable user id — the verified JWT `sub`. Used as `interaction.userId`. */
  userId: string;
  /** Display name, if the grant carried one (for speaker labeling). */
  displayName?: string;
  /** Email, if the grant carried one. */
  email?: string;
}

const storage = new AsyncLocalStorage<Speaker>();

/**
 * Run `fn` with `speaker` as the current speaker. A `undefined` speaker runs
 * `fn` with no speaker bound — preserving the unauthenticated / dev fallback
 * (the executor then keeps its `a2a:${contextId}` identity).
 */
export function runWithSpeaker<T>(
  speaker: Speaker | undefined,
  fn: () => T,
): T {
  if (!speaker) return fn();
  return storage.run(speaker, fn);
}

/** Get the current speaker, or undefined when none is bound. */
export function getSpeaker(): Speaker | undefined {
  return storage.getStore();
}
