# Multi-A2A Pi End-to-End Demo

Reproducible end-to-end test and interactive sandbox for driving **multiple remote A2A 1.0 agents** from the `pi` coding agent via [`@leocavalcante/pi-a2a`](https://github.com/leocavalcante/pi-a2a).

Each run boots two isolated HTTP + SQLite `DurableHabitat` A2A 1.0 servers (`researcher` and `reviewer`) on separate loopback ports with per-agent bearer tokens, verifies `/.well-known/agent-card.json` discovery and fail-closed `401` auth, writes an isolated temporary `agents.json`, and drives both agents through `pi`.

## Clean-Machine Single Command

```zsh
./examples/multi-a2a/clean-machine.sh
```

Checks Node (`>= 22`) and `pnpm`, installs workspace dependencies if `node_modules` is absent, installs `@earendil-works/pi-coding-agent` globally if `pi` is missing, and runs the full automated verification with zero API keys required.

## Workspace Recipes

Run automated verification (offline `fauxProvider` agent backends):

```zsh
pnpm run demo:multi-a2a
```

Keep both A2A agents running and drop into an interactive `pi` TUI connected to both:

```zsh
pnpm run demo:multi-a2a -- --interactive
```

Run with a real model backend plus an LLM-orchestrated multi-agent Pi turn:

```zsh
pnpm run demo:multi-a2a -- --live --model google:gemini-4-hydrogen
```

## Standalone Setup (Connecting to Any Remote A2A Agents Outside This Repo)

1. Install Pi and the A2A extension:

```zsh
pnpm add -g @earendil-works/pi-coding-agent
pi install npm:@leocavalcante/pi-a2a
```

2. Configure multiple remote A2A endpoints in `~/.pi/a2a/agents.json` (each agent needs its own origin — port or host — so `/.well-known/agent-card.json` resolves distinctly):

```json
{
  "agents": {
    "researcher": {
      "url": "https://researcher.example.com",
      "bearerTokenEnv": "RESEARCHER_A2A_TOKEN"
    },
    "reviewer": {
      "url": "https://reviewer.example.com",
      "bearerTokenEnv": "REVIEWER_A2A_TOKEN"
    }
  }
}
```

3. Start `pi` and either run manual commands (`/a2a list`, `/a2a send researcher ...`, `/a2a send reviewer ...`) or ask Pi's model to delegate across them via `a2a_agents` and `a2a_send`.
