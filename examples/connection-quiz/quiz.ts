/**
 * The connection quiz as a core Dialogue.
 *
 * There is no hand-rolled state machine here. The round shape — you answer,
 * Alex reflects, you follow up, Alex closes — is a ScriptedRoundPolicy, and
 * the work between rounds (extract what we learned, ask the next question)
 * runs in Dialogue's onTurnComplete hook. This driver only owns quiz-specific
 * state: which question we're on, the accumulated memory, and persistence.
 */
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { ModelMessage } from "ai";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import { Dialogue } from "@umwelten/core/dialogue/dialogue.js";
import { HumanParticipant } from "@umwelten/core/dialogue/participants/human-participant.js";
import { ScriptedRoundPolicy } from "@umwelten/core/dialogue/policies/scripted-round.js";
import { writeDialogueSession } from "@umwelten/core/dialogue/persist.js";
import type {
  DialogueEvent,
  DialogueState,
  NextTurn,
  PostedEntry,
  TurnPolicy,
} from "@umwelten/core/dialogue/types.js";
import { ALL_QUESTIONS, SETS } from "./questions.js";
import {
  ConnectionPartner,
  emptyMemory,
  extractConnectionMemory,
  mergeMemory,
  PARTNER_ID,
  PARTNER_NAME,
  type ConnectionMemory,
  type PartnerMode,
} from "./partner.js";

export const HUMAN_ID = "human";
export const HUMAN_NAME = "You";
const INTERVIEWER_ID = "interviewer";
const NARRATOR_ID = "narrator";

/** You answer, Alex reflects and shares, you follow up, Alex closes. */
const INTERVIEW_SCRIPT = [HUMAN_ID, PARTNER_ID, HUMAN_ID, PARTNER_ID];
/** After the 36 questions: Alex speaks first, then it's plain back-and-forth. */
const COMPANION_SCRIPT = [PARTNER_ID, HUMAN_ID];

export type QuizPhase = "interview" | "companion";

/** What the browser needs to label the composer. */
export type QuizStep =
  | "human-open"
  | "partner-reflecting"
  | "human-followup"
  | "partner-closing"
  | "companion";

export type QuizSink = (event: Record<string, unknown>) => void;

export interface QuizSnapshot {
  id: string;
  createdAt: string;
  updatedAt: string;
  model: ModelDetails;
  phase: QuizPhase;
  questionIndex: number;
  memory: ConnectionMemory;
  /** Complete canonical log — survives resume, unlike the live Dialogue's. */
  entries: DialogueEvent[];
  /**
   * Partner conversation as of the last completed round. The in-flight round
   * is replayed into a resumed Dialogue instead, so the partner perceives it
   * exactly once.
   */
  committedPartnerMessages: ModelMessage[];
}

/** Interview and companion phases have different round shapes. */
class ConnectionPolicy implements TurnPolicy {
  readonly interview = new ScriptedRoundPolicy({ script: INTERVIEW_SCRIPT });
  readonly companion = new ScriptedRoundPolicy({ script: COMPANION_SCRIPT });

  constructor(private readonly phase: () => QuizPhase) {}

  private active(): ScriptedRoundPolicy {
    return this.phase() === "companion" ? this.companion : this.interview;
  }

  next(state: DialogueState): NextTurn {
    return this.active().next(state);
  }

  slotIndex(state: DialogueState): number {
    return this.active().slotIndex(state);
  }

  justCompletedRound(state: DialogueState): boolean {
    return this.active().justCompletedRound(state);
  }
}

export class ConnectionQuiz {
  readonly id: string;
  readonly createdAt: string;
  readonly model: ModelDetails;
  private updatedAt: string;
  private phase: QuizPhase;
  private questionIndex: number;
  private readonly memory: ConnectionMemory;
  private readonly entries: DialogueEvent[] = [];
  private committedPartnerMessages: ModelMessage[];

  private readonly dialogue: Dialogue;
  private readonly policy: ConnectionPolicy;
  private readonly partner: ConnectionPartner;
  private humanInput: string | null = null;
  private sink: QuizSink | null = null;
  /** One turn at a time: a second request must not race the first. */
  private inFlight = false;
  /** Suppresses log-mirroring while a resumed round is replayed. */
  private replaying = false;

