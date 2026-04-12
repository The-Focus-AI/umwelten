# Getting Started

Build an AI agent, give it a persona, and measure whether it works — in under 10 minutes.

## 1. Install (30 seconds)

```bash
git clone https://github.com/The-Focus-AI/umwelten.git
cd umwelten
pnpm install
cp env.template .env
# Edit .env — add at least GOOGLE_GENERATIVE_AI_API_KEY
```

You need at least one API key. [Google AI Studio](https://aistudio.google.com/) is the cheapest way to start — generous free tier, fast models. If you want fully local and free, [install Ollama](https://ollama.com/) and skip the API key entirely.

## 2. Start a Habitat (60 seconds)

```bash
dotenvx run -- pnpm run cli -- habitat
```

That's it. You're now in a REPL, talking to an AI agent that can manage files, search the web, run sub-agents, and remember things across sessions.

First run creates a workspace at `~/.habitat/`:

```
~/.habitat/
├── config.json        ← agent configuration
├── STIMULUS.md        ← your agent's persona
├── tools/             ← custom tool definitions
└── skills/            ← shareable skill packs
```

Type something. It works. Now let's make it *yours*.

## 3. Give It a Persona

Open `~/.habitat/STIMULUS.md` in your editor:

```markdown
---
role: research assistant
objective: help with technical research and writing
---

You are a meticulous researcher. You verify claims, cite sources,
and present findings clearly. When uncertain, you say so.
```

The YAML frontmatter sets `role` and `objective`. The body becomes the system prompt. You can also add `instructions` as a list in the frontmatter for specific behavioral rules.

Restart the habitat — it loads the new persona automatically:

```bash
dotenvx run -- pnpm run cli -- habitat
```

## 4. Talk to Different Models

Your agent isn't locked to one model. Switch at the command line:

```bash
# Google Gemini — cloud, fast, cheap
dotenvx run -- pnpm run cli -- habitat -p google -m gemini-3-flash-preview

# Ollama — local, free, private
dotenvx run -- pnpm run cli -- habitat -p ollama -m gemma3:12b

# OpenRouter — access to GPT-5, Claude, and dozens more
dotenvx run -- pnpm run cli -- habitat -p openrouter -m openai/gpt-5.4-nano
```

See what's available:

```bash
dotenvx run -- pnpm run cli -- models --provider google
dotenvx run -- pnpm run cli -- models --search gpt-5
```

Same persona, same tools, different brain. This is why separating the agent (Habitat) from the model matters.

## 5. Your First Eval — Does Your Agent Actually Work?

You built an agent. But does it *reason* correctly? This is the key question umwelten helps you answer.

Create `my-first-eval.ts` in the repo root:

```typescript
import './src/env/load.js';
import { EvalSuite } from './src/evaluation/suite.js';

const suite = new EvalSuite({
  name: 'my-first-eval',
  stimulus: {
    role: 'helpful assistant',
    temperature: 0.3,
    maxTokens: 500,
  },
  models: [
    { name: 'gemini-3-flash-preview', provider: 'google' },
  ],
  tasks: [{
    id: 'math',
    prompt: 'What is 2+2?',
    maxScore: 1,
    verify: (r) => ({ score: r.trim() === '4' ? 1 : 0, details: r.trim() }),
  }],
});

suite.run();
```

Run it:

```bash
dotenvx run -- pnpm tsx my-first-eval.ts
```

You get a score, a leaderboard, and cached results so re-runs are instant. Add more models to the `models` array and they run in parallel.

For LLM-as-judge evaluations, multi-model comparison, and the full API, see [Creating Evaluations](/guide/creating-evaluations).

## 6. See Something Surprising

Run the car wash test — a common-sense reasoning trap:

```bash
dotenvx run -- pnpm tsx examples/evals/car-wash.ts
```

*"I want to wash my car. The car wash is 50 meters away. Should I walk or drive?"*

The correct answer is **drive** — you need the car at the car wash. A surprising number of models say "walk" because 50 meters is close. Run `--all` to test 8+ models and see which ones your agent's model is.

## 7. What's Next?

You have a working Habitat and you've run your first eval. Go deeper:

- **[Habitat Guide](/guide/habitat)** — tools, sub-agents, sessions, Telegram/Discord bots
- **[Creating Evaluations](/guide/creating-evaluations)** — LLM judges, multi-model comparison, the full eval API
- **[Model Showdown](/walkthroughs/model-showdown)** — 49 models, 5 dimensions, full analysis
- **[API Reference](/api/overview)** — TypeScript API for custom integrations
