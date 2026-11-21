# Telegram Bot

The standalone `umwelten telegram` command has been retired. The habitat-aware telegram bot does everything the old command did and more — see **[Habitat → Telegram](./habitat.md#telegram-bot)** for the canonical guide.

## Quick start

```bash
# Use any directory as the habitat workdir (or pass --work-dir <path>)
umwelten habitat telegram -p google -m gemini-3-flash-preview
```

You'll need:
- A bot token from [@BotFather](https://t.me/BotFather), exported as `TELEGRAM_BOT_TOKEN` or passed via `--token`
- A provider API key (`GOOGLE_GENERATIVE_AI_API_KEY`, `OPENROUTER_API_KEY`, etc.)

## Why the change?

The previous `umwelten telegram` was a no-habitat shortcut: hard-coded "helpful assistant" stimulus, optional math demo tools, basic media dir. Anything beyond a smoke test ran into its lack of session persistence, transcript resume, channel routing, sub-agents, and skills.

`umwelten habitat telegram` shares the same `@umwelten/ui/telegram/TelegramAdapter` under the hood and adds:

| Capability | Standalone (gone) | Habitat |
|---|---|---|
| Bot transport (grammY) | ✅ | ✅ |
| Media (images, PDFs, audio, video) | ✅ | ✅ |
| Markdown formatting | ✅ | ✅ |
| Per-chat conversation history | in-memory only | persistent session + transcript |
| Stimulus from `STIMULUS.md` | hard-coded | habitat workdir |
| Sub-agents, tools, skills, secrets | math-demo only | full habitat surface |
| `ChannelBridge` routing | no | yes |
| Transcript resume on restart | no | yes |

## See also

- **[Habitat guide](./habitat.md)** — full habitat reference, including the `telegram` subcommand
- **[Habitat interfaces](./habitat-interfaces.md)** — how Telegram, Discord, web, and TUI share one `ChannelBridge`
- **[Jeeves Bot](./jeeves-bot.md)** — a long-running Telegram bot as a worked example