  private constructor(snapshot: QuizSnapshot) {
    this.id = snapshot.id;
    this.createdAt = snapshot.createdAt;
    this.updatedAt = snapshot.updatedAt;
    this.model = snapshot.model;
    this.phase = snapshot.phase;
    this.questionIndex = snapshot.questionIndex;
    this.memory = snapshot.memory;
    this.committedPartnerMessages = snapshot.committedPartnerMessages;

    this.policy = new ConnectionPolicy(() => this.phase);
    this.partner = new ConnectionPartner({
      model: snapshot.model,
      sessionId: snapshot.id,
      memory: () => this.memory,
      mode: () => this.partnerMode(),
      restore: snapshot.committedPartnerMessages,
    });
    const human = new HumanParticipant({
      id: HUMAN_ID,
      displayName: HUMAN_NAME,
      getInput: async () => {
        const text = this.humanInput;
        this.humanInput = null;
        return text;
      },
    });

    this.dialogue = new Dialogue({
      id: snapshot.id,
      participants: [human, this.partner],
      policy: this.policy,
      seed: {
        content:
          "You are about to do the 36-questions intimacy exercise together. " +
          "The human answers each question first.",
        from: { id: INTERVIEWER_ID, displayName: "Interviewer" },
      },
      // An interview runs as long as the human keeps answering.
      stop: { maxTurns: Infinity },
      observer: {
        onTurnStart: ({ participantId }) => {
          if (participantId === PARTNER_ID) {
            this.sink?.({ type: "partner-start", mode: this.partnerMode() });
          }
        },
        onTextDelta: (participantId, delta) => {
          if (participantId === PARTNER_ID) this.sink?.({ type: "delta", delta });
        },
        onTurnEnd: (event) => {
          if (this.replaying) return;
          this.entries.push({ ...event, seq: this.entries.length });
          this.touch();
          if (event.participantId === PARTNER_ID) {
            this.sink?.({ type: "partner", text: event.content });
          }
        },
      },
      onTurnComplete: async ({ state, post }) => {
        if (!this.policy.justCompletedRound(state)) return;
        await this.closeRound(post);
      },
    });

    // Restoring an existing log: replay it so the seed's own entry isn't
    // double-counted, then rebuild the in-flight round's position.
    if (snapshot.entries.length > 0) {
      this.entries.push(...snapshot.entries);
    }
  }

  /** A brand-new interview, ready for the first answer. */
  static create(id: string, model: ModelDetails): ConnectionQuiz {
    const now = new Date().toISOString();
    const quiz = new ConnectionQuiz({
      id,
      createdAt: now,
      updatedAt: now,
      model,
      phase: "interview",
      questionIndex: 0,
      memory: emptyMemory(),
      entries: [],
      committedPartnerMessages: [],
    });
    quiz.narrate(
      `You answer first. ${PARTNER_NAME} reflects on why it matters and shares back; then you get a follow-up.`,
    );
    quiz.askCurrentQuestion();
    return quiz;
  }

  /**
   * Rebuild from disk. The live Dialogue starts fresh: the current question is
   * re-posted and the in-flight round's turns are replayed, which is all the
   * ScriptedRoundPolicy needs to land on the right slot.
   */
  static resume(snapshot: QuizSnapshot): ConnectionQuiz {
    const quiz = new ConnectionQuiz(snapshot);
    const round = roundEntries(snapshot.entries);
    quiz.replaying = true;
    try {
      if (quiz.phase === "interview") {
        quiz.dialogue.post({
          participantId: INTERVIEWER_ID,
          displayName: "Interviewer",
          kind: "event",
          content: questionLine(quiz.questionIndex),
        });
      } else {
        quiz.dialogue.post({
          participantId: NARRATOR_ID,
          displayName: "Narrator",
          kind: "event",
          content: "The interview is over; you are talking freely now.",
        });
      }
      for (const entry of round) {
        quiz.dialogue.post({
          participantId: entry.participantId,
          displayName: entry.displayName,
          kind: "message",
          content: entry.content,
        });
      }
    } finally {
      quiz.replaying = false;
    }
    return quiz;
  }

