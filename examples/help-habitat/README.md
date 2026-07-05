# Help habitat

The conversational **@Help** agent for [Habitats](https://habitats.thefocus.ai):
a docs-grounded product guide users can mention in any room. Its persona and
product knowledge live in `STIMULUS.md`; it runs on the base habitat image, so
deployment is just seeding `config.json` + `STIMULUS.md` onto the container
volume (Gaia binds `OPENROUTER_API_KEY`).

## Talking to Gaia

Help can optionally answer **live operational questions** ("which agents are
running?", "is the Twitter agent up?") by delegating to the Gaia orchestrator
over A2A. `config.json` declares Gaia as a `remote-habitat` agent, which
activates the runtime's `ask_remote_agent` tool:

| Secret | Purpose |
| --- | --- |
| `GAIA_A2A_URL` | Base URL of Gaia's A2A endpoint (e.g. `https://gaia.habitats.example.com`, or `http://172.17.0.1:7420` when the container can reach the host directly). |
| `GAIA_A2A_TOKEN` | Bearer token for Gaia's `/a2a` (its `HABITAT_API_KEY`). Omit if Gaia runs open. |

Both secrets are optional — without them Help simply answers from its built-in
product knowledge and points users at their operator for live status.

## Changelog ("what's new?")

`CHANGELOG.md` holds dated, user-facing release notes and is loaded into
Help's context via `config.memoryFiles`, so it can answer "what's new?" and
"when did X change?" accurately. When you ship something user-visible:

1. Add a dated entry to `CHANGELOG.md` (newest first, written for end users).
2. Copy the updated file onto the Help volume next to `STIMULUS.md`.
3. Restart the container so the new context loads.

If the file is missing from the volume, Help degrades gracefully and says it
has no release notes.
