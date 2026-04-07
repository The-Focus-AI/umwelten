# Jeeves: Discord

Run the Jeeves habitat as a Discord bot: one **main** persona (butler) in most channels, optional **sub-agents** per channel or thread. Routing is stored in `discord.json` under your work directory; you usually set it with slash commands instead of editing the file by hand.

For how Jeeves relates to Habitat, agents, and tools, see [Jeeves Bot](./jeeves-bot.md). **This page is the Discord quickstart.**

## Prerequisites

1. **Discord application** — [Discord Developer Portal](https://discord.com/developers/applications) → New Application → Bot → **Reset Token** and copy it.
2. **Message Content Intent** — Bot → *Privileged Gateway Intents* → turn **ON** *Message Content Intent*. Without this, the gateway closes with disallowed intents (e.g. close code **4014**).
3. **Invite URL** — OAuth2 → URL Generator: scopes `bot` + `applications.commands`. Grant permissions to **read/send messages** (and **Manage Channels** if you will use `/provision` or channel creation).
4. **LLM API key** — e.g. `GOOGLE_GENERATIVE_AI_API_KEY` for the default Google provider (see `examples/jeeves-bot/env.example`).

## 1. Environment and work directory

Copy the example env and set at least the token and keys:

```bash
cd examples/jeeves-bot
cp env.example .env
# Edit .env: DISCORD_BOT_TOKEN, GOOGLE_GENERATIVE_AI_API_KEY, JEEVES_WORK_DIR (optional)
```

- **`JEEVES_WORK_DIR`** — Config, prompts, `config.json`, optional `discord.json`. Default: `~/.jeeves`.
- **`JEEVES_SESSIONS_DIR`** — Transcripts and media per Discord channel/thread. Default: `~/.jeeves-sessions`.
- **`DISCORD_GUILD_ID`** — *Recommended for development.* Registers slash commands in **one guild** so new commands appear quickly. Omit for global registration (Discord can take up to about an hour).
- **`DISCORD_ROUTING_PATH`** — Optional absolute path to routing JSON (default: `<JEEVES_WORK_DIR>/discord.json`).
- **`DISCORD_BACKFILL_ON_START`** — Default (unset): after login, the bot **fetches recent history** (REST) for Discord session channels that already have a folder under `JEEVES_SESSIONS_DIR` with **`lastUsed` within ~7 days**, and replies once to **user text** left while it was offline (several messages in a row are **combined** into one model turn). The gateway does **not** replay missed `messageCreate` events, so this fills the gap. **Limitation:** a thread or DM that **never** had a session on disk yet (no prior bot traffic in that channel) is not scanned until the first live message creates `discord-{id}/`. Set to **`0`** to disable. **Attachment-only** messages while offline are not replayed in this pass.

## 2. Check the connection (script)

From the **repository root** (with [dotenvx](https://dotenvx.com) and the repo’s `pnpm` deps):

```bash
mise run jeeves-discord-check
```

Or:

```bash
dotenvx run -f examples/jeeves-bot/.env -- pnpm exec tsx examples/jeeves-bot/scripts/check-discord-setup.ts
```

The script verifies:

- `DISCORD_BOT_TOKEN` is set and valid (calls Discord’s `@me` API).
- Work directory and `config.json` (when present).
- Optional `discord.json`.
- Provider API key for `JEEVES_PROVIDER` / `JEEVES_MODEL`.

Exit code **1** if something critical is missing or the token is invalid.

From **`examples/jeeves-bot`** (with local `pnpm install`):

```bash
pnpm run check-discord
```

## 3. Run the bot

**Repository root** (same env pattern as the check):

```bash
mise run jeeves-discord
```

Or:

```bash
dotenvx run -f examples/jeeves-bot/.env -- pnpm exec tsx examples/jeeves-bot/discord.ts
```

**Generic Habitat CLI** (any work dir; `--env-prefix` matches your `.env` keys):

```bash
dotenvx run -- pnpm run cli habitat discord -w ~/.jeeves --env-prefix JEEVES \
  -p google -m gemini-3-flash-preview --token "$DISCORD_BOT_TOKEN"
```

Optional: `--discord-guild <snowflake>` or `DISCORD_GUILD_ID` for guild-scoped slash commands.

## 4. Map channels to agents

**Easiest:** in Discord, use slash commands (requires **Manage Channels** on your user for bind/unbind):

| Command | Purpose |
|--------|---------|
| `/bind-agent` | Set **this** channel or **thread** to a habitat **agent id** from `config.json`. |
| `/unbind-agent` | Remove mapping; thread inherits parent channel, then defaults / main. |
| `/start` / `/reset` | Start fresh or clear history for **this** channel/thread. |
| `/help` | Short in-app help. |

**Admins only:**

| Command | Purpose |
|--------|---------|
| `/reload-routing` | Clears **all** in-memory Discord sessions (pick up `discord.json` changes). |
| `/provision` | Create a new text channel for an agent (needs `DISCORD_AUTO_CHANNELS=1` and bot **Manage Channels**). |

**Routing rules:**

1. Exact match for the current channel or thread snowflake.
2. If you are in a **thread** and it is not mapped, the **parent text channel** mapping is used.
3. Otherwise **main** Jeeves stimulus (or `defaultAgentId` / `mainChannelId` if set in `discord.json`).

Thread IDs are separate snowflakes: bind the thread explicitly if you want a different agent than the parent channel.

### When the bot replies (Jeeves / `habitat discord`)

- **Sub-agent bound** (`/bind-agent` or `discord.json` maps this channel/thread to a **real** agent in `config.json`): the bot answers **every** message (and attachments) in that channel or thread.
- **Not bound** (main / unmapped / unknown agent id in the map):
  - **@mention** is required for the **first** message in a **DM** or **thread**, and for **every** message in a **parent text channel** (the bot opens a thread from that message).
  - **Follow-ups** in the **same** DM or thread **do not need @mention** after the bot has replied once, until `/reset` or `/reload-routing`. **After a bot restart**, that behavior is **restored from `transcript.jsonl`**: if the session directory already contains an assistant line, the thread/DM stays unlocked without another @mention.
  - **Where it replies:** **DM** — in the DM. **Existing thread** — in that thread (**each thread** uses a stable on-disk session `discord-{threadId}`). **Parent text channel** — creates a new thread (needs **Create Public Threads** + **Send Messages in Threads**), names it from your message, replies there, and **renames the thread** periodically (about every 90s max) as `Jeeves · …`.
- **`defaultAgentId`** in `discord.json` counts as a dedicated agent route for unlisted channels — those channels get full auto-reply (same as a bound sub-agent).

Slash commands (`/start`, `/help`, etc.) always work when Discord shows them; this gate applies to normal messages and attachments only. `/start` and `/reset` in a **Discord thread** clear that thread’s session in place (stable mode).

**Optional file:** `discord.json` in the work dir (see `examples/jeeves-bot/discord.json.example`). You can still edit it by hand; slash commands and tools update the same file.

## 5. Smoke test in Discord

1. Invite the bot to a server; open a channel it can read.
2. Run **`/help`** — confirms slash commands registered.
3. Send a short message — confirms **Message Content Intent** and model credentials.
4. (Optional) Run **`/bind-agent`** with an agent id from your `config.json`, send another message — should use that agent’s stimulus.

Sessions and media live under:

`{JEEVES_SESSIONS_DIR}/discord-{channelOrThreadId}/`

## DMs (private messages to the bot)

The bot listens in **servers** and in **DMs** with the same code path. Your DM with the bot is a separate “channel” (its own snowflake); sessions are stored under `discord-<that id>/`.

- **`/bind-agent` / `/unbind-agent`** only work in a **server** (they need guild context and **Manage Channels**). In DMs you always get the **main** Jeeves stimulus unless you change routing another way.
- Use **`/start`**, **`/reset`**, **`/help`** in DMs if slash commands show up there (depends on how Discord lists the app’s commands for you).

## Troubleshooting

**I message the bot in DM and nothing happens**

1. **Restart the bot** after updating umwelten — the adapter enables **channel partials** so the first DM is not dropped when the DM channel was not cached yet (discord.js would otherwise skip `messageCreate`).
2. **Message Content Intent** must be ON in the Developer Portal (Bot tab).
3. **Direct messages**: the client requests the **Direct Messages** intent; no extra portal toggle beyond the usual privileged intents bundle, but the bot must not be blocked by the user.
4. Confirm the **process is running** and the terminal shows an incoming line like `[hh:mm:ss] ← [<channelId>] @you: ...` when you send a message. If guild messages log but DMs do not, it was almost certainly the partials/cache issue (fixed in current code).

**Slash commands missing**

- Set **`DISCORD_GUILD_ID`** (or `--discord-guild`) while testing so commands register to one server quickly. Global commands can take up to about an hour.

**Bot answers in the server but errors or is empty**

- Check provider API keys and model id in `.env`. See terminal stderr for stack traces.

## See also

- [Jeeves Bot](./jeeves-bot.md) — full Jeeves overview, Telegram, CLI, agents.
- [Habitat](./habitat.md) — work directory, tools, sessions.
- [examples/jeeves-bot README](https://github.com/The-Focus-AI/umwelten/blob/main/examples/jeeves-bot/README.md) — env reference and feature list.
