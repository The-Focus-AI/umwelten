#!/usr/bin/env node
/**
 * Talk to someone who remembers the night you did the 36 questions.
 *
 * Run:
 *   dotenvx run -- pnpm tsx examples/personality-quiz/reconnect.ts --person mira --you theo
 *
 * Flags:
 *   --person ID   whose profile the persona embodies — who you are talking to
 *   --you ID      which profile is you (inferred when they only know one person)
 *   --scene TEXT  set the circumstances of running into each other again
 *   --no-learn    do not update memory from this conversation
 *   --provider  --model
 *
 * This is the payoff of the quiz. The persona is rebuilt from its saved
 * profile with everything included this time — its own answers verbatim, the
 * facts it accumulated, and what it remembers you saying — so it arrives
 * already knowing who it is and who you are. Then it keeps learning: every
 * turn you take goes back through the same witness pass, so the conversation
 * you have now is also remembered next time.
 */

import "@umwelten/core/env/load.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import { Dialogue, RoundRobinPolicy } from "@umwelten/core/dialogue/index.js";
import { loadProfile, saveProfile, type PersonProfile } from "./profile.js";
import { buildHumanSeat, buildPersona, refreshPersona } from "./personas.js";
import { reflect } from "./reflect.js";
import {
  SPEAKER_COLORS,
  bold,
  createPrompter,
  die,
  dim,
  flagBool,
  flagString,
  parseFlags,
} from "./terminal.js";

const DEFAULT_SCENE =
  "Some time has passed since the night the two of you worked through the 36 " +
  "questions. You have just run into each other again, unplanned. Say " +
  "something — you are the one who spoke first.";

async function requireProfile(
  id: string,
  label: string,
): Promise<PersonProfile> {
  const profile = await loadProfile(id);
  if (!profile) {
    throw new Error(
      `No profile "${id}" for ${label}. Run the quiz first:\n` +
        `  dotenvx run -- pnpm tsx examples/personality-quiz/quiz.ts`,
    );
  }
  return profile;
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

  const personId = flagString(flags, "person", "mira");
  const person = await requireProfile(personId, "--person");

  // They usually only know one other person — no need to make you say who.
  const known = Object.keys(person.impressions);
  const youId = flagString(flags, "you", known.length === 1 ? known[0]! : "");
  if (!youId) {
    throw new Error(
      `${person.displayName} remembers ${known.length} people. ` +
        `Say which one is you with --you <id> (${known.join(", ") || "none yet"}).`,
    );
  }
  const you = await requireProfile(youId, "--you");

  const learn = flagBool(flags, "learn", true);
  const scene = flagString(flags, "scene", DEFAULT_SCENE);
  const prompter = createPrompter();

  const persona = buildPersona({
    profile: person,
    partner: you,
    model,
    includeAnswers: true,
  });
  const human = buildHumanSeat({
    profile: you,
    ask: prompter.ask,
    prompt: "> ",
  });

  const colorFor = new Map([
    [person.id, SPEAKER_COLORS[0]!],
    [you.id, SPEAKER_COLORS[1]!],
  ]);

  const dialogueId = `reconnect-${person.id}-${randomUUID().slice(0, 8)}`;
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
    // Persona first in the roster, so round-robin gives them the opening line.
    participants: [persona, human],
    policy: new RoundRobinPolicy(),
    seed: { content: scene, from: { id: "scene", displayName: "Narrator" } },
    // Open-ended: it runs until you say goodbye or they do.
    stop: { maxTurns: Infinity, stopWhen: "anyDone" },
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
      `${person.displayName} remembers ${person.facts.length} things about themselves ` +
        `and ${person.answers.length} answers. They know you as ${you.displayName}.`,
    ),
  );
  console.log(dim(`${model.provider}/${model.name} · type "exit" to leave`));

  let lastFromPersona = "";
  try {
    while (true) {
      const event = await dialogue.step();
      if (!event) break;

      if (event.participantId === person.id) {
        lastFromPersona = event.content;
        continue;
      }

      // Your turn just landed. Empty means you typed `exit`.
      if (!event.content.trim()) break;
      if (!learn) continue;

      try {
        await reflect({
          model,
          topic: {
            text: lastFromPersona || scene,
            at: 0,
            label:
              "In an ongoing conversation, picking up after the 36 questions",
          },
          contributions: [
            { profile: you, text: event.content },
            ...(lastFromPersona
              ? [{ profile: person, text: lastFromPersona }]
              : []),
          ],
          reconcile: false,
        });
        // Fold what they just learned back into their system prompt so the
        // next turn is spoken by someone who already knows it.
        refreshPersona(persona, {
          profile: person,
          partner: you,
          includeAnswers: true,
        });
        await Promise.all([saveProfile(person), saveProfile(you)]);
      } catch (err) {
        console.log(
          dim(
            `\n  ↳ memory update failed: ${err instanceof Error ? err.message : err}`,
          ),
        );
      }
    }
  } finally {
    // Release stdin whatever happened, and keep what was learned.
    prompter.close();
    await Promise.all([saveProfile(person), saveProfile(you)]);
  }

  console.log(
    `\n${bold("—")} ${dim(
      `${person.displayName} now holds ${person.facts.length} facts about themselves ` +
        `and ${(person.impressions[you.id] ?? []).length} impressions of you.`,
    )}`,
  );
  if (persistDir) console.log(dim(`transcript: ${persistDir}`));
}

await main().catch(die);
