# Dialogue web explorer

A single static HTML file for exploring agent Dialogues in the browser:
enter your OpenRouter key, add participants (name + model + persona), pose a
question, and watch them talk it out with live streaming.

No build step, no dependencies, no server-side code — the browser talks
directly to OpenRouter's CORS-enabled API:

- `GET /api/v1/models` populates the model picker (no key needed)
- `POST /api/v1/chat/completions` with `stream: true` streams each turn (SSE)

Your API key is kept in `localStorage` and only ever sent to
`openrouter.ai`.

## Run it

```bash
# any static file server works; from the repo root:
python3 -m http.server 7439 --directory examples/dialogue-web
# then open http://localhost:7439
```

(Opening `index.html` directly with `open index.html` also works in most
browsers, since OpenRouter allows cross-origin requests.)

## What it demonstrates

The page reimplements the `@umwelten/core/dialogue` conventions in ~150
lines of vanilla JS (see the `runDialogue` function):

- one canonical event log; each participant keeps a private message history
- other participants' turns arrive batched as one `user` message labeled
  `[Name]: text`; a participant's own replies are its `assistant` turns
- round-robin turn-taking; a participant bows out by ending a message with
  `<done/>` (stripped from display); the dialogue stops at max turns or when
  everyone is done
- echoed self-prefixes (`[Advocate]: …`) are stripped, mirroring
  `InteractionParticipant`

It is intentionally standalone — a demonstration of the wire-level
conventions, not an import of the TypeScript engine. For the full engine
(habitat agents, moderator policy, session persistence) use
`umwelten converse` or `examples/dialogue-debate/` — see
`docs/guide/agent-dialogues.md`.
