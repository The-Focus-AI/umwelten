# Agent Dialogues

A **Dialogue** is a persisted, turn-orchestrated conversation between two or
more named **Participants** — habitat agents, ad-hoc personas, or humans (see
`CONTEXT.md` for the domain language). The engine lives in
`@umwelten/core/dialogue/` and powers three surfaces:

- the `umwelten converse` CLI command (human-initiated),
- the `agent_converse` habitat tool (agent-initiated),
- direct script usage (see `examples/dialogue-debate/`),
- a static, no-build web explorer (`examples/dialogue-web/` — bring your own
  OpenRouter key, streams in the browser).

## Quick start

Copy-paste from the repo root (uses the OpenRouter key from `.env`; no
habitat needed):

```bash
dotenvx run -- pnpm run cli converse "Are cats better than dogs?" \
  --persona "CatFan=You champion cats. 2 sentences per turn." \
  --persona "DogFan=You champion dogs. 2 sentences per turn." \
  -p openrouter -m google/gemini-3.1-flash-lite --max-turns 4
```

Each speaker streams live in its own color and the run ends with a
`Dialogue saved: …` line pointing at the session directory. Read it back with:

```bash
pnpm run cli sessions messages --session-dir ~/.umwelten/dialogues/<sessionId>
```

## How it works

The orchestrator (`Dialogue`) owns a single canonical event log. Each model
participant keeps its own private `Interaction`: its own turns land as
`assistant` messages, and everyone else's turns arrive batched into one
`user` message labeled `[Name]: text` — the same multi-speaker convention the
channel bridge uses for human group threads. Participants receive only the
events since their last turn, so tool traces stay private and prompt caches
stay warm.

Turn-taking is a pluggable `TurnPolicy`:

- **Round-robin** (default) cycles participants, skipping anyone who has
  signaled they are done.
- **Moderator** (`--moderator`) gives a moderator model the new messages each
  round; it picks the next speaker or ends the dialogue with a reason.

A participant signals it is finished by calling the `bow_out` tool — a
structured signal added to its toolset for the dialogue's duration (and
removed after), so leaving is a tool call rather than a magic string. A
trailing `<done/>` marker is still honored as a fallback for models that
imitate transcripts or can't call tools. The dialogue stops on `maxTurns`,
when all (or any, configurable) participants are done, on an abort signal,
or when the moderator calls it.

Besides spoken turns, the event log carries ambient **events** — world
input nobody "said" (an operator injection, an environment change). They
render unattributed as `(text)` in each participant's perception and persist
as `user` input. Inject one from a script with
`dialogue.post({ …, kind: "event" })`.

For long-running dialogues, an opt-in **history window** bounds each
participant's private view (under-glass style): its own past turns are
stored as one-line self-narrations (`[You said: "…"]`) and the view is
trimmed to the last N messages, so continuity comes from the persona plus
the recent window instead of an ever-growing transcript.

Dialogues persist as ordinary sessions (`transcript.jsonl` + `meta.json` with
`type: "dialogue"` and the participant roster). Where they land decides how
you read them back:

- **Habitat dialogues** (`--agent …` or the `agent_converse` tool) save into
  the habitat's sessions directory and show up in `umwelten browse` and the
  habitat sessions tooling like any other session.
- **Persona-only dialogues** (no habitat) save under
  `~/.umwelten/dialogues/<sessionId>` — a standalone location the browse
  adapters don't scan. Read them with
  `pnpm run cli sessions messages --session-dir ~/.umwelten/dialogues/<sessionId>`
  (add `--json` for the raw message objects).

## CLI: `umwelten converse`

```bash
# Ad-hoc personas (no habitat needed)
dotenvx run -- pnpm run cli converse "Are microservices overrated?" \
  --persona "Advocate=You argue in favor. 2-3 sentences per turn." \
  --persona "Skeptic=You argue against. 2-3 sentences per turn." \
  -p openrouter -m google/gemini-3.1-flash-lite --max-turns 6

# Habitat agents (personas built from each project's CLAUDE.md/README)
dotenvx run -- pnpm run cli converse "Should we adopt GraphQL?" \
  --agent backend --agent frontend --work-dir ~/my-habitat

# Different model per agent ("id:provider/model" overrides the habitat default)
dotenvx run -- pnpm run cli converse "Should we adopt GraphQL?" \
  --agent backend:openrouter/google/gemini-3.5-flash \
  --agent frontend:openrouter/openai/gpt-5-mini \
  --work-dir ~/my-habitat

# Moderated, with a different moderator model
dotenvx run -- pnpm run cli converse "Pick a name for the service" \
  --agent backend --agent frontend --work-dir ~/my-habitat \
  --moderator --moderator-model openrouter/openai/gpt-5-mini
```

Flags:

