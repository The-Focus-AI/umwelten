---
title: Umwelten
description: Agent environments that observe, measure, and understand themselves
---

# Umwelten

Every AI model lives in its own perceptual bubble — its *Umwelt*. Most tools treat models as interchangeable black boxes. Umwelten lets you build agent environments that observe, measure, and understand themselves.

## See for yourself

**76% of models fail a simple common-sense question:**

```bash
pnpm tsx examples/evals/car-wash.ts
```

"Should I walk or drive to the car wash?" Most models say walk. They're wrong — you need the car there.

---

**Watch models fall for classic logic traps:**

```bash
pnpm tsx examples/evals/reasoning.ts
```

---

**Can a model write exactly 12 words?**

```bash
pnpm tsx examples/evals/instruction.ts
```

Harder than it sounds. Most overshoot or undershoot.

> These eval scripts require cloning the repo — see [Install](#install) below.

---

**An agent environment in one command:**

```bash
npx umwelten habitat
```

Tools, sessions, memory, sub-agents. One directory, any interface.

---

**Same prompt, 8 providers, one command:**

```bash
npx umwelten eval run \
  --prompt "Explain why the sky is blue in exactly three sentences" \
  --models "google:gemini-3-flash-preview,openrouter:openai/gpt-5.4-nano,openrouter:anthropic/claude-sonnet-4.6,openrouter:deepseek/deepseek-v3.2" \
  --id "sky-test" --concurrent
```

---

**Your laptop model vs GPT-5:**

```bash
npx umwelten eval run \
  --prompt "Write a haiku about recursion" \
  --models "ollama:qwen3:30b-a3b,openrouter:openai/gpt-5.4" \
  --id "local-vs-cloud" --concurrent
```

You might be surprised who wins.

## What is a Habitat?

A Habitat is the living environment for an agent. Not a wrapper around a prompt — a *place* where an agent exists.

An agent needs a persona, memory, tools, sessions, and the ability to delegate to sub-agents. A Habitat gives it all of these in a single directory:

```
~/my-agent/
  config.json          # agents, model, skills
  STIMULUS.md          # persona — who the agent is
  secrets.json         # API keys (file mode 0600)
  tools/               # custom tools
  skills/              # loaded skill sets
  agents/              # managed sub-agents
  memories.md          # extracted facts
```

Any interface plugs into the same Habitat — CLI, Telegram, Discord, web. Same tools, same memory, same agents.

→ [Habitat guide](./guide/habitat.md)

## What is an Eval?

Your agent needs to know if it's working. An eval tests any model against any question and scores the result. Twenty lines of TypeScript:

```typescript
import { EvalSuite } from '../../src/evaluation/suite.js';

const suite = new EvalSuite({
  name: 'my-eval',
  stimulus: { role: 'helpful assistant', temperature: 0.3, maxTokens: 200 },
  models: [
    { name: 'gemini-3-flash-preview', provider: 'google' },
    { name: 'openai/gpt-5.4-nano', provider: 'openrouter' },
  ],
  tasks: [{
    id: 'addition',
    name: 'Basic Math',
    prompt: 'What is 2 + 2? Answer with just the number.',
    maxScore: 1,
    verify: (r) => r.trim() === '4'
      ? { score: 1, details: 'Correct' }
      : { score: 0, details: `Got: ${r.trim()}` },
  }],
});

suite.run();
```

Run it. Get a leaderboard with scores, cost, and timing. Cache responses, resume interrupted runs, compare across providers.

→ [Creating evaluations](./guide/creating-evaluations.md)

## Understand your AI work

Your Habitat can read your Claude Code and Cursor history — every session, every tool call, every solution you've built. Index it with an LLM, search it semantically, extract learnings.

```bash
# See what you've been doing
npx umwelten sessions list

# Inspect a specific session
npx umwelten sessions show abc1234

# Index everything with AI (costs ~$0.03 per 100 sessions)
npx umwelten sessions index

# Search your work semantically
npx umwelten sessions search "authentication"

# Browse interactively
npx umwelten sessions browse
```

Supports Claude Code (JSONL) and Cursor (SQLite). Your Habitat can append learnings to sessions for continuous improvement.

→ [Session management guide](./guide/session-management.md) · [Session analysis walkthrough](./walkthroughs/session-analysis-walkthrough.md)

## Install

**From source:**

```bash
git clone https://github.com/The-Focus-AI/umwelten.git
cd umwelten
pnpm install
pnpm build
cp env.template .env   # add your API keys
```

**From npm:**

```bash
npm install -g umwelten
```

## Go deeper

| Topic | Link |
|-------|------|
| Habitat guide | [Setting up agent environments](./guide/habitat.md) |
| Creating evaluations | [EvalSuite, VerifyTask, JudgeTask](./guide/creating-evaluations.md) |
| Model Showdown | [Full walkthrough of a multi-eval suite](./walkthroughs/model-showdown.md) |
| API reference | [TypeScript API](./api/overview.md) |
| LLM.txt | [Machine-readable project summary](https://github.com/The-Focus-AI/umwelten/blob/main/LLM.txt) |
