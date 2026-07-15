# Help habitat

The conversational **@Help** agent for [Habitats](https://habitats.thefocus.ai):
a docs-grounded product guide users can mention in any room. Its persona and
product knowledge live in `STIMULUS.md`; dated release knowledge lives in
`CHANGELOG.md`. It runs on the base habitat image, so deployment seeds all three
files onto the container volume (Gaia binds `OPENROUTER_API_KEY`).

## Capability boundary

`config.json` uses `enabledToolSets` to give Help only the capabilities its role
needs:

| Tool set | Purpose |
| --- | --- |
| `time` | Resolve an exact date/time when it matters. |
| `room-history` | Read recent context from the current room when a question depends on it. |
| `remote-agents` | Ask Gaia read-only status and availability questions. |

Generic managed-container capabilities such as shell execution,
self-modification, provisioning, file writes, and secret management are not
loaded. `loadWorkDirTools` and `loadSkills` are also disabled so files left on a
volume cannot silently expand Help's tool surface. The stimulus separately
forbids using Gaia as an indirect mutation path.

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
product knowledge and points users at their operator for live status. Help must
not relay URLs from Gaia responses because Gaia UI URLs may contain auth tokens.

## Keeping product knowledge current

The user-facing truth is the current `habitats` SaaS, while operational truth is
the current umwelten runtime. When either changes, audit Help against:

- `../habitats/src/lib/habitats-create/` and
  `../habitats/src/lib/habitats-configure/` for current UI labels and roles;
- `../habitats/src/lib/server/` and `../habitats/src/workflows/agents/umwelten.ts`
  for attach, identity, connection, and thread behavior;
- `../habitats/OPERATIONS.md` for the current SaaS/runtime/agent deploy loops;
- `docs/guide/operating-production.md` and
  `packages/habitat/templates/gaia-stimulus.md` for Gaia's operator model.

Keep three concepts explicit: creating a room, attaching an existing agent, and
provisioning a new agent service. The current web product supports the first two;
the third remains an operator/developer workflow through an agent repo and Gaia.

## Changelog ("what's new?")

`CHANGELOG.md` holds dated, user-facing release notes and is loaded into
Help's context via `config.memoryFiles`, so it can answer "what's new?" and
"when did X change?" accurately. When you ship something user-visible:

1. Add a dated entry to `CHANGELOG.md` (newest first, written for end users).
2. Copy the updated `config.json`, `STIMULUS.md`, and `CHANGELOG.md` onto the
   Help volume.
3. Restart or rebuild the Help container so config, prompt, and context reload.
4. Run the Help habitat setup test before deployment.

If the file is missing from the volume, Help degrades gracefully and says it
has no release notes.