  get step(): QuizStep {
    if (this.phase === "companion") return "companion";
    const script = INTERVIEW_SCRIPT;
    const slot = this.policy.slotIndex(this.dialogue.state) % script.length;
    return (["human-open", "partner-reflecting", "human-followup", "partner-closing"] as const)[
      slot
    ];
  }

  /** Which persona the partner should wear for the slot it's about to fill. */
  private partnerMode(): PartnerMode {
    if (this.phase === "companion") return "companion";
    return this.policy.slotIndex(this.dialogue.state) === 1 ? "reflect" : "close";
  }

  private touch(): void {
    this.updatedAt = new Date().toISOString();
  }

  private narrate(content: string): void {
    this.dialogue.post({
      participantId: NARRATOR_ID,
      displayName: "Narrator",
      kind: "event",
      content,
    });
  }

  private askCurrentQuestion(): void {
    const question = ALL_QUESTIONS[this.questionIndex];
    if (!question) return;
    if (question.indexInSet === 1) {
      const set = SETS.find((candidate) => candidate.id === question.setId);
      if (set) this.narrate(`${set.label} — ${set.blurb}`);
    }
    this.dialogue.post({
      participantId: INTERVIEWER_ID,
      displayName: "Interviewer",
      kind: "event",
      content: questionLine(this.questionIndex),
    });
  }

  /**
   * Take the human's turn, then let the partner run until it's our turn again.
   * One HTTP request per human turn; the SSE sink streams what happens.
   */
  async answer(text: string, sink: QuizSink): Promise<void> {
    const content = text.trim();
    if (!content) throw new Error("Response cannot be empty");
    if (this.inFlight) throw new Error("A turn is already in flight");
    const next = this.policy.next(this.dialogue.state);
    if ("stop" in next || next.speakerId !== HUMAN_ID) {
      throw new Error("It is not your turn yet");
    }

    this.inFlight = true;
    this.sink = sink;
    try {
      this.humanInput = content;
      await this.dialogue.step();
      // Bounded: the longest script slot run for one side is 1, but a policy
      // change shouldn't be able to spin the server.
      for (let guard = 0; guard < INTERVIEW_SCRIPT.length; guard++) {
        const upcoming = this.policy.next(this.dialogue.state);
        if ("stop" in upcoming || upcoming.speakerId === HUMAN_ID) break;
        if ((await this.dialogue.step()) === null) break;
      }
    } finally {
      this.sink = null;
      this.humanInput = null;
      this.inFlight = false;
    }
  }

  /** Abandon the current question without answering it. */
  async skip(): Promise<void> {
    if (this.phase !== "interview") throw new Error("Nothing to skip");
    this.narrate("Moving on.");
    this.advanceQuestion();
    // Skipping the last question lands in companion — Alex opens free talk.
    if (this.phase === "companion") {
      await this.dialogue.step();
    }
  }

