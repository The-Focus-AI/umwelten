---
title: "Vercel AI SDK 6 Upgrade: Umwelten Migration Guide"
date: 2026-02-19
topic: ai-sdk-6-upgrade
recommendation: Upgrade to AI SDK 6.x
version_researched: "ai@6.0.93, @ai-sdk/google@3.0.30, @ai-sdk/openai-compatible@2.0.30"
use_when:
  - You need combined tool-calling + structured output in a single call
  - You want the ToolLoopAgent abstraction for agent workflows
  - You want to silence V2 compatibility warnings from providers
  - You need human-in-the-loop tool approval
  - You want DevTools debugging for agent flows
avoid_when:
  - You are mid-sprint on an unrelated feature and can't tolerate churn
  - You need immediate stability and can't run a full test pass
project_context:
  language: TypeScript
  relevant_dependencies:
    - "ai@^5.0.115"
    - "@ai-sdk/google@^2.0.51"
    - "@ai-sdk/openai-compatible@^1.0.29"
    - "@openrouter/ai-sdk-provider@^1.5.4"
    - "zod@^4.3.6"
---

## Summary

AI SDK 6.0 was released December 22, 2025 and introduces the v3 Language Model Specification[1]. Despite the major version bump, Vercel characterizes this as a manageable migration — the change reflects specification improvements, not a redesign[2]. The `ai` package is now at 6.0.93 with 20M+ monthly npm downloads[2].

The umwelten codebase has **moderate migration effort**: ~15 files need changes, with the heaviest work in `src/cognition/runner.ts` (the core runner that wraps all AI SDK calls). The biggest change is replacing `generateObject`/`streamObject` with the new `Output` API. An automated codemod handles 8 mechanical transformations (type renames, mock renames), but the structured output migration is manual[1][3].

Key benefit for umwelten: the new `Output` API allows combining tools AND structured output in a single call — previously this required chaining `generateText` then `generateObject` separately[2].

## Philosophy & Mental Model

SDK 6's core idea is **unification**. Instead of separate functions for different output types (`generateText` for text, `generateObject` for structured data), everything goes through `generateText`/`streamText` with an `output` parameter that specifies the desired shape. Think of it as: the *model call* is always the same, only the *output specification* varies[2].

The `LanguageModel` type is now a union: `string | LanguageModelV2 | LanguageModelV3`[5]. V2 providers still work through a Proxy shim (with deprecation warnings), so the upgrade can be done incrementally — update the core `ai` package first, then upgrade providers one by one[6].

## Setup

### Step 1: Update dependencies

```bash
pnpm add ai@latest @ai-sdk/google@latest @ai-sdk/openai-compatible@latest @openrouter/ai-sdk-provider@latest
```

Target versions:

| Package | From | To |
|---------|------|-----|
| `ai` | ^5.0.115 | ^6.0.0 |
| `@ai-sdk/google` | ^2.0.51 | ^3.0.0 |
| `@ai-sdk/openai-compatible` | ^1.0.29 | ^2.0.30 (latest) |
| `@openrouter/ai-sdk-provider` | ^1.5.4 | ^2.0.0 |
| `zod` | ^4.3.6 | (no change needed) |

### Step 2: Run the automated codemod

```bash
# Preview first
npx @ai-sdk/codemod --dry v6

# Apply
npx @ai-sdk/codemod v6
```

This handles 8 transformations automatically[3]:
- `CoreMessage` → `ModelMessage`
- `convertToCoreMessages` → `convertToModelMessages` (+ adds `await`)
- `MockLanguageModelV2` → `MockLanguageModelV3` (etc.)
- `ToolCallOptions` → `ToolExecutionOptions`
- `textEmbeddingModel` → `embeddingModel`
- `toModelOutput: output =>` → `toModelOutput: ({ output }) =>`
- Google Vertex `google` key → `vertex`

### Step 3: Manual migration (see Core Usage Patterns below)

### Step 4: Build and test

```bash
pnpm build
pnpm test:run
```

## Core Usage Patterns

### Pattern 1: CoreMessage → ModelMessage (15+ files, 100+ usages)

