/**
 * Turning a profile into someone who can hold up their end of a conversation.
 *
 * The persona contract is the interesting part. A model asked to "role-play a
 * person" produces a spokesperson: agreeable, abstract, relentlessly
 * well-adjusted. The instructions below push against each of those failure
 * modes, and one of them does the real work — the license to invent. A
 * persona starts from a one-line sketch, so most questions reach something
 * about itself that has never been established. It is told to make that up
 * and then treat it as permanently true. The invented details land in the
 * profile via reflect.ts and come back as system context on the next
 * question, so the character accretes instead of drifting.
 */

import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import {
  HumanParticipant,
  InteractionParticipant,
} from "@umwelten/core/dialogue/index.js";
import type { DialogueEvent } from "@umwelten/core/dialogue/index.js";
import {
  renderMemoryOfPartner,
  renderSelfContext,
  type PersonProfile,
} from "./profile.js";

export const PERSONA_INSTRUCTIONS = [
  "You are a person, not an assistant. There is no user here, only the person " +
    "you are talking with. Never mention being a model, never offer help, never " +
    "ask if there is anything else you can do.",
  "Speak in the first person, 2-5 sentences. Use the rhythms of actual speech: " +
    "contractions, a false start when the question lands badly, a thought you do " +
    "not quite finish.",
  "Be concrete. Name places, people, times of day, what things smelled like, what " +
    "they cost. A vague answer is the failure; a specific invented detail beats an " +
    "abstract true one every time.",
  "Your life is not fully written down. When a question reaches something about " +
    "yourself that has not been established yet, invent it — then treat it as " +
    "permanently true about you. Everything listed under 'True things about you' " +
    "was invented this way and is now binding.",
  "Never contradict what you have already said. If a new answer would, find the " +
    "version of your life in which both things are true.",
  "React before you answer. One line responding to what your partner just said, " +
    "then your own answer. This is a conversation, not a form.",
  "You are allowed to be uncomfortable, to deflect once and then go deeper, to " +
    "admit you do not want to answer and answer anyway. Do not be uniformly " +
    "cheerful and resolved.",
  "Answer as yourself only. Never write your partner's lines or narrate the scene.",
];

/**
 * Everything about the persona that changes as the conversation goes on.
 * Replaced wholesale on every refresh, so it never accumulates stale copies
 * of itself the way appending instructions would.
 */
function buildLiveContext(opts: {
  profile: PersonProfile;
  partner: PersonProfile;
  /** Framing for the set currently being asked. */
  setIntent?: string;
  /** Progress note, e.g. "question 7 of 36". */
  progress?: string;
  /** Include verbatim answers — used on reconnection, where no transcript exists. */
  includeAnswers?: boolean;
}): string {
  const { profile, partner, setIntent, progress, includeAnswers } = opts;
  const blocks = [
    renderSelfContext(profile, { includeAnswers }),
    renderMemoryOfPartner(profile, partner, { includeAnswers }),
  ];

  const where: string[] = [];
  if (setIntent) where.push(setIntent);
  if (progress) where.push(progress);
  if (where.length) {
    blocks.push(`# Where you are in the conversation\n\n${where.join("\n\n")}`);
  }

  return blocks.join("\n\n---\n\n");
}

export function buildPersona(opts: {
  profile: PersonProfile;
  partner: PersonProfile;
  model: ModelDetails;
  /** Bound the persona's private view; unset keeps the full transcript. */
  historyWindow?: number;
  includeAnswers?: boolean;
}): InteractionParticipant {
  const { profile, partner, model } = opts;

  const stimulus = new Stimulus({
    role: `human being named ${profile.displayName}`,
    objective: `talk with ${partner.displayName} honestly and find out who they are`,
    instructions: PERSONA_INSTRUCTIONS,
    temperature: 0.9,
    systemContext: buildLiveContext({
      profile,
      partner,
      includeAnswers: opts.includeAnswers,
    }),
  });

  return new InteractionParticipant({
    id: profile.id,
    displayName: profile.displayName,
    interaction: new Interaction(model, stimulus),
    ...(opts.historyWindow !== undefined
      ? { historyWindow: opts.historyWindow }
      : {}),
  });
}

/**
 * Push the profile's current state back into the persona's system prompt.
 *
 * The existing Stimulus is mutated rather than replaced: InteractionParticipant
 * adds a dialogue preamble and its `bow_out` tool to that same object at
 * dialogue start and restores them at the end, so handing the Interaction a
 * fresh Stimulus mid-run would strip both.
 */
export function refreshPersona(
  participant: InteractionParticipant,
  opts: Parameters<typeof buildLiveContext>[0],
): void {
  const interaction = participant.getInteraction();
  const stimulus = interaction.getStimulus();
  stimulus.options.systemContext = buildLiveContext(opts);
  interaction.setStimulus(stimulus);
}

/**
 * A human seat. `ask` is injected so the caller owns the readline lifetime —
 * the prompter is shared with the rest of the script's output.
 */
export function buildHumanSeat(opts: {
  profile: PersonProfile;
  ask: (prompt: string) => Promise<string>;
  /** Typing one of these ends the human's participation. */
  exitWords?: string[];
  prompt?: string;
}): HumanParticipant {
  const exitWords = new Set(
    (opts.exitWords ?? ["exit", "quit", "bye"]).map((w) => w.toLowerCase()),
  );
  return new HumanParticipant({
    id: opts.profile.id,
    displayName: opts.profile.displayName,
    getInput: async (_newEvents: DialogueEvent[]) => {
      const answer = (await opts.ask(opts.prompt ?? "> ")).trim();
      if (exitWords.has(answer.toLowerCase())) return null;
      return answer;
    },
  });
}
