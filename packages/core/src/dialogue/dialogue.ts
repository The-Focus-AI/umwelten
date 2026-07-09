import { v4 as uuidv4 } from "uuid";
import type { StreamObserver } from "../cognition/types.js";
import { RoundRobinPolicy } from "./policies/round-robin.js";
import { writeDialogueSession } from "./persist.js";
import type {
  DialogueEvent,
  DialogueObserver,
  DialogueResult,
  DialogueState,
  DialogueStopReason,
  Participant,
  ParticipantInfo,
  StopConditions,
  TurnPolicy,
  TurnResult,
} from "./types.js";

export interface DialogueOptions {
  id?: string;
  /** At least 2, with unique ids. */
  participants: Participant[];
  /** Default: RoundRobinPolicy. */
  policy?: TurnPolicy;
  /** Default: { maxTurns: 8, stopWhen: "allDone" }. */
  stop?: StopConditions;
  /** Opening prompt that starts the dialogue. */
  seed: { content: string; from?: { id: string; displayName: string } };
  observer?: DialogueObserver;
  /** When set, transcript.jsonl + meta.json are written here after every turn. */
  persistDir?: string;
}

export const DEFAULT_MAX_TURNS = 8;

/**
 * Turn orchestrator for a multi-participant Dialogue. Owns the canonical
 * event log; participants see only the events appended since their last
 * turn (per-participant cursor). `step()` runs one turn so frontends can
 * drive pacing; `run()` loops until a stop condition fires; `post()` lets
 * an out-of-band speaker (e.g. a human observer) interject between turns.
 */
export class Dialogue {
  readonly id: string;
  private readonly participants: Participant[];
  private readonly policy: TurnPolicy;
  private readonly stopConditions: StopConditions;
  private readonly observer?: DialogueObserver;
  private readonly persistDir?: string;
  private readonly seedContent: string;
  private readonly created = new Date().toISOString();
  private readonly startedAtMs = Date.now();
  private readonly eventLog: DialogueEvent[] = [];
  private readonly cursors = new Map<string, number>();
  private readonly doneSignals = new Set<string>();
  private lastResult?: TurnResult & { participantId: string };
  private turnCount = 0;
  private stoppedBy?: DialogueStopReason;
  private started = false;
  private seq = 0;

  constructor(options: DialogueOptions) {
    if (options.participants.length < 2) {
      throw new Error("A dialogue needs at least 2 participants");
    }
    const ids = new Set(options.participants.map((p) => p.id));
    if (ids.size !== options.participants.length) {
      throw new Error("Dialogue participant ids must be unique");
    }
    this.id = options.id ?? `dialogue-${uuidv4()}`;
    this.participants = options.participants;
    this.policy = options.policy ?? new RoundRobinPolicy();
    // ?? per field (not a spread) so an explicitly-undefined maxTurns can't
    // silently disable the cap; pass Infinity to deliberately lift it.
    this.stopConditions = {
      ...options.stop,
      maxTurns: options.stop?.maxTurns ?? DEFAULT_MAX_TURNS,
      stopWhen: options.stop?.stopWhen ?? "allDone",
    };
    this.observer = options.observer;
    this.persistDir = options.persistDir;
    this.seedContent = options.seed.content;
    this.appendEvent({
      participantId: options.seed.from?.id ?? "user",
      displayName: options.seed.from?.displayName ?? "User",
      kind: "seed",
      content: options.seed.content,
    });
  }

  get events(): ReadonlyArray<DialogueEvent> {
    return this.eventLog;
  }

