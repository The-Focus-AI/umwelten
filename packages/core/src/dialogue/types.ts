/**
 * Dialogue — a persisted, turn-orchestrated exchange between two or more
 * named Participants (see CONTEXT.md).
 *
 * The orchestrator (dialogue.ts) owns a single canonical event log. Each
 * model participant keeps its own Interaction as a private view: its own
 * turns land as `assistant` messages, everyone else's turns arrive batched
 * into one `user` message labeled `[Name]: text` — the same multi-speaker
 * convention ChannelBridge uses for human threads.
 */

import type { StreamObserver } from "../cognition/types.js";

export type ParticipantKind = "model" | "human" | "remote";

export interface DialogueEvent {
  /** Monotonic position in the canonical log (seed = 0). */
  seq: number;
  participantId: string;
  displayName: string;
  /**
   * `message`/`seed`/`moderator` are spoken, speaker-attributed turns.
   * `event` is ambient world input — an operator injection or environment
   * change that happened *to* the dialogue rather than being said in it
   * (rendered unattributed; persisted as `user` input).
   */
  kind: "message" | "seed" | "moderator" | "event";
  /** Final text of the turn. Tool traces stay private to the speaker's Interaction. */
  content: string;
  /** ISO timestamp. */
  timestamp: string;
  /** Summary of tool activity inside the turn. */
  toolCalls?: Array<{ toolName: string; input?: unknown }>;
  metadata?: Record<string, unknown>;
}

export interface TurnContext {
  dialogueId: string;
  /** 1-based global turn counter (seed does not count). */
  turn: number;
  signal?: AbortSignal;
  /** Routed to the DialogueObserver with this participant's id attached. */
  observer?: StreamObserver;
}

export interface TurnResult {
  content: string;
  /** Structured "I have nothing further to add" signal. */
  done?: boolean;
  toolCalls?: DialogueEvent["toolCalls"];
  metadata?: Record<string, unknown>;
}

export interface ParticipantInfo {
  id: string;
  displayName: string;
  kind: ParticipantKind;
  /** `provider/name` when the participant is model-backed. */
  model?: string;
}

export interface Participant {
  readonly id: string;
  readonly displayName: string;
  readonly kind: ParticipantKind;
  /** `provider/name` when model-backed; surfaced in session metadata. */
  readonly model?: string;
  /** Called once before the first turn with the full roster. */
  onDialogueStart?(info: { participants: ParticipantInfo[] }): void;
  /**
   * Called once when the dialogue stops (any reason, including errors).
   * Undo anything onDialogueStart did to shared state — e.g. restore a
   * persistent Interaction's stimulus.
   */
  onDialogueEnd?(): void;
  /**
   * Produce the next message. `newEvents` = canonical events appended since
   * this participant's last turn (its own last message excluded).
   */
  takeTurn(newEvents: DialogueEvent[], ctx: TurnContext): Promise<TurnResult>;
}

export interface DialogueState {
  events: ReadonlyArray<DialogueEvent>;
  participants: ReadonlyArray<ParticipantInfo>;
  /** Turns taken so far (seed excluded). */
  turn: number;
  lastResult?: TurnResult & { participantId: string };
  /** Participants whose latest turn signaled done. */
  doneSignals: ReadonlySet<string>;
}

export type NextTurn = { speakerId: string } | { stop: true; reason: string };

export interface TurnPolicy {
  next(state: DialogueState): Promise<NextTurn> | NextTurn;
}

export interface StopConditions {
  /**
   * Total participant turns before the dialogue stops. Default 8 — an
   * explicit `undefined` keeps the default; pass `Infinity` to lift the cap.
   */
  maxTurns?: number;
  maxDurationMs?: number;
  signal?: AbortSignal;
  /** Default "allDone". */
  stopWhen?: "anyDone" | "allDone";
  /** Custom predicate checked before every turn. */
  until?: (state: DialogueState) => boolean;
}

export interface DialogueObserver {
  onTurnStart?(info: {
    participantId: string;
    displayName: string;
    turn: number;
  }): void;
  onTextDelta?(participantId: string, delta: string): void;
  onToolCall?(participantId: string, toolName: string, input: unknown): void;
  onTurnEnd?(event: DialogueEvent): void;
  onStop?(reason: string): void;
}

export type DialogueStopReason =
  | "maxTurns"
  | "maxDuration"
  | "policy"
  | "allDone"
  | "anyDone"
  | "abort"
  | "until"
  | "error";

export interface DialogueResult {
  id: string;
  events: DialogueEvent[];
  stoppedBy: DialogueStopReason;
  turns: number;
}
