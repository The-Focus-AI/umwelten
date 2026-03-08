# MCP Chat Example (TezLab)

This example is a small single-user CLI chat app that connects to the **TezLab MCP server** at `https://mcp.tezlabapp.com`.

It demonstrates:

- a chat loop built on the repo's existing `Habitat` + `Interaction` patterns
- MCP tool loading at startup
- browser-based OAuth for a remote MCP server
- safe default behavior with **read-only** MCP scope

## What it does

- opens a local browser-based OAuth flow on first run
- stores TezLab OAuth state outside the Habitat work directory
- loads TezLab MCP tools into the chat agent before the session starts
- lets you ask questions like:
  - `How much did I spend charging last month?`
  - `What does my battery health look like?`
  - `Show me recent driving patterns.`

## Safety defaults

This example is intentionally conservative:

- it requests `mcp` scope by default
- it does **not** expose write-capable vehicle command tools unless you opt in
- it stores OAuth tokens **outside** the chat work directory so the model cannot read them through local file tools
- built-in file and shell tools are disabled for this example so the agent stays focused on TezLab MCP data

## Setup

From the repository root:

```bash
cp examples/mcp-chat/env.example examples/mcp-chat/.env
```

Then load the env file however you prefer. For example:

```bash
cd examples/mcp-chat
set -a && source .env && set +a
```

You also need credentials for the language model provider you want to use, such as:

- `GOOGLE_GENERATIVE_AI_API_KEY`
- `OPENAI_API_KEY`

## Run

From the repository root:

```bash
set -a && source examples/mcp-chat/.env && set +a
pnpm exec tsx examples/mcp-chat/cli.ts
```

Or from the example directory:

```bash
cd examples/mcp-chat
set -a && source .env && set +a
pnpm run cli
```

### First run behavior

The first time you run it:

1. the CLI connects to `https://mcp.tezlabapp.com`
2. TezLab requests OAuth authorization
3. your browser opens to TezLab sign-in/consent
4. the CLI listens on `http://127.0.0.1:$MCP_CHAT_OAUTH_PORT/callback`
5. after approval, the example finishes the token exchange and starts the chat session

## Usage

Interactive commands:

- `/help` — show REPL commands
- `/tools` — list currently available MCP tools
- `/context` — show approximate context size
- `/logout` — clear saved TezLab OAuth credentials
- `/exit` or `/quit` — leave the REPL

One-shot usage:

```bash
pnpm exec tsx examples/mcp-chat/cli.ts "How much did I spend charging last month?"
```

## Environment variables

| Variable | Purpose |
|---|---|
| `MCP_CHAT_PROVIDER` | LLM provider for the chat agent |
| `MCP_CHAT_MODEL` | LLM model name |
| `MCP_CHAT_SERVER_URL` | MCP server URL, defaults to `https://mcp.tezlabapp.com` |
| `MCP_CHAT_SCOPE` | OAuth scope, defaults to `mcp` |
| `MCP_CHAT_OAUTH_PORT` | Local callback port |
| `MCP_CHAT_OAUTH_TIMEOUT_MS` | Timeout while waiting for browser login |
| `MCP_CHAT_WORK_DIR` | Optional Habitat work dir |
| `MCP_CHAT_SESSIONS_DIR` | Optional sessions directory |
| `MCP_CHAT_AUTH_STORE` | Optional override for the OAuth state file |
| `MCP_CHAT_ALLOW_COMMANDS` | If `true`, include write-capable vehicle command tools |

## OAuth/token storage

By default, OAuth state is stored at:

```text
~/.umwelten/mcp-chat/tezlab-oauth.json
```

This is **outside** the Habitat work directory on purpose, so the model cannot read the token file with local tools.

## Opting in to command-capable tools

The default example is read-only. If you intentionally want command tools too, you must opt in:

```bash
export MCP_CHAT_SCOPE="mcp mcp_commands"
export MCP_CHAT_ALLOW_COMMANDS=true
```

Do this only if you specifically want write-capable TezLab tools available to the chat agent.