| Flag | Meaning |
| --- | --- |
| `--agent <spec>` | Habitat agent participant: `"id"` or `"id:provider/model"` for a per-agent model (repeatable; needs a habitat) |
| `--persona <spec>` | `"Name=prompt"` or `"Name:provider/model=prompt"` (repeatable) |
| `--work-dir <path>` | Habitat work directory for `--agent` participants |
| `-p` / `-m` | Default provider/model for personas and the moderator |
| `--max-turns <n>` | Stop after N total turns (default 8) |
| `--history-window <n>` | Bound each participant's private view to its last N messages (own turns become self-narrations) — keeps long dialogues cheap |
| `--moderator` | Moderator model picks speakers and can end the dialogue |
| `--moderator-model <provider/model>` | Override the moderator's model |
| `--json` | Print the transcript as JSON instead of streaming live |
| `--no-save` | Skip session persistence |
| `--session-id <id>` | Name the dialogue session |

Mixing `--agent` and `--persona` in one dialogue works. Live output colors
each speaker (join order → `speakerPalette`).

Persona dialogues (no habitat) save under `~/.umwelten/dialogues/<sessionId>`;
habitat dialogues save into the habitat's sessions directory (see
"How it works" above for how to read each back).

## Habitat tool: `agent_converse`

The main habitat agent can start dialogues between its managed agents:

```
agent_converse({ agentIds: ["backend", "frontend"], topic: "Should we adopt GraphQL?", maxTurns: 8 })
```

- 2–4 participants, `maxTurns` capped at 16 (agent-initiated dialogues burn
  tokens invisibly).
- Every participant is checked against the agent-call chain up front — the
  calling agent cannot pull itself into a dialogue (`AGENT_CALL_CYCLE`), and
  chain depth is bounded (`AGENT_CALL_DEPTH_EXCEEDED`). Each turn runs inside
  the chain, so a participant's own `agent_ask` calls stay bounded too.
- Participants get dialogue-scoped Interactions (same persona/tools/model as
  the agent, fresh history) so the dialogue doesn't pollute each agent's 1:1
  memory session.
- Returns `{ sessionId, participants, turnCount, transcript, truncated }` —
  the transcript is capped (last 12 turns, 1500 chars each); the full record
  lives in the session and can be read with the sessions tools.

## Script usage

```typescript
import { Dialogue, InteractionParticipant } from "@umwelten/core/dialogue/index.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";

const alice = new InteractionParticipant({
  id: "alice",
  displayName: "Alice",
  interaction: new Interaction(model, new Stimulus({ role: "optimist" })),
});
const bob = new InteractionParticipant({
  id: "bob",
  displayName: "Bob",
  interaction: new Interaction(model, new Stimulus({ role: "pessimist" })),
});

const dialogue = new Dialogue({
  participants: [alice, bob],
  seed: { content: "Will we ship on time?" },
  stop: { maxTurns: 6 },
  persistDir: "./my-dialogue-session",
});
const result = await dialogue.run();
```

`dialogue.step()` runs one turn at a time (for UIs that drive pacing), and
`dialogue.post()` injects an out-of-band entry — a spoken interjection by
default, or an ambient world event with `kind: "event"`:

```typescript
dialogue.post({
  participantId: "world",
  displayName: "World",
  content: "A third microservice has just gone down in production.",
  kind: "event",
});
```

A `HumanParticipant` can also hold a seat with a `getInput` callback.

`examples/dialogue-debate/debate.ts` is a complete moderated debate you can
run directly:

```bash
dotenvx run -- pnpm tsx examples/dialogue-debate/debate.ts \
  "Is TypeScript worth it for small scripts?"

# Override the model (defaults to openrouter + a gemini-3 flash variant):
DEBATE_PROVIDER=google DEBATE_MODEL=gemini-3-flash-preview \
  dotenvx run -- pnpm tsx examples/dialogue-debate/debate.ts "Tabs or spaces?"
```

## Web explorer

The dialogue explorer is a single static HTML page that runs the same
dialogue conventions in the browser — no build step, no server-side code. It
talks directly to OpenRouter's CORS-enabled API: pick models, define
personas, pose a question, and watch the turns stream live.

**Try it right now: [umwelten.thefocus.ai/dialogue/](https://umwelten.thefocus.ai/dialogue/)** —
it's hosted on this docs site (synced from `examples/dialogue-web/` at build
time by `docs:sync-assets`).

Or run it locally:

```bash
# Serve it with any static file server; from the repo root:
python3 -m http.server 7439 --directory examples/dialogue-web
# then open http://localhost:7439
```

Paste an OpenRouter API key into the key field (stored in `localStorage`,
sent only to `openrouter.ai`). The model picker populates without a key; the
dialogue itself needs one. See `examples/dialogue-web/README.md` for details.

## Extending

`Participant` is a small interface (`takeTurn(newEvents, ctx)`), so remote
participants are a natural follow-up: an A2A-backed participant would relay
labeled events to a remote habitat via `sendA2AMessageToUrl` with a stable
`contextId` per dialogue (the habitat A2A executor already threads sessions
by contextId).
