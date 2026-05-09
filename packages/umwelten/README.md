# umwelten

Meta-package that re-exports all `@umwelten/*` packages for backwards compatibility.

## Install

```bash
pnpm add umwelten
```

## Usage

```typescript
// These all work:
import { Stimulus, Interaction, Habitat, EvalSuite } from 'umwelten';

// But prefer direct package imports for new code:
import { Stimulus, Interaction } from '@umwelten/core';
import { Habitat } from '@umwelten/habitat';
import { EvalSuite } from '@umwelten/evaluation';
```
