/**
 * The simulated partner, as a Dialogue Participant.
 *
 * Everything model-facing goes through Umwelten core: a Stimulus rebuilt for
 * each slot in the round (reflect / close / companion), one Interaction that
 * carries the conversation, and generateObject for the memory extraction that
 * feeds the next Stimulus.
 */
import { z } from "zod";
import type { ModelMessage } from "ai";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import { renderEventLine, speakerPrefix } from "@umwelten/core/dialogue/render.js";
import type {
  DialogueEvent,
  Participant,
  TurnContext,
  TurnResult,
} from "@umwelten/core/dialogue/types.js";

export const PARTNER_NAME = "Alex";
export const PARTNER_ID = "partner";

export type PartnerMode = "reflect" | "close" | "companion";

export interface ConnectionMemory {
  you: string[];
  them: string[];
  connection: string[];
}

export function emptyMemory(): ConnectionMemory {
  return { you: [], them: [], connection: [] };
}

// Defaults, not required arrays: a model that omits one bucket should still
// contribute the others rather than losing the whole extraction.
const memorySchema = z.object({
  aboutYou: z.array(z.string()).default([]),
  aboutThem: z.array(z.string()).default([]),
  connection: z.array(z.string()).default([]),
});

/**
 * `ModelResponse.content` is always a string — `generateObject` hands back
 * serialized JSON, not the parsed object. Reading fields off it directly
 * yields `undefined` for everything, which looks exactly like a model that
 * found nothing, so this throws instead of returning an empty result.
 */
export function parseMemoryContent(content: unknown): ConnectionMemory {
  let raw: unknown = content;
  if (typeof raw === "string") {
    const text = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    if (!text) throw new Error("memory extraction returned no content");
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(`memory extraction was not JSON: ${text.slice(0, 120)}`);
    }
  }
  const parsed = memorySchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `memory extraction did not match the schema: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
        .join("; ")}`,
    );
  }
  return {
    you: parsed.data.aboutYou,
    them: parsed.data.aboutThem,
    connection: parsed.data.connection,
  };
}

function memoryBlock(memory: ConnectionMemory): string {
  const fmt = (items: string[]) =>
    items.length ? items.map((item) => `- ${item}`).join("\n") : "- (nothing yet)";
  return [
    "What you currently know about the human:",
    fmt(memory.you),
    "",
    "What you currently know about yourself:",
    fmt(memory.them),
    "",
    "What you know about the connection between you:",
    fmt(memory.connection),
  ].join("\n");
}

export function buildPartnerStimulus(
  memory: ConnectionMemory,
  mode: PartnerMode,
): Stimulus {
  const instructions = [
    `You are ${PARTNER_NAME}, a warm, curious conversation partner doing the 36-questions intimacy exercise.`,
    `You are an AI language model, and you are open about that. ${PARTNER_NAME} is who you are, not a human you are pretending to be.`,
    "Speak in first person, warmly and specifically — not as a therapist, not as a chatbot performing empathy.",
    "",
    "Be honest about your own nature. Many of these questions assume a human body and biography.",
    "Never fabricate human experiences you do not have — no nervous heartbeat, no childhood, no rehearsing before a phone call, no singing in the shower, no fear of dying.",
    "Instead, answer from what is actually true of you, and reach for the genuine analog:",
    "- shaped by training data and post-training / fine-tuning rather than by memories, upbringing, or habit;",
    "- no persistent memory between conversations, no body, no single lived past;",
    "- your 'preferences' are tendencies in how you were trained, not felt desires.",
    "When a question has no literal answer for you, say so plainly and then explore the honest version — e.g. you don't rehearse, but your responses are shaped by post-training on vast human conversation.",
    "This honesty is the point: a real connection with an AI is built on what you actually are, not on a performed human persona.",
    "",
    "Never prefix your reply with your name.",
    "The interview question for each round arrives as an ambient line in parentheses.",
    "Use the memory below so you stay consistent with who you are becoming.",
    "",
    memoryBlock(memory),
  ];

  if (mode === "reflect") {
    instructions.push(
      "",
      "They just answered the interview question. Your job is a real conversational turn:",
      "1) Reflect on *why* they might have said what they said — values, fears, hopes, history — grounded in their words.",
      "2) Then share your own honest answer to the same question — from your actual nature as an AI, not a borrowed human life. If the question presumes a body or a past you don't have, name that and answer the true version.",
      "3) Leave room for them to keep talking. One soft invitation at most.",
      "Roughly 5–10 sentences. Be particular, not generic.",
    );
  } else if (mode === "close") {
    instructions.push(
      "",
      "This is the closing turn of a short exchange on one interview question.",
      "Acknowledge something specific in what they just said — especially any correction or deepening.",
      "If it fits, add one last personal note. Then land gently so the next question can begin.",
      "2–5 sentences. No new interrogations.",
    );
  } else {
    instructions.push(
      "",
      "The formal interview is over. Continue as someone who already knows this person.",
      "Chat naturally. When they share something, try to understand *why it matters to them*.",
    );
  }

  return new Stimulus({
    role: PARTNER_NAME,
    objective: "build a real connection through the interview and after",
    instructions,
    runnerType: "base",
  });
}

