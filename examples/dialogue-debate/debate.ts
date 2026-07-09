/**
 * Dialogue example: two personas debate a topic with a moderator deciding
 * who speaks and when the debate has run its course.
 *
 * Run:
 *   dotenvx run -- pnpm tsx examples/dialogue-debate/debate.ts "Is TypeScript worth it for small scripts?"
 *
 * Optional env: DEBATE_PROVIDER / DEBATE_MODEL (default openrouter + gemini flash).
 */

import "@umwelten/core/env/load.js";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import {
  Dialogue,
  InteractionParticipant,
  ModeratorPolicy,
  MODERATOR_INSTRUCTIONS,
} from "@umwelten/core/dialogue/index.js";

// Minimal ANSI helpers so the example has no extra dependencies.
const cyan = (t: string) => `[1;36m${t}[0m`;
const green = (t: string) => `[1;32m${t}[0m`;
const dim = (t: string) => `[2m${t}[0m`;

const topic = process.argv[2] ?? "Are microservices overrated for small teams?";

const model: ModelDetails = {
  provider: process.env.DEBATE_PROVIDER ?? "openrouter",
  name: process.env.DEBATE_MODEL ?? "google/gemini-3.1-flash-lite",
};

function persona(name: string, prompt: string): InteractionParticipant {
  return new InteractionParticipant({
    id: name.toLowerCase(),
    displayName: name,
    interaction: new Interaction(
      model,
      new Stimulus({ role: name, instructions: [prompt, "Keep each turn to 2-4 sentences."] }),
    ),
  });
}

const advocate = persona(
  "Advocate",
  `You argue passionately IN FAVOR of the proposition: "${topic}". Concede nothing without a fight.`,
);
const skeptic = persona(
  "Skeptic",
  `You argue AGAINST the proposition: "${topic}". Demand evidence and poke holes.`,
);

const moderator = new ModeratorPolicy(
  new Interaction(
    model,
    new Stimulus({
      role: "debate moderator",
      instructions: [...MODERATOR_INSTRUCTIONS, "Give both sides fair airtime."],
    }),
  ),
);

const colors = [cyan, green];
const colorFor = new Map([advocate, skeptic].map((p, i) => [p.id, colors[i]]));

const dialogue = new Dialogue({
  participants: [advocate, skeptic],
  policy: moderator,
  seed: { content: topic },
  stop: { maxTurns: 8 },
  observer: {
    onTurnStart: ({ participantId, displayName }) => {
      const color = colorFor.get(participantId) ?? ((t: string) => t);
      process.stdout.write(`\n${color(`[${displayName}]`)}\n`);
    },
    onTextDelta: (_id, delta) => process.stdout.write(delta),
    onTurnEnd: () => process.stdout.write("\n"),
    onStop: (reason) => process.stdout.write(dim(`\n— debate ended: ${reason} —\n`)),
  },
});

console.log(dim(`Debate: "${topic}" (${model.provider}/${model.name})`));
const result = await dialogue.run();
console.log(dim(`\n${result.turns} turns, stopped by ${result.stoppedBy}.`));
