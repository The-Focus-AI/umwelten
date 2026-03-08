# MCP Chat Example

`examples/mcp-chat/` is a standalone CLI chat example that connects Umwelten to a remote MCP server using OAuth.

The first target is **TezLab MCP** at `https://mcp.tezlabapp.com`, so you can chat with your Tesla or Rivian data through the repo's Habitat + Interaction runtime.

## What this example demonstrates

- a small single-user CLI chat app
- MCP tools loaded into a Habitat at startup
- browser-based OAuth for a remote MCP server
- a safer default read-only scope (`mcp`)
- keeping OAuth tokens outside the Habitat work directory

This makes it a good reference for building agent-style apps that consume remote MCP servers instead of only local stdio servers.

## Files

The example lives in:

```text
examples/mcp-chat/
  cli.ts
  habitat.ts
  tezlab-mcp.ts
  MCP_CHAT_PROMPT.md
  env.example
  README.md
```

## Quick start

From the repository root:

```bash
cp examples/mcp-chat/env.example examples/mcp-chat/.env
```

Edit `.env` and provide:

- your model provider settings (`MCP_CHAT_PROVIDER`, `MCP_CHAT_MODEL`)
- the provider API key for that model

Then run:

```bash
set -a && source examples/mcp-chat/.env && set +a
pnpm exec tsx examples/mcp-chat/cli.ts
```

On first run the CLI will:

1. connect to the TezLab MCP server
2. detect that OAuth is required
3. open a browser window for login/consent
4. listen on a local callback URL
5. finish the token exchange and load the available TezLab tools

## One-shot prompt usage

You can also pass a prompt directly on the CLI:

```bash
set -a && source examples/mcp-chat/.env && set +a
pnpm exec tsx examples/mcp-chat/cli.ts \
  "Tell me the story of the last 10 days of my Tesla's activity. Use the MCP tools to look at drives, charging, battery health, and any other relevant data. Summarize it like a narrative first, then give me a short bullet list of the key events and patterns you found."
```

Or only print the final answer:

```bash
set -a && source examples/mcp-chat/.env && set +a
pnpm exec tsx examples/mcp-chat/cli.ts --quiet \
  "Analyze the last 10 days of my Tesla's activity and tell it back to me as a story. Include charging sessions, drives, notable patterns, battery or efficiency observations, and anything unusual. After the story, give me the top 5 takeaways."
```

## REPL commands

When running interactively:

- `/help` — show REPL commands
- `/tools` — list loaded MCP tools
- `/context` — show approximate context size
- `/logout` — clear saved OAuth credentials
- `/exit` or `/quit` — exit the session

## Safety defaults

The example is intentionally conservative:

- it requests `mcp` scope by default
- it filters out write-capable vehicle command tools unless you explicitly opt in
- it stores OAuth tokens outside the Habitat work directory
- it disables broad built-in file/shell tools so the chat session stays focused on TezLab MCP data

## Opting in to command-capable tools

If you intentionally want command tools too, set:

```bash
export MCP_CHAT_SCOPE="mcp mcp_commands"
export MCP_CHAT_ALLOW_COMMANDS=true
```

Do this only if you specifically want write-capable TezLab actions available to the agent.

## Why this example matters

Most earlier MCP examples in the repo focused on local or infrastructure-oriented servers. This example shows the next step:

- **remote MCP**
- **OAuth-protected MCP**
- **real user data** in a small app shell

It is the reference example for integrating Umwelten with a hosted MCP product instead of just local tool processes.

## See also

- [Habitat](./habitat.md)
- [MCP Implementation Summary](../MCP_IMPLEMENTATION_SUMMARY.md)
- [`examples/mcp-chat/README.md`](https://github.com/The-Focus-AI/umwelten/blob/main/examples/mcp-chat/README.md)