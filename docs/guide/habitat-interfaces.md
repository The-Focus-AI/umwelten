# Habitat interfaces

A single [`Habitat`](../../src/habitat/habitat.ts) instance can be driven from different UIs. All paths share the same work directory, `config.json`, secrets, tool sets, skills, and on-disk sessions (`transcript.jsonl` per session).

## Surfaces

| Surface | Entry | Code |
| ------- | ----- | ---- |
| REPL / one-shot | `umwelten habitat` | [`src/cli/habitat.ts`](../../src/cli/habitat.ts) |
| Telegram | `umwelten habitat telegram` | [`src/ui/telegram/TelegramAdapter.ts`](../../src/ui/telegram/TelegramAdapter.ts) |
| Discord | `umwelten habitat discord` | [`src/ui/discord/DiscordAdapter.ts`](../../src/ui/discord/DiscordAdapter.ts) |
| Web + API | `umwelten habitat web` | [`src/habitat/gaia-server.ts`](../../src/habitat/gaia-server.ts), web UI under `src/ui/` |
| TUI (sessions) | `umwelten sessions tui` / `browse` | [`src/ui/tui/file-session.ts`](../../src/ui/tui/file-session.ts) |

## Discord presets (Jeeves)

The [Jeeves example](../../examples/jeeves-bot/README.md) is an **opinionated preset**: `JEEVES_*` env prefix, default work dir name, and a bundled stimulus template. You still run the **main** CLI:

```bash
dotenvx run -- pnpm run cli -- habitat discord --token "$DISCORD_BOT_TOKEN" \
  --work-dir /path/to/jeeves-bot-data-dir \
  --env-prefix JEEVES
```

(Adjust `--work-dir` to your data directory; set `JEEVES_PROVIDER` / `JEEVES_MODEL` as needed.)

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

- [Habitat](habitat.md) — work dir, tools, agents
- [Web](web.md) — Gaia server and browser UI
- [Session management](session-management.md) — external session index/search
