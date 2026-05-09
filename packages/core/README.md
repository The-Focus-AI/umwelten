# @umwelten/core

Foundation package for umwelten — model runners, stimulus configuration, interactions, providers, context management, memory, costs, and session analysis.

## Install

```bash
pnpm add @umwelten/core
```

## Quick start

```typescript
import { Stimulus, Interaction } from '@umwelten/core';

const stimulus = new Stimulus({ role: 'helpful assistant' });
const interaction = new Interaction(
  { name: 'gemini-3-flash-preview', provider: 'google' },
  stimulus,
);
const reply = await interaction.chat('Hello');
```

## What's inside

- **cognition/** — `BaseModelRunner`, `SmartModelRunner`, model registry
- **stimulus/** — `Stimulus` config, tools (URL, PDF, audio, image), skills system
- **interaction/** — `Interaction` class, session persistence, adapters (Claude Code, Cursor), session analysis/digestion
- **providers/** — Google, OpenRouter, Ollama, LM Studio, LlamaBarn, llama-swap, GitHub, DeepInfra, Together AI
- **context/** — Token estimation, compaction strategies
- **memory/** — Fact extraction, `MemoryRunner`
- **costs/** — Cost calculation and tracking
- **schema/** — DSL-to-Zod schema parsing, validation
- **markdown/** — URL fetching, HTML-to-markdown, feed parsing

## Deep imports

Beyond the barrel export, individual modules are available via deep imports:

```typescript
import { ClaudeCodeAdapter } from '@umwelten/core/interaction/adapters/claude-code-adapter.js';
import { digestSession } from '@umwelten/core/interaction/analysis/session-digester.js';
import { getModel } from '@umwelten/core/providers/index.js';
```
