# Connection quiz

Aron et al.'s 36 questions as an Umwelten example. The interview is a core
**Dialogue**: a `ScriptedRoundPolicy` walks you → Alex → you → Alex each
question, and `onTurnComplete` extracts memory and opens the next round. The
browser is a thin client (render + SSE). A second endpoint speaks the standard
habitat chat protocol so the shipped UI works against the same quiz.

```
browser ──POST /answer──► server.ts ──► ConnectionQuiz
                                           │
                                           ├─ Dialogue + ScriptedRoundPolicy
                                           ├─ ConnectionPartner (Stimulus / Interaction)
                                           ├─ generateObject memory extract
                                           └─ ~/.umwelten/connection-quiz/<id>/
```

## Run

```bash
# Ollama with gemma4:26b (default), or set CONNECTION_PROVIDER / CONNECTION_MODEL
dotenvx run -- pnpm tsx examples/connection-quiz/server.ts
# → http://localhost:7431
#    POST /api/chat also accepts the habitat UiMessageStream protocol
```

## What uses Umwelten core

| Concern | Core API |
| --- | --- |
| Round shape | `Dialogue` + `ScriptedRoundPolicy` + `onTurnComplete` |
| Human seat | `HumanParticipant` (async `getInput` parked on the HTTP request) |
| Partner replies | `ConnectionPartner` → `Stimulus` + `Interaction.streamText` |
| Memory panels | `Interaction.generateObject` with a local Zod schema |
| Transcript | `writeDialogueSession` (browse-readable `dialogue` session) |
| Standard chat UI | `UiMessageStream` on `POST /api/chat` |
| Env / providers | `@umwelten/core/env/load.js` + provider registry via Interaction |

Stock `extractFacts` is **not** used — it only types facts from the last user
message. This demo needs `{ aboutYou, aboutThem, connection }` with motivations,
so the extract lives in `partner.ts` but still runs through core `generateObject`.

## Files

| File | Role |
| --- | --- |
| `server.ts` | HTTP + SSE + `/api/chat` |
| `quiz.ts` | Dialogue driver (policy, resume, public view) |
| `partner.ts` | Partner Participant + memory extract |
| `questions.ts` | Aron 36 questions |
| `public/` | Thin UI (`client.js` has no model calls) |

## Tests

```bash
pnpm vitest run --config examples/connection-quiz/vitest.config.ts
```

## Resume

Sessions live under `~/.umwelten/connection-quiz/<id>/` (`quiz.json` + the
canonical dialogue `transcript.jsonl` / `meta.json`). The browser only stores
the session id in `localStorage` so **Continue** can reload server state after
a refresh.
