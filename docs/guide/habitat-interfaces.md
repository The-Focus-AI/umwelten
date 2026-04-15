# Habitat Interfaces

A single [`Habitat`](../../src/habitat/habitat.ts) instance can be driven from different UIs. All interfaces share the same work directory, `config.json`, secrets, tool sets, skills, on-disk sessions, and the [ChannelBridge](./habitat-routing.md) routing layer.

## Surfaces

| Surface | CLI Command | Code | mise Task |
| ------- | ----------- | ---- | --------- |
| REPL / one-shot | `umwelten habitat` | [`src/cli/habitat.ts`](../../src/cli/habitat.ts) | `mise run habitat` |
| Local agent | `umwelten habitat local` | [`src/cli/habitat.ts`](../../src/cli/habitat.ts) | — |
| Telegram | `umwelten habitat telegram` | [`src/ui/telegram/TelegramAdapter.ts`](../../src/ui/telegram/TelegramAdapter.ts) | `mise run habitat-telegram` |
| Discord | `umwelten habitat discord` | [`src/ui/discord/DiscordAdapter.ts`](../../src/ui/discord/DiscordAdapter.ts) | `mise run habitat-discord` |
| Web + API | `umwelten habitat web` | [`src/habitat/gaia-server.ts`](../../src/habitat/gaia-server.ts) | `mise run habitat-web` |
| TUI (sessions) | `umwelten sessions tui` | [`src/ui/tui/file-session.ts`](../../src/ui/tui/file-session.ts) | — |

## Quick start (with mise)

The repo includes [mise](https://mise.jdx.dev) tasks that handle environment variables and work directory configuration automatically:

```bash
# Set up env
cp examples/jeeves-bot/env.example examples/jeeves-bot/.env
# Edit .env with your API keys

# Run any interface
mise run habitat            # CLI REPL
mise run habitat-web        # Web on :3000
mise run habitat-telegram   # Telegram bot
mise run habitat-discord    # Discord bot
```

All tasks share one work directory (`examples/jeeves-bot/jeeves-bot-data-dir`) so config, agents, and tools are consistent.

## Quick start (without mise)

```bash
# Always use dotenvx to load .env keys
dotenvx run -- pnpm run cli -- habitat -p google -m gemini-3-flash-preview
dotenvx run -- pnpm run cli -- habitat telegram --token $TELEGRAM_BOT_TOKEN
dotenvx run -- pnpm run cli -- habitat discord --token $DISCORD_BOT_TOKEN
dotenvx run -- pnpm run cli -- habitat web --port 3000
```

## ChannelBridge — unified adapter layer

All platform adapters (Telegram, Discord, Web) go through the **ChannelBridge**, which handles:

- Interaction caching (one per channel key)
- Route resolution (channel → agent via `routing.json`)
- Transcript resume on restart
- Transcript persistence on every update
- Unified slash commands (`/switch`, `/agents`, `/status`, `/reset`, `/help`)

See [Channel Routing](./habitat-routing.md) for details on routing configuration and slash commands.

## Discord presets (Jeeves)

The [Jeeves example](../../examples/jeeves-bot/README.md) is an **opinionated preset**: `JEEVES_*` env prefix, bundled stimulus template, and a ready-to-go data directory. You still run the **main** CLI:

```bash
dotenvx run -f examples/jeeves-bot/.env -- pnpm run cli -- habitat discord \
  --token "$DISCORD_BOT_TOKEN" \
  -w examples/jeeves-bot/jeeves-bot-data-dir \
  --env-prefix JEEVES
```

## Agent MCP server management

Agents can run as standalone MCP servers. Manage them from the CLI:

```bash
umwelten habitat agent start <agent-id>    # Start an agent's MCP server
umwelten habitat agent stop <agent-id>     # Stop it
umwelten habitat agent status [agent-id]   # Check health (all agents if no ID)
```

Or from the REPL: `/agent-start <id>`, `/agent-stop <id>`, `/agent-status [id]`.

## Secrets management

```bash
umwelten habitat secrets list              # List stored secret names
umwelten habitat secrets set <name> <val>  # Store a secret
umwelten habitat secrets set <name> --from-op "op://vault/item/key"  # From 1Password
umwelten habitat secrets remove <name>     # Remove a secret
```

## Native session introspection

Habitat sessions on disk are introspected with:

```bash
umwelten sessions habitat list --work-dir /path/to/work
umwelten sessions habitat show <session-id-prefix>
umwelten sessions habitat beats <session-id-prefix> [--topic …]
umwelten sessions habitat pull <session-id-prefix> <beat-index> --output beat.json
umwelten sessions habitat replay beat.json
```

External editor sessions (Claude Code, Cursor) use `umwelten sessions list|show|search|…` with `--project`.

## See also

- [Habitat](habitat.md) — work directory, tools, agents
- [Channel Routing](habitat-routing.md) — routing.json and ChannelBridge deep dive
- [Web](web.md) — Gaia server and browser UI
- [Jeeves Discord Guide](jeeves-discord.md) — Discord bot preset
- [Habitat Testing](habitat-testing.md) — automated and manual test procedures
- [Session Management](session-management.md) — external session index/search
- [Habitat Setup Walkthrough](../walkthroughs/habitat-setup-walkthrough.md) — hands-on tutorial
