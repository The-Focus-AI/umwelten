/**
 * The witness: after a question has been answered, one structured pass over
 * what was just said that updates everyone's memory.
 *
 * This runs *outside* the dialogue on purpose. Neither persona is asked to
 * summarize itself mid-conversation — that leaks the machinery into the
 * transcript and makes them talk like they are being observed. A separate
 * Interaction reads the exchange and writes to the profiles instead.
 *
 * One call covers everyone who spoke, and produces three things per speaker:
 * facts about them, a rewritten first-person self-image, and the impression
 * the *other* person would now be forming.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import { factSchema } from "@umwelten/core/memory/types.js";
import type { Fact, MemoryFact } from "@umwelten/core/memory/types.js";
import { determineOperations } from "@umwelten/core/memory/determine_operations.js";
import {
  mergeFactsLocally,
  recordImpression,
  type PersonProfile,
  type ProfileFact,
} from "./profile.js";

const speakerUpdateSchema = z.object({
  speaker: z
    .string()
    .describe("The exact displayName of the person this update is about"),
  facts: z
    .array(factSchema)
    .describe(
      "New, concrete claims about this speaker that their answer established. " +
        "Third person, one claim each. Empty array if they revealed nothing new.",
    ),
  selfImage: z
    .string()
    .describe(
      "A rewritten first-person paragraph in this speaker's own voice describing " +
        "who they are, incorporating what they just revealed. 3-5 sentences.",
    ),
  impressionOfPartner: z
    .string()
    .describe(
      "One or two sentences, from this speaker's point of view, about how the " +
        "OTHER person is striking them now. Written as a felt impression, not a summary.",
    ),
});

const reflectionSchema = z.object({
  updates: z.array(speakerUpdateSchema),
});

type Reflection = z.infer<typeof reflectionSchema>;

export interface Contribution {
  profile: PersonProfile;
  text: string;
}

/**
 * What was being talked about. During the quiz this is a numbered question;
 * on a reconnection it is whatever the last exchange was about. `at` is the
 * provenance stamp written onto every fact and impression the pass produces
 * (the question number, or 0 for free conversation).
 */
export interface ReflectionTopic {
  text: string;
  at: number;
  /** Heading shown to the witness, e.g. "Question 17 of 36 (set 2)". */
  label?: string;
}

export interface ReflectionResult {
  /** Facts newly written to each profile, keyed by profile id. */
  added: Record<string, ProfileFact[]>;
}

const WITNESS_INSTRUCTIONS = [
  "Extract only what the speaker actually established. Never invent biography.",
  "Facts are about the speaker, written in the third person, one claim per entry.",
  'Prefer specifics ("His grandmother taught him to bake bread in Lisbon") over ' +
    'summaries ("He values family").',
  "Skip anything already obvious from the question or topic itself.",
  "A turn that dodges or stays generic yields an empty facts array — that is a " +
    "normal outcome, not a failure.",
  "Valid fact types: preference, memory, plan, activity, health, professional, miscellaneous.",
  "Return one update per speaker listed, using their exact displayName.",
];

function parseReflection(content: unknown): Reflection | null {
  try {
    const raw = typeof content === "string" ? JSON.parse(content) : content;
    const parsed = reflectionSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Merge facts with an LLM in the loop, so a sharper restatement replaces the
 * vaguer fact it supersedes instead of piling up next to it. Falls back to
 * the local dedupe if the reconciliation call fails — a flaky merge should
 * never cost us the underlying facts.
 */
async function reconcileFacts(
  model: ModelDetails,
  profile: PersonProfile,
  facts: Fact[],
  learnedAt: number,
): Promise<ProfileFact[]> {
  if (!facts.length) return [];
  if (!profile.facts.length)
    return mergeFactsLocally(profile, facts, learnedAt);

  const existing: MemoryFact[] = profile.facts.map((f) => ({
    id: f.id,
    type: f.type,
    text: f.text,
  }));

  let operations;
  try {
    operations = (await determineOperations(model, facts, existing)).memory;
  } catch {
    return mergeFactsLocally(profile, facts, learnedAt);
  }

  const byId = new Map(profile.facts.map((f) => [f.id, f]));
  const added: ProfileFact[] = [];
  for (const op of operations) {
    const target = byId.get(op.id);
    if (op.event === "UPDATE" && target) {
      target.text = op.fact.text;
      target.type = op.fact.type;
      target.learnedAt = learnedAt;
    } else if (op.event === "ADD" && !target) {
      const stored: ProfileFact = { ...op.fact, id: randomUUID(), learnedAt };
      profile.facts.push(stored);
      added.push(stored);
    }
    // NONE (and an ADD whose id collides with a fact we already hold) is a no-op.
  }
  return added;
}

/**
 * Read one exchange and write it into everyone's memory.
 *
 * `contributions` is however many people spoke — two during the quiz, one
 * per turn during a reconnection — so the same witness serves both.
 */
export async function reflect(opts: {
  model: ModelDetails;
  topic: ReflectionTopic;
  contributions: Contribution[];
  /** Use the LLM memory reconciler rather than local dedupe. */
  reconcile: boolean;
  signal?: AbortSignal;
}): Promise<ReflectionResult> {
  const { model, topic, contributions, reconcile } = opts;
  const speaking = contributions.filter((c) => c.text.trim());
  if (!speaking.length) return { added: {} };

  const roster = speaking.map((c) => c.profile.displayName).join(" and ");
  const known = speaking
    .map((c) => {
      const facts = c.profile.facts.length
        ? c.profile.facts.map((f) => `- ${f.text}`).join("\n")
        : "- (nothing yet)";
      return `### Already known about ${c.profile.displayName}\n${facts}`;
    })
    .join("\n\n");
  const said = speaking
    .map((c) => `### ${c.profile.displayName} said\n${c.text}`)
    .join("\n\n");

  const interaction = new Interaction(
    model,
    new Stimulus({
      role: "careful witness to a conversation between two people",
      objective:
        "notice what each person just revealed about themselves and how they are " +
        "landing on each other",
      instructions: WITNESS_INSTRUCTIONS,
      runnerType: "base",
    }),
  );
  interaction.setOutputFormat(reflectionSchema);
  interaction.addMessage({
    role: "user",
    content: [
      `${roster} are in conversation.`,
      "",
      `## ${topic.label ?? "What was being talked about"}`,
      topic.text,
      "",
      "## What they said",
      said,
      "",
      "## Memory so far",
      known,
    ].join("\n"),
  });

  const response = await interaction.generateObject(
    reflectionSchema,
    opts.signal,
  );
  const reflection = parseReflection(response.content);
  if (!reflection) return { added: {} };

  const added: Record<string, ProfileFact[]> = {};
  for (const update of reflection.updates) {
    const match = speaking.find(
      (c) =>
        c.profile.displayName.toLowerCase() ===
        update.speaker.trim().toLowerCase(),
    );
    if (!match) continue;
    const { profile } = match;

    added[profile.id] = reconcile
      ? await reconcileFacts(model, profile, update.facts, topic.at)
      : mergeFactsLocally(profile, update.facts, topic.at);

    if (update.selfImage.trim()) profile.selfImage = update.selfImage.trim();

    // This speaker's read on everyone else, filed on their own profile —
    // it is their impression, not a fact about the person it describes.
    if (update.impressionOfPartner.trim()) {
      for (const other of contributions) {
        if (other.profile.id === profile.id) continue;
        recordImpression(profile, {
          about: other.profile.id,
          text: update.impressionOfPartner.trim(),
          at: topic.at,
        });
      }
    }
  }

  return { added };
}
