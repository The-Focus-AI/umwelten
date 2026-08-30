# Umwelten

Every AI model lives in its own perceptual bubble — its *Umwelt*. Umwelten lets you build agent environments that observe, measure, and understand themselves.

**Habitat** — a living container for AI agents: persona, tools, memory, sessions, sub-agents, multiple interfaces (CLI, Telegram, Discord, web). **Evaluation** — systematic model assessment that reveals how models actually see the world. TypeScript / Node 20+.

## See for yourself

```bash
git clone https://github.com/The-Focus-AI/umwelten.git
cd umwelten && pnpm install && cp env.template .env
# Add your GOOGLE_GENERATIVE_AI_API_KEY to .env
# `umwelten search` requires ripgrep (rg) on PATH: brew install ripgrep
```

```bash
# Start an agent environment
npx umwelten habitat

# Run one prompt through a provider/model
npx umwelten run "Explain why the sky is blue" \
  --provider google --model gemini-3-flash-preview

# 76% of models fail this common-sense question
dotenvx run -- pnpm tsx examples/evals/car-wash.ts

# Watch models fall for classic logic traps
dotenvx run -- pnpm tsx examples/evals/reasoning.ts

# Can a model write exactly 12 words?
dotenvx run -- pnpm tsx examples/evals/instruction.ts
```

## Programmatic usage

```typescript
import { Stimulus, Interaction, Habitat, EvalSuite } from "umwelten";

// Talk to any model
const stimulus = new Stimulus({ role: "helpful assistant" });
const interaction = new Interaction(
  { name: "gemini-3-flash-preview", provider: "google" },
  stimulus,
);
interaction.addMessage({ role: "user", content: "Hello" });
const reply = await interaction.generateText();

// Build an agent environment
const habitat = await Habitat.create({ workDir: "./my-agent" });
const { interaction: ix } = await habitat.createInteraction();
ix.addMessage({ role: "user", content: "List my agents" });
await ix.generateText();

// Evaluate models
const suite = new EvalSuite({
  name: 'quick-test',
  stimulus: { role: 'helpful assistant', temperature: 0.3 },
  models: [{ name: 'gemini-3-flash-preview', provider: 'google' }],
  tasks: [{
    id: 'math', prompt: 'What is 2+2?', maxScore: 1,
    verify: (r) => ({ score: r.trim() === '4' ? 1 : 0, details: r.trim() }),
  }],
});
await suite.run();
```

## Web applications

Habitats also drive HTTP chat. `@umwelten/habitat` exposes `startWebServer` — the web peer to the Discord and Telegram adapters. It speaks the [Vercel AI SDK UI Message Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol), so any React frontend using `@ai-sdk/react`'s `useChat` connects with no glue code. Streaming text, tool calls, and tool results all flow through the same `ChannelBridge` that every other channel uses.

```ts
import { Habitat } from 'umwelten';
import { startWebServer } from '@umwelten/habitat';

const habitat = await Habitat.create({ workDir: './my-habitat' });
await startWebServer({
  habitat,
  auth: 'dev',            // or a custom AuthProvider
  staticRoot: './public', // built SPA
  port: 3000,
});
```

Generative UI comes via a `renderUi` tool that ships a [json-render](https://json-render.dev) Spec through the tool-call channel — the client renders it with `@json-render/react`. See [`examples/umwelten-web-demo/`](examples/umwelten-web-demo/) for the reference app (`useChat` + thread sidebar + tool-call cards + renderUi).

```bash
mise run web-demo         # API server on :3000
mise run web-demo-client  # Vite dev server on :5173 (proxies /api)
```

[Gaia](examples/gaia-ui/) — the built-in habitat manager UI — is a thin wrapper over the same framework (`mise run habitat-web`).

## Remote MCP servers

Connect to any remote MCP server with OAuth — chat from the command line or build your own MCP-backed agent.

```bash
# Chat with a remote MCP server (OAuth handled automatically)
npx umwelten mcp chat --url https://oura-mcp.fly.dev/mcp

# One-shot query
npx umwelten mcp chat --url https://oura-mcp.fly.dev/mcp --one-shot "how did I sleep?"
```

Build your own multi-user MCP server with Habitat: see [`examples/oura-mcp/`](examples/oura-mcp/) — a complete Oura Ring MCP server with OAuth, Neon Postgres, deployable on fly.io.

## Session digestion

Your Habitat reads Claude Code and Cursor history — every session, every tool call, every solution. Digest with AI, search full text, extract learnings.

```bash
npx umwelten sessions list                           # see your sessions
npx umwelten sessions index                          # AI-index everything
npx umwelten sessions search "authentication"        # full-content search
npx umwelten sessions browse                         # interactive browser
```

## Documentation

**[umwelten.thefocus.ai](https://umwelten.thefocus.ai/)**

- [Getting started](https://umwelten.thefocus.ai/guide/getting-started) — build an agent in 10 minutes
- [Habitat](https://umwelten.thefocus.ai/guide/habitat) — tools, agents, sessions, interfaces
- [Creating evaluations](https://umwelten.thefocus.ai/guide/creating-evaluations) — EvalSuite, VerifyTask, JudgeTask
- [Source sessions](https://umwelten.thefocus.ai/guide/source-sessions) — Claude Code, Cursor, pi, Antigravity & remote habitat history
- [Model Showdown](https://umwelten.thefocus.ai/walkthroughs/model-showdown) — 49 models, 5 dimensions
- [API reference](https://umwelten.thefocus.ai/api/overview)

Machine-oriented summary for agents: [LLM.txt](LLM.txt).

## Repository layout

Monorepo managed with [pnpm workspaces](https://pnpm.io/workspaces). Each package is independently publishable under the `@umwelten/` scope.

```
packages/
  core/          @umwelten/core       — model runners, stimulus, interaction, providers, context, memory
  protocols/     @umwelten/protocols  — MCP, A2A, OAuth, protocol task storage
  substrate/     @umwelten/substrate  — reversible Components, Services, Shell composition
  habitat/       @umwelten/habitat    — agent container, tools, Gaia, web/A2A/MCP server
  sessions/      @umwelten/sessions   — session search, browse, digest commands
  evaluation/    @umwelten/evaluation — EvalSuite, ranking, aggregation, reporting
  ui/            @umwelten/ui         — Telegram, Discord, TUI adapters
  mycel/         @umwelten/mycel      — the Exchange: dispatch, metering, balances
  supplier/      @umwelten/supplier   — supplier discovery, probing, publishing, serving
  cli/           @umwelten/cli        — umwelten CLI commands
  umwelten/      umwelten             — published compatibility/meta-package
examples/
  evals/           — EvalSuite examples (car-wash, reasoning, instruction)
  model-showdown/  — multi-dimension eval suite
  oura-mcp/        — multi-user Oura Ring MCP server (Habitat + fly.io)
  umwelten-web-demo/ — React + useChat reference app
  habitat-minimal/ — minimal Habitat work-dir
```

See the [current architecture map](docs/architecture/system-map-2026-08.md)
for runtime flows, the Gaia/SaaS boundary, old/new paths, and cleanup priorities.

## License

MIT — see [LICENSE](LICENSE).