  /**
   * Round boundary: extract what the exchange revealed, snapshot the partner's
   * committed history, and open the next round.
   */
  private async closeRound(post: (entry: PostedEntry) => void): Promise<void> {
    const round = roundEntries(this.entries);
    if (round.length > 0) {
      this.sink?.({ type: "learning-start" });
      try {
        const patch = await extractConnectionMemory({
          model: this.model,
          question:
            this.phase === "interview"
              ? (ALL_QUESTIONS[this.questionIndex]?.text ?? "")
              : "(open conversation after the interview)",
          transcript: round
            .map((e) => `${e.displayName}: ${e.content}`)
            .join("\n\n"),
          existing: this.memory,
        });
        mergeMemory(this.memory, patch);
        this.sink?.({ type: "memory", memory: this.memory });
      } catch (error) {
        // A bad extraction shouldn't end the interview, but it must not look
        // like the model simply had nothing to learn.
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[connection-quiz] ${message}`);
        this.sink?.({ type: "memory-error", message });
      }
    }

    // The round is now history the partner has genuinely seen.
    this.committedPartnerMessages = this.partner.getMessages();

    if (this.phase !== "interview") return;
    this.advanceQuestion(post);
  }

  private advanceQuestion(post?: (entry: PostedEntry) => void): void {
    this.questionIndex += 1;
    this.touch();
    if (this.questionIndex < ALL_QUESTIONS.length) {
      this.askCurrentQuestion();
      return;
    }
    this.phase = "companion";
    const announcement =
      "Interview complete. You are now talking with someone who remembers both of you.";
    // Posting through the hook's own `post` keeps the entry inside the turn
    // that produced it; outside the hook we go straight to the dialogue.
    if (post) {
      post({
        participantId: NARRATOR_ID,
        displayName: "Narrator",
        content: announcement,
        kind: "event",
      });
    } else {
      this.narrate(announcement);
    }
  }

  snapshot(): QuizSnapshot {
    return {
      id: this.id,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      model: this.model,
      phase: this.phase,
      questionIndex: this.questionIndex,
      memory: this.memory,
      entries: this.entries,
      committedPartnerMessages: this.committedPartnerMessages,
    };
  }

  /** The client-facing view: no model messages, no private partner context. */
  publicView() {
    return {
      id: this.id,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      model: this.model,
      phase: this.phase,
      questionIndex: Math.min(this.questionIndex, ALL_QUESTIONS.length - 1),
      totalQuestions: ALL_QUESTIONS.length,
      step: this.step,
      memory: this.memory,
      events: this.entries.map(toUiEvent),
    };
  }

  async save(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "quiz.json"),
      JSON.stringify(this.snapshot(), null, 2),
      "utf8",
    );
    // transcript.jsonl + meta.json in the canonical dialogue layout, so
    // `umwelten browse` and the sessions CLI can read this session.
    await writeDialogueSession(dir, this.entries, {
      id: this.id,
      created: this.createdAt,
      participants: this.dialogue.roster,
      seed: `36 questions · ${PARTNER_NAME}`,
      policy: "ScriptedRoundPolicy",
      turns: this.entries.filter((e) => e.kind === "message").length,
    });
  }

  static async load(dir: string): Promise<ConnectionQuiz | null> {
    try {
      const raw = await readFile(join(dir, "quiz.json"), "utf8");
      return ConnectionQuiz.resume(JSON.parse(raw) as QuizSnapshot);
    } catch {
      return null;
    }
  }
}

function questionLine(index: number): string {
  const question = ALL_QUESTIONS[index];
  if (!question) return "";
  return `Question ${question.globalIndex} of ${question.total}: ${question.text}`;
}

/** Spoken turns since the current round opened (i.e. after the last ambient entry). */
function roundEntries(entries: ReadonlyArray<DialogueEvent>): DialogueEvent[] {
  let from = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].kind === "event") {
      from = i + 1;
      break;
    }
  }
  return entries
    .slice(from)
    .filter(
      (e) =>
        e.kind === "message" &&
        (e.participantId === HUMAN_ID || e.participantId === PARTNER_ID),
    );
}

/** Canonical entry → the bubble the browser renders. */
function toUiEvent(entry: DialogueEvent) {
  const role =
    entry.participantId === HUMAN_ID
      ? "you"
      : entry.participantId === PARTNER_ID
        ? "partner"
        : entry.participantId === INTERVIEWER_ID && entry.kind === "event"
          ? "question"
          : "system";
  const label =
    role === "you"
      ? HUMAN_NAME
      : role === "partner"
        ? PARTNER_NAME
        : role === "question"
          ? questionLabel(entry.content)
          : undefined;
  return {
    id: String(entry.seq),
    role,
    ...(label ? { label } : {}),
    text: role === "question" ? questionText(entry.content) : entry.content,
    createdAt: entry.timestamp,
  };
}

const QUESTION_LINE = /^(Question \d+) of \d+: (.*)$/s;

function questionLabel(content: string): string {
  return QUESTION_LINE.exec(content)?.[1] ?? "Question";
}

function questionText(content: string): string {
  return QUESTION_LINE.exec(content)?.[2] ?? content;
}
