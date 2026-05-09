# @umwelten/evaluation

Model evaluation, ranking, reporting, and session introspection for umwelten.

## Install

```bash
pnpm add @umwelten/evaluation
```

## Quick start

```typescript
import { EvalSuite } from '@umwelten/evaluation';

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

## What's inside

- **evaluation/** — `EvalSuite`, strategies, `PairwiseRanker`, Elo rankings, combine/aggregate
- **reporting/** — `Reporter` with console, markdown, HTML, JSON renderers
- **introspection/** — Session browser data layer (`buildBrowse`, `applyFilter`, digest management)
