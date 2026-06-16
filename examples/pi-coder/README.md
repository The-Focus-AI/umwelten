# pi-coder — a habitat agent on the pi coding runtime

Same A2A surface as [`basic-agent`](../basic-agent/), but chatting with it
dispatches your message to the **pi coding runtime** instead of the default
LLM loop: it spawns `pi --mode json -p` against a code project and pi does real
work (read / edit / write files), streaming progress back over A2A.

This demonstrates the RuntimeRunner seam (#118/#122): the runtime is chosen
per-channel in `routing.json`, not by changing any agent code.

## Layout

```
pi-coder/
  config.json              # a "coder" agent whose projectPath is ./project
  routing.json             # binds the a2a channel to runtime: "pi"
  STIMULUS.md              # coder persona (used by the default path)
  project/app.js           # the sample project pi operates on
```

The binding that selects pi:

```json
// routing.json
{ "platformDefaults": { "a2a": { "agentId": "coder", "runtime": "pi" } } }
```

## Prerequisites

- `pi` on your `PATH` (the pi coding agent), configured with a working model.
- A provider key in `.env`.

## Run it

`projectPath` is `./project`, resolved relative to the CLI's working directory.
`run.sh` pins that directory to this example so the relative path resolves to
this example's `project/` and pi only ever touches files in here — fully
isolated. (For a real deployment, set `projectPath` to an absolute path.)

```bash
# Terminal 1 — serve (run.sh keeps the working dir pinned here)
examples/pi-coder/run.sh --port 7471

# Terminal 2 — chat (this triggers a real pi run against ./project)
dotenvx run -- pnpm run cli habitat chat --url http://127.0.0.1:7471 --one-shot "Create a file greeting.txt containing: hello from pi"
```

Expected: pi runs against `project/`, creates `project/greeting.txt`, and the
chat replies "Created greeting.txt." Files pi generates under `project/` are
gitignored (only the baseline `app.js` is committed), and nothing is written
outside this example dir.

## How it differs from basic-agent

| | basic-agent | pi-coder |
|---|---|---|
| Runtime | default Interaction (LLM + tools) | pi coding subprocess |
| Good for | conversation, tool calls | editing a code project |
| Selected by | (default) | `routing.json` → `runtime: "pi"` |
| Native session | habitat transcript | linked pi session log (`nativeSessionRef`) |
