# Umwelten

**Habitat** (agent environments with tools, sessions, and sub-agents) plus **systematic model evaluation** across Google (Gemini), OpenRouter, Ollama, LM Studio, GitHub Models, DeepInfra, Together, and more. TypeScript / Node 20+.

## Install

From npm (CLI):

```bash
pnpm add -g umwelten
# or: npm install -g umwelten
```

From source:

```bash
git clone https://github.com/The-Focus-AI/umwelten.git
cd umwelten
pnpm install
pnpm build
```

Use **pnpm** in development. For local CLI with env vars, use **`dotenvx run --`** (see [CLAUDE.md](CLAUDE.md) / [env.template](env.template)).

## Quick start

```bash
# Models
dotenvx run -- pnpm run cli -- models --provider google

# One-shot prompt
dotenvx run -- pnpm run cli -- run --provider google --model gemini-3-flash-preview --prompt "Hello"

# Interactive chat
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-3-flash-preview

# Habitat (REPL, one-shot, telegram, discord, web)
dotenvx run -- pnpm run cli -- habitat
dotenvx run -- pnpm run cli -- habitat telegram --token "$TELEGRAM_BOT_TOKEN"
dotenvx run -- pnpm run cli -- habitat discord --token "$DISCORD_BOT_TOKEN"

# Evaluation
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Short poem about cats" \
  --models "google:gemini-3-flash-preview,ollama:gemma3:12b" \
  --id "cat-poem" \
  --concurrent
```

## Programmatic usage

The package exposes a small stable surface (`Habitat`, `Interaction`, `Stimulus`, evaluation helpers). After `pnpm build`, from another package that depends on `umwelten`:

```typescript
import { Stimulus } from "umwelten";
import { Interaction } from "umwelten";
import { Habitat } from "umwelten";
import { runEvaluation, parseModel } from "umwelten";

const stimulus = new Stimulus({ role: "helpful assistant" });
const interaction = new Interaction(
  { name: "gemini-3-flash-preview", provider: "google" },
  stimulus,
);
const reply = await interaction.chat("Hello");

const habitat = await Habitat.create({ workDir: "./my-agent" });
const { interaction: ix } = await habitat.createInteraction();
await ix.chat("List my agents");
```

For types and additional exports, use deep imports from published `dist/` paths if required.

## Session introspection

- **External** (Claude Code, Cursor history on disk): `umwelten sessions list --project …`, `sessions show`, `sessions search`, etc.
- **Native Habitat** transcripts (`transcript.jsonl` per session): `umwelten sessions habitat list`, `… habitat show`, `… habitat beats`, `… habitat pull`, `… habitat replay`, with optional `--work-dir`, `--sessions-dir`, `--env-prefix` (e.g. `JEEVES`).

## Documentation

Site: [umwelten.thefocus.ai](https://umwelten.thefocus.ai/)

- [Getting started](https://umwelten.thefocus.ai/guide/getting-started)
- [Habitat](https://umwelten.thefocus.ai/guide/habitat)
- [Habitat interfaces](https://umwelten.thefocus.ai/guide/habitat-interfaces) (REPL, TUI, Telegram, Discord, web)
- [Model evaluation](https://umwelten.thefocus.ai/guide/model-evaluation)
- [Examples](https://umwelten.thefocus.ai/examples/)

Machine-oriented summary for agents: [LLM.txt](LLM.txt).

## Repository layout

- `src/habitat/` — agent container, tools, sessions, bridge
- `src/interaction/` — conversations, persistence, session analysis
- `src/stimulus/` — prompts, tools, skills
- `src/cognition/` — model runners
- `src/evaluation/` — eval runners, reports, combine / suites
- `src/ui/` — Telegram, Discord, web, TUI adapters
- `src/cli/` — `umwelten` commands
- `examples/model-showdown/` — multi-dimension eval + combine
- `examples/habitat-minimal/` — minimal Habitat work-dir sketch
- `examples/jeeves-bot/` — optional JEEVES-preset (prompt + env); run Discord/Telegram via main CLI

## License

MIT — see [LICENSE](LICENSE).