The most widespread change. `CoreMessage` is removed in SDK 6[1].

**Files affected**: `src/cognition/runner.ts`, `src/interaction/core/interaction.ts`, `src/habitat/transcript.ts`, `src/context/estimate-size.ts`, `src/context/segment.ts`, `src/context/types.ts`, `src/context/serialize-messages.ts`, `src/context/strategies/truncate.ts`, `src/context/strategies/through-line-and-facts.ts`, `src/cli/habitat.ts`, `src/ui/WebInterface.ts`, `src/cognition/runner.test.ts`

```typescript
// BEFORE
import type { CoreMessage } from 'ai';
public messages: CoreMessage[] = [];

// AFTER
import type { ModelMessage } from 'ai';
public messages: ModelMessage[] = [];
```

The codemod handles this automatically. Verify with: `grep -r "CoreMessage" src/`

### Pattern 2: generateObject → generateText + Output.object() (5 files)

The highest-effort manual change. `generateObject` is deprecated[1].

**Files affected**: `src/cognition/runner.ts:797-849`, `src/evaluation/api.ts:174-204`, `src/memory/determine_operations.ts:227`, `src/memory/extract_facts.ts:117`

```typescript
// BEFORE (runner.ts)
import { generateObject } from 'ai';

const response = await generateObject({
  model,
  messages,
  schema,
  maxTokens: this.config.maxTokens,
  temperature: options.temperature,
});
const result = response.object;

// AFTER
import { generateText, Output } from 'ai';

const response = await generateText({
  model,
  messages,
  output: Output.object({ schema }),
  maxTokens: this.config.maxTokens,
  temperature: options.temperature,
});
const result = response.output;
```

Key differences:
- Import `Output` from `'ai'`
- `schema` moves inside `Output.object({ schema })`
- Result: `.object` → `.output`

### Pattern 3: streamObject → streamText + Output.object() (3 files)

**Files affected**: `src/cognition/runner.ts:864-921`, `src/cli/run.ts:120`

```typescript
// BEFORE
import { streamObject } from 'ai';

const result = streamObject({
  model,
  messages,
  schema,
  maxTokens: this.config.maxTokens,
});
for await (const partial of result.partialObjectStream) {
  // handle partial
}

// AFTER
import { streamText, Output } from 'ai';

const result = streamText({
  model,
  messages,
  output: Output.object({ schema }),
  maxTokens: this.config.maxTokens,
});
for await (const partial of result.partialOutputStream) {
  // handle partial
}
```

Key differences:
- `partialObjectStream` → `partialOutputStream`
- Same `Output.object({ schema })` pattern

### Pattern 4: Runner interface update (types.ts + smart_runner.ts)

The `ModelRunner` interface and `SmartModelRunner` wrapper define `generateObject` and `streamObject` methods that need updating.

**Files affected**: `src/cognition/types.ts:164-165`, `src/cognition/smart_runner.ts:101-133`

```typescript
// BEFORE (types.ts)
generateObject(interaction: any, schema: z.ZodSchema): Promise<ModelResponse>;
streamObject(interaction: any, schema: z.ZodSchema): Promise<ModelResponse>;

// AFTER — keep the method names for internal API stability,
// but update implementation to use Output.object() internally
generateObject(interaction: any, schema: z.ZodSchema): Promise<ModelResponse>;
streamObject(interaction: any, schema: z.ZodSchema): Promise<ModelResponse>;
```

