#!/usr/bin/env node
/**
 * The 36 questions, run as a dialogue, with both people accumulating memory
 * as they go.
 *
 * Run:
 *   dotenvx run -- pnpm tsx examples/personality-quiz/quiz.ts
 *   dotenvx run -- pnpm tsx examples/personality-quiz/quiz.ts --questions 6
 *   dotenvx run -- pnpm tsx examples/personality-quiz/quiz.ts --human Will
 *
 * Flags:
 *   --questions N     stop after N questions (default: all 36)
 *   --sets 1,2        restrict to certain sets
 *   --human [name]    take one of the two seats yourself
 *   --a ID  --b ID    profile ids for the two seats (default mira / theo)
 *   --fresh           start both profiles over instead of resuming
 *   --no-reconcile    dedupe facts locally instead of with the LLM reconciler
 *   --provider  --model
 *
 * Each question is posted as an ambient dialogue event, both people answer,
 * and then a separate witness pass (reflect.ts) writes what was revealed into
 * their profiles. Those profiles are pushed back into each persona's system
 * prompt before the next question, which is what makes a character accrete
 * over 36 questions rather than drift.
 */

import "@umwelten/core/env/load.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import {
  Dialogue,
  type DialogueEvent,
  type Participant,
} from "@umwelten/core/dialogue/index.js";
import { SET_INTENT, selectQuestions, type QuestionSet } from "./questions.js";
import { QuestionRoundPolicy } from "./round-policy.js";
import {
  createProfile,
  loadProfile,
  recordAnswer,
  saveProfile,
  type PersonProfile,
} from "./profile.js";
import { buildHumanSeat, buildPersona, refreshPersona } from "./personas.js";
import { reflect } from "./reflect.js";
import {
  SPEAKER_COLORS,
  bold,
  createPrompter,
  die,
  dim,
  flagBool,
  flagNumber,
  flagString,
  parseFlags,
  yellow,
} from "./terminal.js";

/** Sparse on purpose — the quiz is supposed to fill these people in. */
const DEFAULT_SEEDS: Record<string, { displayName: string; seed: string }> = {
  mira: {
    displayName: "Mira",
    seed:
      "Mid-thirties. Moved to a new city eight months ago for a job she is not " +
      "sure about. Talks fast, deflects with jokes, notices everything.",
  },
  theo: {
    displayName: "Theo",
    seed:
      "Early forties. Grew up somewhere small and does not go back often. Slow to " +
      "answer, means what he says. Something he has not talked about in years.",
  },
};

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "you"
  );
}

async function resolveProfile(
  id: string,
  fallback: { displayName: string; seed: string },
  fresh: boolean,
): Promise<PersonProfile> {
  if (!fresh) {
    const existing = await loadProfile(id);
    if (existing) return existing;
  }
  return createProfile({ id, ...fallback });
}