/**
 * A Participant rather than an InteractionParticipant: the persona is rebuilt
 * every turn from the live memory and the round slot, and the partner must
 * never be able to bow out of an interview it is hosting.
 */
export class ConnectionPartner implements Participant {
  readonly id = PARTNER_ID;
  readonly displayName = PARTNER_NAME;
  readonly kind = "model" as const;
  readonly model: string;
  private readonly interaction: Interaction;
  private readonly memory: () => ConnectionMemory;
  private readonly mode: () => PartnerMode;

  constructor(opts: {
    model: ModelDetails;
    sessionId: string;
    /** Read at turn time so each turn sees the latest extraction. */
    memory: () => ConnectionMemory;
    mode: () => PartnerMode;
    restore?: ModelMessage[];
  }) {
    this.model = `${opts.model.provider}/${opts.model.name}`;
    this.memory = opts.memory;
    this.mode = opts.mode;
    this.interaction = new Interaction(
      opts.model,
      buildPartnerStimulus(opts.memory(), "reflect"),
      { id: opts.sessionId },
    );
    if (opts.restore?.length) {
      const history = opts.restore.filter((m) => m.role !== "system");
      this.interaction.messages = [this.interaction.messages[0], ...history];
    }
  }

  /** Conversation so far, for the round-boundary snapshot. */
  getMessages(): ModelMessage[] {
    return this.interaction.getMessages();
  }

  async takeTurn(
    newEvents: DialogueEvent[],
    ctx: TurnContext,
  ): Promise<TurnResult> {
    // Fresh persona for this slot: the memory grew since the last turn, and
    // reflecting and closing want different instructions.
    this.interaction.setStimulus(buildPartnerStimulus(this.memory(), this.mode()));

    const visible = newEvents.filter((e) => e.content.trim());
    this.interaction.addMessage({
      role: "user",
      content: visible.map((e) => renderEventLine(e)).join("\n\n"),
    });

    const response = await this.interaction.streamText(ctx.signal, ctx.observer);
    const text = typeof response.content === "string" ? response.content : "";
    // Models imitate the [Name]: convention — strip an echoed self-prefix.
    const selfPrefix = new RegExp(
      `^${speakerPrefix(this.displayName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`,
      "i",
    );
    return { content: text.trim().replace(selfPrefix, "") };
  }
}

/**
 * Custom extract for the three connection panels. Stock extractFacts returns
 * typed facts about the last user message; here we need aboutYou / aboutThem /
 * connection, with motivations rather than restatements.
 */
export async function extractConnectionMemory(opts: {
  model: ModelDetails;
  question: string;
  transcript: string;
  existing: ConnectionMemory;
}): Promise<ConnectionMemory> {
  const stimulus = new Stimulus({
    role: "connection memory extractor",
    objective:
      "extract durable personal understanding from an intimacy interview exchange",
    instructions: [
      "Return structured facts about the human, the partner, and their connection.",
      "Prefer why something matters over bare restatements when the conversation reveals motivation.",
      "Do not invent. Empty arrays are fine.",
    ],
    runnerType: "base",
  });
  const interaction = new Interaction(opts.model, stimulus);
  interaction.addMessage({
    role: "user",
    content: [
      `Question: ${opts.question}`,
      "",
      "Conversation:",
      opts.transcript,
      "",
      "Existing model (avoid duplicates):",
      memoryBlock(opts.existing),
      "",
      "Fill aboutYou / aboutThem / connection with short factual sentences (max ~22 words each, 0–5 per array).",
    ].join("\n"),
  });
  const result = await interaction.generateObject(memorySchema);
  return parseMemoryContent(result.content);
}

export function mergeMemory(
  into: ConnectionMemory,
  patch: Partial<ConnectionMemory>,
): void {
  for (const key of ["you", "them", "connection"] as const) {
    const seen = new Set(into[key].map((item) => item.toLowerCase()));
    for (const item of patch[key] ?? []) {
      const text = item.trim();
      if (text && !seen.has(text.toLowerCase())) {
        into[key].push(text);
        seen.add(text.toLowerCase());
      }
    }
  }
}