**Strategy**: Keep the internal `generateObject`/`streamObject` method names on the runner interface (they're internal API, not the SDK function names). Only change the implementation inside `BaseModelRunner` to call `generateText` + `Output.object()` instead of the deprecated `generateObject`.

### Pattern 5: experimental_providerMetadata cleanup (runner.ts)

The runner already normalizes `experimental_providerMetadata` → `providerOptions`. In SDK 6, the `experimental_providerMetadata` field no longer appears — it's always `providerOptions`[1].

**Files affected**: `src/cognition/runner.ts` (lines 279, 309, 375, 540-547, 562-563)

```typescript
// BEFORE — defensive normalization
const meta = part.providerOptions ?? part.experimental_providerMetadata;

// AFTER — SDK 6 always uses providerOptions
const meta = part.providerOptions;
```

After upgrading, the `?? part.experimental_providerMetadata` fallbacks can be removed. Keep them during the transition if you want backward compatibility with older cached sessions.

## Anti-Patterns & Pitfalls

### Don't: Upgrade all dependencies at once without testing

```bash
# BAD — big bang upgrade
pnpm add ai@latest @ai-sdk/google@latest @ai-sdk/openai-compatible@latest @openrouter/ai-sdk-provider@latest
# then try to fix everything at once
```

**Why it's wrong:** If the build breaks, you won't know which package caused it. The `@ai-sdk/openai-compatible` version is especially tricky — it may pull in `@ai-sdk/provider@3.x` which can cause type conflicts.

### Instead: Incremental upgrade

```bash
# GOOD — upgrade core first
pnpm add ai@latest
pnpm build  # check for type errors

# Then providers one at a time
pnpm add @ai-sdk/google@latest
pnpm build

pnpm add @openrouter/ai-sdk-provider@latest
pnpm build
```

### Don't: Replace internal method names on the runner

```typescript
// BAD — renaming the internal API
interface ModelRunner {
  generateStructuredOutput(interaction: any, schema: z.ZodSchema): Promise<ModelResponse>;
}
```

**Why it's wrong:** The `generateObject` name is used throughout the codebase in `Interaction`, `SmartModelRunner`, `HabitatAgent`, CLI commands, evaluation API, and memory extraction. Renaming the internal method would touch 20+ files for no benefit.

### Instead: Keep internal names, change implementation

```typescript
// GOOD — same internal API, new SDK call
async generateObject(interaction: Interaction, schema: z.ZodSchema): Promise<ModelResponse> {
  // Internally uses generateText + Output.object()
  const response = await generateText({
    model,
    messages,
    output: Output.object({ schema }),
    ...options,
  });
  return this.buildModelResponse(response);
}
```

### Don't: Ignore the `convertToModelMessages` async change

```typescript
// BAD — will silently return a Promise instead of messages
const messages = convertToModelMessages(uiMessages);
// messages is now Promise<ModelMessage[]>, not ModelMessage[]!
```

**Why it's wrong:** No compile error if using `any` types, but runtime behavior breaks silently.

### Instead: Always await

```typescript
// GOOD
const messages = await convertToModelMessages(uiMessages);
```

The codemod handles this, but verify with: `grep -r "convertToModelMessages" src/ | grep -v await`

### Don't: Forget about the `@ai-sdk/fireworks` provider we just added

The fireworks provider uses `@ai-sdk/openai-compatible`. After the SDK 6 upgrade, verify that the `createOpenAICompatible()` function still returns a type compatible with the `LanguageModel` union. The V2 compatibility shim should handle this, but test it.

### Don't: Assume `experimental_toolCallStreaming` still exists

```typescript
// POTENTIALLY BROKEN in SDK 6
streamOptions.experimental_toolCallStreaming = true;
```

**Why:** Experimental flags often get promoted or removed in major versions. Check the SDK 6 docs for whether this is now a stable option or has been removed/renamed.

## Why This Choice

### Decision Criteria

| Criterion | Weight | Assessment |
|-----------|--------|-----------|
| Combined tools + structured output | High | SDK 6 enables this natively — currently requires two separate calls |
| Silence V2 deprecation warnings | High | V2 providers log warnings on every call in SDK 6 |
| Codebase health / avoid tech debt | High | Staying on SDK 5 means diverging further from ecosystem |
| Migration effort | Medium | ~15 files, ~2-4 hours of focused work |
| Risk of breakage | Medium | V2 compat shim provides safety net during transition |
| New features (ToolLoopAgent, DevTools) | Low | Nice-to-have, not blocking current work |

### Key Factors

- **generateObject deprecation**: This will be removed in a future version. Migrating now on our schedule is better than being forced later.
- **Provider ecosystem**: Community providers are moving to V3. Staying on V2 means compatibility issues will compound.
- **The codemod exists**: Automated transformations significantly reduce the mechanical work.

## Alternatives Considered

### Alternative 1: Stay on SDK 5.x

- **What it is:** Don't upgrade, keep current versions
- **Why not chosen:** `generateObject`/`streamObject` will eventually be removed; V2 provider compatibility will degrade; new provider releases target SDK 6
- **Choose this instead when:**
  - You're in a critical release freeze
  - A blocking bug in SDK 6 affects your use case
- **Key tradeoff:** Zero effort now, increasing tech debt over time

### Alternative 2: Partial upgrade (ai@6 + keep V2 providers)

- **What it is:** Upgrade `ai` to 6.x but keep `@ai-sdk/google@2.x` etc.
- **Why not chosen:** Works via V2 compat shim, but generates deprecation warnings on every model call and misses V3 features
- **Choose this instead when:**
  - A provider doesn't have a V3 release yet
  - You want to test the core upgrade before touching providers
- **Key tradeoff:** Faster initial upgrade, noisy warnings, incomplete migration

### Alternative 3: Wait for SDK 7

- **What it is:** Skip SDK 6 entirely, wait for the next major version
- **Why not chosen:** No SDK 7 is planned or announced; SDK 6 is the current stable target; the longer you wait, the harder the migration
- **Choose this instead when:**
  - SDK 7 is announced with a clear timeline
- **Key tradeoff:** Maximum delay for minimum effort (if the 6→7 migration is smaller)

## Caveats & Limitations

- **`@ai-sdk/openai-compatible` version ambiguity**: The migration guide says all `@ai-sdk/*` packages need `^3.0.0`, but the openai-compatible package is at `2.0.30` on npm. It may work fine with SDK 6 via the V2 compat shim, or a 3.x release may appear. Test this during upgrade[15].

- **`@openrouter/ai-sdk-provider` alpha status**: The stable version is 2.2.3, but there are `6.0.0-alpha.1` prereleases. Use the 2.x stable release — it adds V3 support[9].

- **Token property names in costs.ts**: The umwelten cost tracking uses `promptTokens`/`completionTokens` internally (in `TokenUsage` schema). These are the codebase's own types, not the SDK's — but they map to the SDK's `usage.inputTokens`/`usage.outputTokens`. The mapping code in `runner.ts` needs to use the SDK 6 property names.

- **`maxTokens` parameter**: SDK 5 already renamed this to `maxOutputTokens`, but the umwelten codebase uses `maxTokens` as its own config property name passed through to the SDK. Verify the SDK 6 still accepts `maxTokens` as an alias, or update to `maxOutputTokens`.

- **`experimental_toolCallStreaming`**: Used in `runner.ts:454`. Check if this flag is promoted to a stable option in SDK 6 or if it needs to be removed/renamed.

- **No test mocks to update**: The codebase doesn't use `ai/test` mock utilities — tests use real providers. So the V2→V3 mock rename is a non-issue.

- **Pre-existing test failures**: Ollama tests (no local Ollama), result-analyzer cost tests, Dagger GraphQL tests, and agent-runner-tools tests already fail. These are unrelated to the SDK upgrade but will appear in the test run.

## Umwelten-Specific Migration Map

### Critical files (core runner logic)

| File | Changes Needed |
|------|---------------|
| `src/cognition/runner.ts` | Replace `generateObject()` call with `generateText()` + `Output.object()`; replace `streamObject()` call with `streamText()` + `Output.object()`; update `partialObjectStream` → `partialOutputStream`; remove `experimental_providerMetadata` fallbacks; check `experimental_toolCallStreaming`; update `CoreMessage` → `ModelMessage` |
| `src/cognition/types.ts` | `CoreMessage` → `ModelMessage` in imports and type annotations |
| `src/cognition/smart_runner.ts` | No changes needed (delegates to base runner) |
| `src/interaction/core/interaction.ts` | `CoreMessage` → `ModelMessage` everywhere (messages array, method params, return types) |

### High-impact files (structured output)

| File | Changes Needed |
|------|---------------|
| `src/evaluation/api.ts` | Replace `generateObject` call with `generateText` + `Output.object()`; `.object` → `.output` |
| `src/memory/determine_operations.ts` | Same pattern |
| `src/memory/extract_facts.ts` | Same pattern |

### Medium-impact files (type changes only)

| File | Changes Needed |
|------|---------------|
| `src/habitat/transcript.ts` | `CoreMessage` → `ModelMessage` |
| `src/context/estimate-size.ts` | `CoreMessage` → `ModelMessage` |
| `src/context/segment.ts` | `CoreMessage` → `ModelMessage` |
| `src/context/types.ts` | `CoreMessage` → `ModelMessage` |
| `src/context/serialize-messages.ts` | `CoreMessage` → `ModelMessage` |
| `src/context/strategies/truncate.ts` | `CoreMessage` → `ModelMessage` |
| `src/context/strategies/through-line-and-facts.ts` | `CoreMessage` → `ModelMessage` |
| `src/cli/habitat.ts` | `CoreMessage` → `ModelMessage` |
| `src/ui/WebInterface.ts` | `CoreMessage` → `ModelMessage` |

### Provider files (type already compatible)

| File | Changes Needed |
|------|---------------|
| `src/providers/base.ts` | `LanguageModel` import still works (it's a union now) |
| `src/providers/google.ts` | No changes — `google()` from `@ai-sdk/google@3.x` returns V3 natively |
| `src/providers/fireworks.ts` | No changes — `createOpenAICompatible()` returns V2, shimmed automatically |
| `src/providers/openrouter.ts` | No changes — V2 shimmed automatically |
| `src/providers/index.ts` | No changes |

### Test files

| File | Changes Needed |
|------|---------------|
| `src/cognition/runner.test.ts` | `CoreMessage` → `ModelMessage`; update `experimental_providerMetadata` test data if removing fallbacks |
| `src/cognition/generate_object.test.ts` | Update assertions: `.object` → `.output` if testing SDK directly |
| `src/cognition/stream_object.test.ts` | Update `partialObjectStream` → `partialOutputStream` assertions |
| `src/interaction/core/interaction.test.ts` | `CoreMessage` → `ModelMessage`; `modelMessageSchema` import may change |

## References

[1] [Migration Guide: AI SDK 5.x to 6.0](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0) - Official breaking changes and migration steps
[2] [AI SDK 6 Blog Post](https://vercel.com/blog/ai-sdk-6) - Release announcement with feature overview
[3] [@ai-sdk/codemod npm Package](https://www.npmjs.com/package/@ai-sdk/codemod) - Automated migration tool
[4] [GitHub Issue #8662: v6 Planning](https://github.com/vercel/ai/issues/8662) - SDK 6 planning discussion
[5] [GitHub Issue #9018: LanguageModel Union Type](https://github.com/vercel/ai/issues/9018) - V2/V3 union type design
[6] [GitHub Issue #10689: V2 Model Warnings](https://github.com/vercel/ai/issues/10689) - Backward compatibility details
[7] [generateText API Reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text) - SDK 6 generateText with Output param
[8] [ToolLoopAgent API Reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent) - New agent abstraction
[9] [@openrouter/ai-sdk-provider Changelog](https://github.com/OpenRouterTeam/ai-sdk-provider/blob/main/CHANGELOG.md) - V3 support in v2.0.0
[10] [Troubleshooting: Unsupported Model Version](https://ai-sdk.dev/docs/troubleshooting/unsupported-model-version) - V2 compat shim details
[11] [OpenAI Compatible Providers](https://ai-sdk.dev/providers/openai-compatible-providers) - Provider compatibility docs
[12] [zodSchema Reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/zod-schema) - Zod 4 compatibility notes
[13] [Cloudflare AI SDK v6 Announcement](https://developers.cloudflare.com/changelog/2025-12-22-agents-sdk-ai-sdk-v6/) - Third-party SDK 6 adoption
[14] [@ai-sdk/google npm Package](https://www.npmjs.com/package/@ai-sdk/google) - Latest version info
[15] [@ai-sdk/openai-compatible npm Package](https://www.npmjs.com/package/@ai-sdk/openai-compatible) - Version ambiguity for SDK 6