  get roster(): ParticipantInfo[] {
    return this.participants.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      kind: p.kind,
      ...(p.model ? { model: p.model } : {}),
    }));
  }

  private appendEvent(
    e: Omit<DialogueEvent, "seq" | "timestamp">,
  ): DialogueEvent {
    const event: DialogueEvent = {
      ...e,
      seq: this.seq++,
      timestamp: new Date().toISOString(),
    };
    this.eventLog.push(event);
    return event;
  }

  private get state(): DialogueState {
    return {
      events: this.eventLog,
      participants: this.roster,
      turn: this.turnCount,
      lastResult: this.lastResult,
      doneSignals: this.doneSignals,
    };
  }

  private checkStop(): DialogueStopReason | null {
    const { maxTurns, maxDurationMs, signal, stopWhen, until } =
      this.stopConditions;
    if (signal?.aborted) return "abort";
    if (maxTurns !== undefined && this.turnCount >= maxTurns) return "maxTurns";
    if (maxDurationMs !== undefined && Date.now() - this.startedAtMs >= maxDurationMs) {
      return "maxDuration";
    }
    if (stopWhen === "anyDone" && this.doneSignals.size > 0) return "anyDone";
    if (
      stopWhen === "allDone" &&
      this.doneSignals.size === this.participants.length
    ) {
      return "allDone";
    }
    if (until?.(this.state)) return "until";
    return null;
  }

  private async stop(reason: DialogueStopReason, detail?: string): Promise<null> {
    this.stoppedBy = reason;
    for (const p of this.participants) {
      try {
        p.onDialogueEnd?.();
      } catch {
        // best-effort cleanup — one participant's failure must not block the rest
      }
    }
    this.observer?.onStop?.(detail ?? reason);
    await this.persist();
    return null;
  }

  /**
   * Run one turn. Returns the appended event, or null once the dialogue has
   * stopped (subsequent calls keep returning null).
   */
  async step(): Promise<DialogueEvent | null> {
    if (this.stoppedBy) return null;

    if (!this.started) {
      this.started = true;
      const roster = this.roster;
      for (const p of this.participants) {
        p.onDialogueStart?.({ participants: roster });
      }
    }

    const stopReason = this.checkStop();
    if (stopReason) return this.stop(stopReason);

    const next = await this.policy.next(this.state);
    if ("stop" in next) {
      this.appendEvent({
        participantId: "moderator",
        displayName: "Moderator",
        kind: "moderator",
        content: next.reason,
      });
      return this.stop("policy", next.reason);
    }

    const participant = this.participants.find((p) => p.id === next.speakerId);
    if (!participant) {
      throw new Error(
        `Turn policy picked unknown participant "${next.speakerId}"`,
      );
    }

    // Slice up to the pre-turn end of the log and filter out the speaker's
    // own events; the cursor is later set to sliceEnd so anything post()ed
    // while this turn is in flight is still delivered next time.
    const sliceEnd = this.eventLog.length;
    const newEvents = this.eventLog
      .slice(this.cursors.get(participant.id) ?? 0, sliceEnd)
      .filter((e) => e.participantId !== participant.id);
    this.turnCount++;
    this.observer?.onTurnStart?.({
      participantId: participant.id,
      displayName: participant.displayName,
      turn: this.turnCount,
    });

    const streamObserver: StreamObserver = {
      onTextDelta: (delta) =>
        this.observer?.onTextDelta?.(participant.id, delta),
      onToolCall: (call) =>
        this.observer?.onToolCall?.(participant.id, call.toolName, call.input),
    };

    let result: TurnResult;
    try {
      result = await participant.takeTurn(newEvents, {
        dialogueId: this.id,
        turn: this.turnCount,
        signal: this.stopConditions.signal,
        observer: streamObserver,
      });
    } catch (err) {
      await this.stop(
        "error",
        `error in ${participant.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    const event = this.appendEvent({
      participantId: participant.id,
      displayName: participant.displayName,
      kind: "message",
      content: result.content,
      ...(result.toolCalls?.length ? { toolCalls: result.toolCalls } : {}),
      ...(result.metadata ? { metadata: result.metadata } : {}),
    });
    // Cursor points at the pre-turn end of the log, NOT past the appended
    // message: interjections that arrived mid-turn stay deliverable, and the
    // self-filter above keeps the participant from re-reading its own turn.
    this.cursors.set(participant.id, sliceEnd);
    if (result.done) this.doneSignals.add(participant.id);
    this.lastResult = { ...result, participantId: participant.id };
    this.observer?.onTurnEnd?.(event);
    await this.persist();
    return event;
  }

  /** Loop step() until a stop condition fires. */
  async run(): Promise<DialogueResult> {
    while ((await this.step()) !== null) {
      // step() handles everything
    }
    return {
      id: this.id,
      events: [...this.eventLog],
      stoppedBy: this.stoppedBy ?? "policy",
      turns: this.turnCount,
    };
  }

  /**
   * Inject an out-of-band entry between turns: a spoken interjection
   * (kind "message", the default — e.g. a human observer) or an ambient
   * world event (kind "event" — e.g. an operator injection or environment
   * change that participants should perceive but nobody "said").
   */
  post(e: {
    participantId: string;
    displayName: string;
    content: string;
    kind?: "message" | "event";
  }): void {
    const event = this.appendEvent({ ...e, kind: e.kind ?? "message" });
    this.observer?.onTurnEnd?.(event);
    void this.persist().catch(() => {
      /* best-effort between turns; step() persists again */
    });
  }

  private async persist(): Promise<void> {
    if (!this.persistDir) return;
    await writeDialogueSession(this.persistDir, this.eventLog, {
      id: this.id,
      created: this.created,
      participants: this.roster,
      seed: this.seedContent,
      policy: this.policy.constructor.name,
      stoppedBy: this.stoppedBy,
      turns: this.turnCount,
    });
  }
}