async function main(): Promise<void> {
  const { flags } = parseFlags(process.argv.slice(2));

  const model: ModelDetails = {
    provider: flagString(
      flags,
      "provider",
      process.env.QUIZ_PROVIDER ?? "google",
    ),
    name: flagString(
      flags,
      "model",
      process.env.QUIZ_MODEL ?? "gemini-3-flash-preview",
    ),
  };

  const sets = flagString(flags, "sets", "")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n): n is QuestionSet => n === 1 || n === 2 || n === 3);
  const questions = selectQuestions({
    ...(sets.length ? { sets } : {}),
    ...(flagNumber(flags, "questions", undefined) !== undefined
      ? { limit: flagNumber(flags, "questions", undefined)! }
      : {}),
  });
  if (!questions.length) throw new Error("No questions selected.");

  const reconcile = flagBool(flags, "reconcile", true);
  const fresh = flagBool(flags, "fresh", false);
  const humanFlag = flags.human;
  const humanName =
    typeof humanFlag === "string"
      ? humanFlag
      : humanFlag === true
        ? "You"
        : null;

  const aId = flagString(flags, "a", "mira");
  const profileA = await resolveProfile(
    aId,
    DEFAULT_SEEDS[aId] ?? {
      displayName: aId,
      seed: "A person you are meeting for the first time.",
    },
    fresh,
  );

  const bId = humanName ? slug(humanName) : flagString(flags, "b", "theo");
  const profileB = await resolveProfile(
    bId,
    humanName
      ? {
          displayName: humanName,
          seed: "A real person, met once, in a room answering questions.",
        }
      : (DEFAULT_SEEDS[bId] ?? {
          displayName: bId,
          seed: "A person you are meeting for the first time.",
        }),
    fresh,
  );

  // Only when someone is actually sitting in: an open readline holds stdin
  // and keeps the process alive after an all-persona run finishes.
  const prompter = humanName ? createPrompter() : null;

  const personaA = buildPersona({
    profile: profileA,
    partner: profileB,
    model,
  });
  const personaB = humanName
    ? null
    : buildPersona({ profile: profileB, partner: profileA, model });
  const seatB: Participant =
    personaB ??
    buildHumanSeat({ profile: profileB, ask: prompter!.ask, prompt: "> " });

  const profiles = new Map([
    [profileA.id, profileA],
    [profileB.id, profileB],
  ]);
  const colorFor = new Map(
    [profileA.id, profileB.id].map((id, i) => [id, SPEAKER_COLORS[i]!]),
  );

  const dialogueId = `personality-quiz-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  const persist = flagBool(flags, "persist", true);
  const persistDir = persist
    ? flagString(
        flags,
        "persist-dir",
        join(homedir(), ".umwelten", "dialogues", dialogueId),
      )
    : undefined;

  const dialogue = new Dialogue({
    id: dialogueId,
    participants: [personaA, seatB],
    policy: new QuestionRoundPolicy([profileA.id, profileB.id]),
    seed: {
      content:
        `${profileA.displayName} and ${profileB.displayName} sit down across from ` +
        `each other to work through the 36 questions.`,
      from: { id: "protocol", displayName: "The Questions" },
    },
    stop: { maxTurns: questions.length * 2 + 4 },
    ...(persistDir ? { persistDir } : {}),
    observer: {
      onTurnStart: ({ participantId, displayName }) => {
        const color = colorFor.get(participantId) ?? ((t: string) => t);
        process.stdout.write(`\n${color(`[${displayName}]`)}\n`);
      },
      onTextDelta: (_id, delta) => process.stdout.write(delta),
      onTurnEnd: () => process.stdout.write("\n"),
    },
  });

  console.log(
    dim(
      `36 questions · ${profileA.displayName} & ${profileB.displayName} · ` +
        `${model.provider}/${model.name} · ${questions.length} question(s)`,
    ),
  );
  if (persistDir) console.log(dim(`transcript → ${persistDir}`));

  let stoppedEarly = false;

  try {
    for (const [index, question] of questions.entries()) {
      const progress = [
        `You are on question ${question.n} of 36 (${index + 1} of ${questions.length} tonight).`,
        "Do not leave the conversation until the questions are done.",
        question.aboutPartner
          ? "This one is about your partner — answer it about them, using what they " +
            "have actually told you tonight, not generalities."
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      refreshPersona(personaA, {
        profile: profileA,
        partner: profileB,
        setIntent: SET_INTENT[question.set],
        progress,
      });
      if (personaB) {
        refreshPersona(personaB, {
          profile: profileB,
          partner: profileA,
          setIntent: SET_INTENT[question.set],
          progress,
        });
      }

      console.log(
        `\n${bold(`Q${question.n}`)} ${dim(`· set ${question.set}`)}\n${yellow(question.text)}`,
      );
      dialogue.post({
        participantId: "protocol",
        displayName: "The Questions",
        kind: "event",
        content: `Question ${question.n} of 36. ${question.text}`,
      });

      const answered: DialogueEvent[] = [];
      for (let turn = 0; turn < 2; turn++) {
        const event = await dialogue.step();
        if (!event) {
          stoppedEarly = true;
          break;
        }
        if (!event.content.trim()) {
          // A human seat returning nothing means they typed `exit`.
          stoppedEarly = true;
          break;
        }
        answered.push(event);
      }
      if (!answered.length) break;

      for (const event of answered) {
        const profile = profiles.get(event.participantId);
        if (!profile) continue;
        recordAnswer(profile, {
          n: question.n,
          set: question.set,
          question: question.text,
          text: event.content,
        });
      }

      try {
        const { added } = await reflect({
          model,
          topic: {
            text: question.text,
            at: question.n,
            label: `Question ${question.n} of 36 (set ${question.set})`,
          },
          contributions: answered.flatMap((event) => {
            const profile = profiles.get(event.participantId);
            return profile ? [{ profile, text: event.content }] : [];
          }),
          reconcile,
        });
        const learned = Object.entries(added).flatMap(([id, facts]) =>
          facts.map((f) => `${profiles.get(id)?.displayName}: ${f.text}`),
        );
        if (learned.length) {
          console.log(
            dim(
              `\n  ↳ learned\n${learned.map((l) => `    · ${l}`).join("\n")}`,
            ),
          );
        }
      } catch (err) {
        console.log(
          dim(
            `\n  ↳ reflection failed: ${err instanceof Error ? err.message : err}`,
          ),
        );
      }

      await Promise.all([saveProfile(profileA), saveProfile(profileB)]);
      if (stoppedEarly) break;
    }
  } finally {
    // Whatever happened, let go of stdin so the process can exit — and keep
    // whatever memory was built before it happened.
    prompter?.close();
    await Promise.all([saveProfile(profileA), saveProfile(profileB)]);
  }

  console.log(`\n${bold("— what they know now —")}`);
  for (const profile of [profileA, profileB]) {
    const partner = profile.id === profileA.id ? profileB : profileA;
    console.log(
      `\n${bold(profile.displayName)} ${dim(`(${profile.facts.length} facts)`)}`,
    );
    if (profile.selfImage) console.log(dim(profile.selfImage));
    const impression = (profile.impressions[partner.id] ?? []).at(-1);
    if (impression) {
      console.log(dim(`On ${partner.displayName}: ${impression.text}`));
    }
  }

  console.log(
    `\n${dim("profiles saved. talk to one of them again with:")}\n  ` +
      `dotenvx run -- pnpm tsx examples/personality-quiz/reconnect.ts --person ${profileA.id} --you ${profileB.id}`,
  );
  if (persistDir) {
    console.log(
      dim(`\ntranscript: ${persistDir} (readable via \`umwelten browse\`)`),
    );
  }
}

await main().catch(die);
