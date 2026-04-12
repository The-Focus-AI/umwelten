# Umwelten

Every AI model lives in its own perceptual bubble — its *Umwelt*. Umwelten lets you build agent environments that observe, measure, and understand themselves.

**Habitat** — a living container for AI agents: persona, tools, memory, sessions, sub-agents, multiple interfaces (CLI, Telegram, Discord, web). **Evaluation** — systematic model assessment that reveals how models actually see the world. TypeScript / Node 20+.

## See for yourself

```bash
git clone https://github.com/The-Focus-AI/umwelten.git
cd umwelten && pnpm install && cp env.template .env
# Add your GOOGLE_GENERATIVE_AI_API_KEY to .env
```

```bash
# Start an agent environment
dotenvx run -- pnpm run cli -- habitat

# 76% of models fail this common-sense question
dotenvx run -- pnpm tsx examples/evals/car-wash.ts

# Watch models fall for classic logic traps
dotenvx run -- pnpm tsx examples/evals/reasoning.ts

# Can a model write exactly 12 words?
dotenvx run -- pnpm tsx examples/evals/instruction.ts

# Same prompt, multiple providers, one command
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Explain why the sky is blue" \
  --models "google:gemini-3-flash-preview,openrouter:openai/gpt-5.4-nano" \
  --id "sky-test" --concurrent
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
const reply = await interaction.chat("Hello");

// Build an agent environment
const habitat = await Habitat.create({ workDir: "./my-agent" });
const { interaction: ix } = await habitat.createInteraction();
await ix.chat("List my agents");

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

## Documentation

**[umwelten.thefocus.ai](https://umwelten.thefocus.ai/)**

- [Getting started](https://umwelten.thefocus.ai/guide/getting-started) — build an agent in 10 minutes
- [Habitat](https://umwelten.thefocus.ai/guide/habitat) — tools, agents, sessions, interfaces
- [Creating evaluations](https://umwelten.thefocus.ai/guide/creating-evaluations) — EvalSuite, VerifyTask, JudgeTask
- [Model Showdown](https://umwelten.thefocus.ai/walkthroughs/model-showdown) — 49 models, 5 dimensions
- [API reference](https://umwelten.thefocus.ai/api/overview)

Machine-oriented summary for agents: [LLM.txt](LLM.txt).

## Repository layout

```
src/habitat/     — agent container, tools, sessions, bridge
src/evaluation/  — EvalSuite, PairwiseRanker, strategies, combine
src/interaction/ — conversations, persistence, session analysis
src/stimulus/    — prompts, tools, skills
src/cognition/   — model runners
src/providers/   — Google, OpenRouter, Ollama, LM Studio, GitHub, Fireworks, MiniMax
src/ui/          — Telegram, Discord, web, TUI adapters
src/cli/         — umwelten commands
examples/evals/  — EvalSuite examples (car-wash, reasoning, instruction)
examples/model-showdown/ — multi-dimension eval suite
examples/habitat-minimal/ — minimal Habitat work-dir
```

## License

MIT — see [LICENSE](LICENSE).
