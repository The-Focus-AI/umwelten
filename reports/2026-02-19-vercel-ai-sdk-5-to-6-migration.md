# Vercel AI SDK 5.x to 6.0 Migration Guide

## Abstract

This report provides a comprehensive, practical migration guide for upgrading from Vercel AI SDK 5.x to 6.0. AI SDK 6, released December 22, 2025, introduces the v3 Language Model Specification, a new Agent abstraction (`ToolLoopAgent`), unified structured output via the `Output` API, human-in-the-loop tool approval, and expanded provider-specific tool support. Despite the major version bump, the Vercel team characterizes this as a manageable migration -- the version change reflects specification improvements rather than a complete SDK redesign. This guide covers every breaking change, deprecated API, renamed type, and code transformation required, along with specific guidance for provider package upgrades (`@ai-sdk/google`, `@ai-sdk/openai-compatible`, `@openrouter/ai-sdk-provider`). An automated codemod tool (`npx @ai-sdk/codemod v6`) handles many mechanical transformations, but several changes require manual intervention. The report is organized by category: core API changes, structured output migration, agent patterns, testing mocks, provider-specific changes, and dependency version requirements.

---

## 1. Introduction

### 1.1 Scope

This guide targets a TypeScript codebase currently using:
- `ai` ^5.x
- `@ai-sdk/google` ^2.x
- `@ai-sdk/openai-compatible` ^1.x
- `@openrouter/ai-sdk-provider` ^1.x
- `zod` ^4.x

The focus is on practical code transformations: what breaks, what is deprecated, and what the replacement patterns look like.

### 1.2 Methodology

Information was gathered from:
- The [official AI SDK 6 migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0) [1]
- The [AI SDK 6 blog post](https://vercel.com/blog/ai-sdk-6) [2]
- The [@ai-sdk/codemod npm package](https://www.npmjs.com/package/@ai-sdk/codemod) [3]
- GitHub issues [#8662](https://github.com/vercel/ai/issues/8662) (v6 planning) [4], [#9018](https://github.com/vercel/ai/issues/9018) (LanguageModel type) [5], and [#10689](https://github.com/vercel/ai/issues/10689) (v2 model warnings) [6]
- The [AI SDK generateText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text) [7]
- The [ToolLoopAgent reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent) [8]
- The [@openrouter/ai-sdk-provider changelog](https://github.com/OpenRouterTeam/ai-sdk-provider/blob/main/CHANGELOG.md) [9]
- The [unsupported model version troubleshooting](https://ai-sdk.dev/docs/troubleshooting/unsupported-model-version) [10]
- The [OpenAI Compatible Providers docs](https://ai-sdk.dev/providers/openai-compatible-providers) [11]
- The [zodSchema reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/zod-schema) [12]
- The [Cloudflare AI SDK v6 announcement](https://developers.cloudflare.com/changelog/2025-12-22-agents-sdk-ai-sdk-v6/) [13]

### 1.3 Release Context

AI SDK 6 was published December 22, 2025. As of February 2026, the latest patch version is `ai@6.0.93`. The SDK has 20+ million monthly npm downloads [2]. The v3 Language Model Specification is the core architectural change powering new features like agents and tool approval.

---

## 2. Dependency Version Requirements

### 2.1 Core Packages

Update `package.json` to these minimum versions [1]:

| Package | SDK 5 Version | SDK 6 Version |
|---------|--------------|--------------|
| `ai` | ^5.x | **^6.0.0** |
| `@ai-sdk/provider` | ^2.x | **^3.0.0** |
| `@ai-sdk/provider-utils` | ^3.x | **^4.0.0** |
| `@ai-sdk/react` | ^2.x | **^3.0.0** |
| All `@ai-sdk/*` providers | ^2.x | **^3.0.0** |

### 2.2 Provider Packages Relevant to This Codebase

| Package | Current | Required for SDK 6 | Notes |
|---------|---------|-------------------|-------|
| `@ai-sdk/google` | ^2.0.51 | **^3.0.0** | Latest is 3.0.29 |
| `@ai-sdk/openai-compatible` | ^1.0.29 | **^3.0.0** | Major jump from 1.x to 3.x; latest is ~2.0.30 -- may need `^2.0.0` or check for 3.x release |
| `@openrouter/ai-sdk-provider` | ^1.5.4 | **^2.0.0** | v2.0.0 adds LanguageModelV3 support [9] |
| `zod` | ^4.3.6 | **^3.25.0 \|\| ^4.0.0** | Current version is compatible |

### 2.3 Install Command

```bash
pnpm add ai@latest @ai-sdk/google@latest @ai-sdk/openai-compatible@latest @openrouter/ai-sdk-provider@latest
```

**Important**: The `@ai-sdk/openai-compatible` package's npm latest version is 2.0.30 as of mid-February 2026. Verify that this is sufficient -- the migration guide states `@ai-sdk/*` packages should be `^3.0.0`, but the openai-compatible package may follow a different versioning track since it depends on `@ai-sdk/provider` and `@ai-sdk/provider-utils` as peer dependencies. Check that its peer dependencies resolve correctly.

---

## 3. Automated Migration: The Codemod Tool

### 3.1 Running the Codemod

```bash
# Run all v6 codemods
npx @ai-sdk/codemod v6

# Preview changes without applying
npx @ai-sdk/codemod --dry v6

# Run a specific codemod
npx @ai-sdk/codemod <codemod-name> <path>
```

### 3.2 Available Codemods

The following transformations are automated [1][3]:

| Codemod Name | What It Does |
|-------------|-------------|
| `rename-text-embedding-to-embedding` | `textEmbeddingModel()` / `textEmbedding()` to `embeddingModel()` / `embedding()` |
| `rename-mock-v2-to-v3` | `MockLanguageModelV2` to `MockLanguageModelV3`, etc. |
| `rename-tool-call-options-to-tool-execution-options` | `ToolCallOptions` type to `ToolExecutionOptions` |
| `rename-core-message-to-model-message` | `CoreMessage` type to `ModelMessage` |
| `rename-converttocoremessages-to-converttomodelmessages` | `convertToCoreMessages()` to `convertToModelMessages()` |
| `rename-vertex-provider-metadata-key` | `google` key to `vertex` in Google Vertex providerOptions |
| `wrap-tomodeloutput-parameter` | `toModelOutput: output => ...` to `toModelOutput: ({ output }) => ...` |
| `add-await-converttomodelmessages` | Adds `await` to `convertToModelMessages()` calls |

### 3.3 What the Codemod Does NOT Cover

The following require manual migration:
- `generateObject` / `streamObject` to `generateText` / `streamText` + `Output.object()`
- `Experimental_Agent` to `ToolLoopAgent`
- `system` parameter to `instructions` in agent configs
- `cachedInputTokens` / `reasoningTokens` deprecation in usage objects
- Per-tool `strict` mode migration (from global `providerOptions.openai.strictJsonSchema`)
- `ToolCallRepairFunction` system parameter type change
- Warning type consolidation (`CallWarning`, etc. to `Warning`)
- `isToolUIPart` / `getToolName` function renames (UI helpers)
- Finish reason `unknown` to `other` mapping

---

## 4. Core API Breaking Changes

### 4.1 Type Renames

**CoreMessage -> ModelMessage** [1]

```typescript
// BEFORE (SDK 5)
import { convertToCoreMessages, type CoreMessage } from 'ai';
const messages: CoreMessage[] = [...];
const coreMessages = convertToCoreMessages(uiMessages);

// AFTER (SDK 6)
import { convertToModelMessages, type ModelMessage } from 'ai';
const messages: ModelMessage[] = [...];
const modelMessages = await convertToModelMessages(uiMessages);  // NOW ASYNC
```

Critical: `convertToModelMessages` is now async. Every call site must be awaited. The `add-await-converttomodelmessages` codemod handles this automatically.

**ToolCallOptions -> ToolExecutionOptions** [1]

```typescript
// BEFORE
import type { ToolCallOptions } from 'ai';

// AFTER
import type { ToolExecutionOptions } from 'ai';
```

**Warning Type Unification** [1]

```typescript
// BEFORE
import type { CallWarning, ImageModelCallWarning, SpeechWarning, TranscriptionWarning } from 'ai';

// AFTER
import type { Warning } from 'ai';
```

### 4.2 LanguageModel Type: String | V2 | V3

In SDK 6, the `LanguageModel` type is a union of `string | LanguageModelV2 | LanguageModelV3` [5]. This means:

- **V3 models** (from updated providers like `@ai-sdk/google@3.x`) work natively
- **V2 models** (from older/unupdated providers) are automatically shimmed via a Proxy pattern that maps `specificationVersion` to `'v3'` [6]
- **String identifiers** (e.g., `'anthropic/claude-sonnet-4.5'`) work with the AI Gateway / provider registry

When a V2 model is detected, the SDK logs a compatibility warning: *"This model is using specification version v2. Please upgrade the package to the latest version."* [6]. Suppress warnings with `AI_SDK_LOG_WARNINGS=false`.

**Practical implication**: Your code will work even with older provider packages, but you should upgrade provider packages to get V3 support and silence the warnings.

### 4.3 Token Usage Property Changes

The `LanguageModelUsage` type has deprecated two convenience properties [1]:

```typescript
// BEFORE (SDK 5)
const { usage } = await generateText({ ... });
console.log(usage.cachedInputTokens);   // deprecated
console.log(usage.reasoningTokens);      // deprecated

// AFTER (SDK 6) -- use the detailed breakdowns
console.log(usage.inputTokenDetails.cacheReadTokens);
console.log(usage.outputTokenDetails.reasoningTokens);

// NEW detailed breakdown available:
usage.inputTokenDetails.noCacheTokens;
usage.inputTokenDetails.cacheReadTokens;
usage.inputTokenDetails.cacheWriteTokens;
usage.outputTokenDetails.textTokens;
usage.outputTokenDetails.reasoningTokens;
usage.raw;  // raw provider data
```

### 4.4 Finish Reason Change

The `unknown` finish reason is merged into `other` [1]. A new `rawFinishReason` property exposes the exact string from the provider:

```typescript
const { finishReason, rawFinishReason } = await generateText({ ... });
// finishReason: 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'other'
// rawFinishReason: provider-specific string like 'end_turn'
```

### 4.5 Tool.toModelOutput Parameter Wrapping

The `toModelOutput` function on tools now receives a parameter object instead of the output directly [1]:

```typescript
// BEFORE (SDK 5)
const myTool = tool({
  // ...
  toModelOutput: output => {
    return { type: 'text', value: `Result: ${output.data}` };
  },
});

// AFTER (SDK 6)
const myTool = tool({
  // ...
  toModelOutput: ({ output }) => {
    return { type: 'text', value: `Result: ${output.data}` };
  },
});
```

The parameter object also includes `input` and `toolCallId` properties for richer context:

```typescript
toModelOutput: async ({ input, output, toolCallId }) => {
  return { type: 'text', value: `Weather in ${input.location}: ${output.temperature}F` };
},
```

### 4.6 ToolCallRepairFunction System Parameter

The `system` parameter in `ToolCallRepairFunction` can now be `string | SystemModelMessage | undefined` instead of just `string | undefined` [1]:

```typescript
// BEFORE
const repairToolCall: ToolCallRepairFunction<MyTools> = async ({ system, ... }) => {
  // system: string | undefined
  const prompt = system ?? '';
};

// AFTER
import type { ToolCallRepairFunction, SystemModelMessage } from 'ai';
const repairToolCall: ToolCallRepairFunction<MyTools> = async ({ system, ... }) => {
  // system: string | SystemModelMessage | undefined
  const prompt = typeof system === 'string' ? system : system?.content ?? '';
};
```

### 4.7 Per-Tool Strict Mode

Strict JSON schema validation moved from a global provider option to individual tool configuration [1]:

```typescript
// BEFORE (SDK 5) -- global strict mode
const result = await generateText({
  model: openai('gpt-4o'),
  tools: { calculator: calculatorTool },
  providerOptions: {
    openai: { strictJsonSchema: true },  // applied to ALL tools
  },
});

// AFTER (SDK 6) -- per-tool strict mode
const calculatorTool = tool({
  description: 'Calculator',
  inputSchema: z.object({ expression: z.string() }),
  execute: async ({ expression }) => eval(expression),
  strict: true,  // per-tool control
});
```

Note: For OpenAI provider, `strictJsonSchema` now defaults to `true` [1].

---

## 5. Structured Output Migration: generateObject/streamObject -> Output API

This is the most significant API change for codebases that use structured output extensively.

### 5.1 generateObject -> generateText + Output.object()

`generateObject` and `streamObject` are **deprecated** (not removed yet, but will be removed in a future major version) [1][2]. Replace with `generateText`/`streamText` using the `Output` API:

```typescript
// BEFORE (SDK 5)
import { generateObject } from 'ai';
import { z } from 'zod';

const { object } = await generateObject({
  model: google('gemini-3-flash-preview'),
  schema: z.object({
    recipe: z.object({
      name: z.string(),
      ingredients: z.array(z.object({ name: z.string(), amount: z.string() })),
      steps: z.array(z.string()),
    }),
  }),
  prompt: 'Generate a lasagna recipe.',
});
console.log(object.recipe.name);

// AFTER (SDK 6)
import { generateText, Output } from 'ai';
import { z } from 'zod';

const { output } = await generateText({
  model: google('gemini-3-flash-preview'),
  output: Output.object({
    schema: z.object({
      recipe: z.object({
        name: z.string(),
        ingredients: z.array(z.object({ name: z.string(), amount: z.string() })),
        steps: z.array(z.string()),
      }),
    }),
  }),
  prompt: 'Generate a lasagna recipe.',
});
console.log(output.recipe.name);
```

Key differences:
- Import `Output` from `'ai'`
- Schema goes inside `Output.object({ schema: ... })` instead of top-level `schema:`
- Result is accessed via `.output` instead of `.object`
- **Benefit**: Can now combine tools AND structured output in a single call

### 5.2 streamObject -> streamText + Output.object()

```typescript
// BEFORE (SDK 5)
import { streamObject } from 'ai';
const { partialObjectStream } = streamObject({
  model: google('gemini-3-flash-preview'),
  schema: z.object({ name: z.string(), steps: z.array(z.string()) }),
  prompt: 'Generate a recipe.',
});
for await (const partial of partialObjectStream) {
  console.log(partial);
}

// AFTER (SDK 6)
import { streamText, Output } from 'ai';
const { partialOutputStream } = streamText({
  model: google('gemini-3-flash-preview'),
  output: Output.object({
    schema: z.object({ name: z.string(), steps: z.array(z.string()) }),
  }),
  prompt: 'Generate a recipe.',
});
for await (const partial of partialOutputStream) {
  console.log(partial);
}
```

Key difference: `partialObjectStream` becomes `partialOutputStream`.

### 5.3 Output Types

The `Output` namespace provides several specification types [2][7]:

| Output Type | Purpose |
|------------|---------|
| `Output.text()` | Plain text (default) |
| `Output.object({ schema })` | Typed object matching a Zod schema |
| `Output.array({ schema })` | Array of typed objects |
| `Output.choice({ enum })` | Selection from predefined options |
| `Output.json()` | Unstructured JSON output |

### 5.4 Combining Tools + Structured Output

The major advantage of the new API is that structured output and tool calling can now coexist [2]:

```typescript
import { generateText, Output, tool } from 'ai';
import { z } from 'zod';

const { output } = await generateText({
  model: google('gemini-3-flash-preview'),
  tools: {
    getWeather: tool({
      description: 'Get weather data',
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => ({ temp: 72, conditions: 'sunny' }),
    }),
  },
  output: Output.object({
    schema: z.object({
      summary: z.string(),
      temperature: z.number(),
      recommendation: z.string(),
    }),
  }),
  prompt: 'What is the weather in SF? Give me a recommendation.',
});
```

Previously, this required chaining `generateText` (for tool calls) and then `generateObject` (for structured output) in separate calls.

---

## 6. Agent Pattern Changes

### 6.1 Experimental_Agent -> ToolLoopAgent

```typescript
// BEFORE (SDK 5)
import { Experimental_Agent as Agent, stepCountIs } from 'ai';
const agent = new Agent({
  model: google('gemini-3-flash-preview'),
  system: 'You are a helpful assistant.',
  tools: { weather: weatherTool },
  stopWhen: stepCountIs(20),
});

// AFTER (SDK 6)
import { ToolLoopAgent } from 'ai';
const agent = new ToolLoopAgent({
  model: google('gemini-3-flash-preview'),
  instructions: 'You are a helpful assistant.',    // renamed from 'system'
  tools: { weather: weatherTool },
  // stopWhen defaults to stepCountIs(20), no need to specify
});
```

Changes:
- `Experimental_Agent` renamed to `ToolLoopAgent`
- `system` parameter renamed to `instructions`
- Default `stopWhen` changed from `stepCountIs(1)` to `stepCountIs(20)`
- `instructions` accepts `string | SystemModelMessage | SystemModelMessage[]`

### 6.2 ToolLoopAgent API

The agent has two main methods [8]:

```typescript
// One-shot generation
const result = await agent.generate({
  prompt: 'What is the weather in SF?',
});
console.log(result.text);

// Streaming
const stream = agent.stream({
  prompt: 'What is the weather in SF?',
});
for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}
```

### 6.3 New: callOptionsSchema + prepareCall

Agents can accept runtime options without reconstruction [2]:

```typescript
const supportAgent = new ToolLoopAgent({
  model: google('gemini-3-flash-preview'),
  callOptionsSchema: z.object({
    userId: z.string(),
    accountType: z.enum(['free', 'pro', 'enterprise']),
  }),
  prepareCall: ({ options, ...settings }) => ({
    ...settings,
    instructions: `Support agent for ${options.accountType} user ${options.userId}`,
  }),
});

const result = await supportAgent.generate({
  prompt: 'How do I upgrade?',
  options: { userId: 'user_123', accountType: 'free' },
});
```

### 6.4 New: Human-in-the-Loop Tool Approval

Tools can require user approval before execution [2]:

```typescript
const dangerousTool = tool({
  description: 'Run a shell command',
  inputSchema: z.object({ command: z.string() }),
  needsApproval: true,  // or: async ({ command }) => command.includes('rm')
  execute: async ({ command }) => { /* ... */ },
});
```

---

## 7. Testing Mock Changes

### 7.1 Mock Class V2 -> V3

All test mock classes have been renamed [1]:

```typescript
// BEFORE (SDK 5)
import {
  MockEmbeddingModelV2,
  MockImageModelV2,
  MockLanguageModelV2,
  MockProviderV2,
  MockSpeechModelV2,
  MockTranscriptionModelV2,
} from 'ai/test';

// AFTER (SDK 6)
import {
  MockEmbeddingModelV3,
  MockImageModelV3,
  MockLanguageModelV3,
  MockProviderV3,
  MockSpeechModelV3,
  MockTranscriptionModelV3,
} from 'ai/test';
```

The `rename-mock-v2-to-v3` codemod handles this automatically.

### 7.2 Mock Behavior

The mock classes implement the V3 specification interfaces. If your tests configure mock responses, the response shapes may have changed to match V3 (e.g., token usage details). Review test assertions that check specific response structures.

---

## 8. Embedding Model Renames

Provider methods for creating embedding models have been renamed [1]:

```typescript
// BEFORE (SDK 5)
import { google } from '@ai-sdk/google';
const model = google.textEmbeddingModel('text-embedding-004');
// or
const model = google.textEmbedding('text-embedding-004');

// AFTER (SDK 6)
const model = google.embeddingModel('text-embedding-004');
// or
const model = google.embedding('text-embedding-004');
```

This applies to all providers, not just Google.

---

## 9. Provider-Specific Changes

### 9.1 Google / Google Vertex

**Vertex providerOptions key change** [1]:

```typescript
// BEFORE
providerOptions: { google: { safetySettings: [...] } }
result.providerMetadata?.google?.safetyRatings;

// AFTER
providerOptions: { vertex: { safetySettings: [...] } }
result.providerMetadata?.vertex?.safetyRatings;
```

This only affects Google Vertex, not the regular `@ai-sdk/google` provider.

### 9.2 OpenAI

- `strictJsonSchema` defaults to `true` (was `false`) [1]
- `structuredOutputs` option removed -- use `strictJsonSchema` instead [1]
- Azure default changed to Responses API (use `azure.chat()` for Chat Completions) [1]

### 9.3 Anthropic

New `structuredOutputMode` option for Claude Sonnet 4.5+ [1]:

```typescript
providerOptions: {
  anthropic: {
    structuredOutputMode: 'outputFormat' | 'jsonTool' | 'auto',
  },
}
```

---

## 10. Zod Compatibility

### 10.1 Current State

AI SDK 6 supports both Zod 3.25+ and Zod 4.x [9][12]. The project's current `zod@^4.3.6` is fully compatible.

### 10.2 Standard JSON Schema V1

AI SDK 6 adds support for **any schema library** that implements the Standard JSON Schema V1 interface [2]. This means you can use Arktype, Valibot, or other libraries alongside or instead of Zod:

```typescript
import { type } from 'arktype';
const result = await generateText({
  model: google('gemini-3-flash-preview'),
  output: Output.object({
    schema: type({ name: 'string', age: 'number' }),
  }),
  prompt: 'Generate a person.',
});
```

Zod schemas continue to work as before. The `zodSchema()` helper function is still available for advanced options like `useReferences` for recursive schemas [12].

### 10.3 Metadata Ordering

When using `.meta()` or `.describe()` on Zod schemas, these must be the **last method in the chain** because most schema methods return a new instance that does not inherit metadata [12]:

```typescript
// CORRECT
z.string().min(1).describe('A name')

// INCORRECT -- describe is lost by the subsequent .min()
z.string().describe('A name').min(1)
```

---

## 11. UI Helper Renames

Several UI helper functions were renamed for clarity [1]:

| Before (SDK 5) | After (SDK 6) |
|----------------|--------------|
| `isToolUIPart` | `isStaticToolUIPart` |
| `isToolOrDynamicToolUIPart` | `isToolUIPart` |
| `getToolName` | `getStaticToolName` |
| `getToolOrDynamicToolName` | `getToolName` |

Note the swap: `isToolUIPart` in SDK 5 becomes `isStaticToolUIPart`, while `isToolOrDynamicToolUIPart` takes over the `isToolUIPart` name.

---

## 12. New Features Worth Noting

While not breaking changes, these new features in SDK 6 may be relevant to the migration:

### 12.1 DevTools

Debug agent flows with the DevTools middleware [2]:

```bash
npx @ai-sdk/devtools  # Opens inspector at http://localhost:4983
```

```typescript
import { wrapLanguageModel } from 'ai';
import { devToolsMiddleware } from '@ai-sdk/devtools';

const model = wrapLanguageModel({
  model: google('gemini-3-flash-preview'),
  middleware: devToolsMiddleware(),
});
```

### 12.2 MCP Enhancements

HTTP transport with auth, OAuth flow automation, resources/prompts support, and elicitation [2].

### 12.3 Provider-Specific Tools

Built-in tools for Anthropic (memory, code execution, tool search), OpenAI (shell, file ops, MCP), Google (Maps, RAG, file search), and xAI (web search, X search) [2].

### 12.4 Reranking API

New `rerank()` function for RAG improvement [2].

---

## 13. Migration Checklist

### Phase 1: Preparation

- [ ] Commit all current changes
- [ ] Read through this guide completely
- [ ] Identify all uses of deprecated APIs with `grep`:
  - `generateObject` / `streamObject`
  - `Experimental_Agent`
  - `CoreMessage` / `convertToCoreMessages`
  - `MockLanguageModelV2` / `MockProviderV2`
  - `cachedInputTokens` / `reasoningTokens`
  - `textEmbeddingModel` / `textEmbedding`
  - `ToolCallOptions`

### Phase 2: Dependency Updates

- [ ] Update `package.json`:
  ```json
  {
    "ai": "^6.0.0",
    "@ai-sdk/google": "^3.0.0",
    "@ai-sdk/openai-compatible": "latest",
    "@openrouter/ai-sdk-provider": "^2.0.0"
  }
  ```
- [ ] Run `pnpm install`
- [ ] Verify no peer dependency conflicts

### Phase 3: Automated Codemod

- [ ] Run `npx @ai-sdk/codemod --dry v6` to preview changes
- [ ] Run `npx @ai-sdk/codemod v6` to apply
- [ ] Review git diff for correctness

### Phase 4: Manual Migration

- [ ] Migrate `generateObject` calls to `generateText` + `Output.object()`
- [ ] Migrate `streamObject` calls to `streamText` + `Output.object()`
- [ ] Replace `Experimental_Agent` with `ToolLoopAgent`
- [ ] Rename `system` to `instructions` in agent configs
- [ ] Update `cachedInputTokens` / `reasoningTokens` usage
- [ ] Update any `ToolCallRepairFunction` implementations
- [ ] Move `strictJsonSchema` from global to per-tool `strict`
- [ ] Update UI helper function names if applicable

### Phase 5: Testing

- [ ] Run test suite: `pnpm test:run`
- [ ] Fix any mock class issues (V2 -> V3)
- [ ] Verify structured output still parses correctly
- [ ] Test tool calling flows
- [ ] Test any streaming flows

### Phase 6: Cleanup

- [ ] Set `AI_SDK_LOG_WARNINGS=false` if needed (or fix all warnings)
- [ ] Remove any unused imports
- [ ] Consider adopting new features (Output types, ToolLoopAgent, DevTools)

---

## 14. Potential Gotchas

1. **convertToModelMessages is async**: This is easy to miss and will cause runtime errors (returns a Promise instead of an array). The codemod handles it, but verify.

2. **generateObject still works**: It is deprecated, not removed. You can migrate incrementally -- but plan to complete the migration before the next major version.

3. **V2 provider packages still work**: The Proxy shim handles backward compatibility, but you get warning logs. Upgrade providers to silence warnings and get V3 features.

4. **OpenAI strict mode default changed**: If your schemas are not strict-mode compatible (e.g., use `additionalProperties`), you may need to explicitly disable strict mode.

5. **@ai-sdk/openai-compatible version**: The migration guide says `@ai-sdk/*` should be `^3.0.0`, but the openai-compatible package appears to currently be at `2.0.x` on npm. Check whether a 3.x release exists at migration time, or verify that 2.x works with `ai@6`.

6. **ToolLoopAgent default stopWhen**: Changed from `stepCountIs(1)` to `stepCountIs(20)`. If you previously relied on single-step behavior without explicitly setting `stopWhen`, your agent will now loop up to 20 steps.

7. **Zod metadata ordering**: `.describe()` and `.meta()` must be the last method call in a chain, or the metadata is lost.

---

## 15. Conclusion

The AI SDK 5 to 6 migration is characterized as a moderate effort. The most impactful changes are:

1. **Structured output API** (`generateObject` -> `generateText` + `Output`): The highest volume of code changes in most codebases, but straightforward pattern replacement.

2. **Provider package versions**: Must upgrade `@ai-sdk/google` from 2.x to 3.x, `@openrouter/ai-sdk-provider` from 1.x to 2.x, and `@ai-sdk/openai-compatible` to the latest SDK-6-compatible version.

3. **Test mocks**: Simple rename from V2 to V3.

4. **Token usage properties**: Update any cost/usage tracking code to use the new detailed breakdown properties.

The automated codemod handles ~8 of the mechanical transformations, covering type renames, mock renames, async changes, and parameter wrapping. The structured output migration and agent changes require manual work.

The upgrade unlocks significant new capabilities: the `ToolLoopAgent` abstraction, combined tool-calling + structured output, human-in-the-loop approval, DevTools debugging, and the expanded provider tool ecosystem.

---

## References

1. [Migration Guide: AI SDK 5.x to 6.0](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0)
2. [AI SDK 6 Blog Post](https://vercel.com/blog/ai-sdk-6)
3. [@ai-sdk/codemod npm Package](https://www.npmjs.com/package/@ai-sdk/codemod)
4. [GitHub Issue #8662: v6 Planning](https://github.com/vercel/ai/issues/8662)
5. [GitHub Issue #9018: LanguageModel Type Union](https://github.com/vercel/ai/issues/9018)
6. [GitHub Issue #10689: V2 Model Warnings](https://github.com/vercel/ai/issues/10689)
7. [generateText API Reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text)
8. [ToolLoopAgent API Reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)
9. [@openrouter/ai-sdk-provider Changelog](https://github.com/OpenRouterTeam/ai-sdk-provider/blob/main/CHANGELOG.md)
10. [Troubleshooting: Unsupported Model Version](https://ai-sdk.dev/docs/troubleshooting/unsupported-model-version)
11. [OpenAI Compatible Providers Documentation](https://ai-sdk.dev/providers/openai-compatible-providers)
12. [zodSchema Reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/zod-schema)
13. [Cloudflare AI SDK v6 Support Announcement](https://developers.cloudflare.com/changelog/2025-12-22-agents-sdk-ai-sdk-v6/)
14. [@ai-sdk/google npm Package](https://www.npmjs.com/package/@ai-sdk/google)
15. [@ai-sdk/openai-compatible npm Package](https://www.npmjs.com/package/@ai-sdk/openai-compatible)
16. [Zod v4 Versioning](https://zod.dev/v4/versioning)
17. [GitHub Discussion: Zod v4 with AI SDK](https://github.com/vercel/ai/discussions/7289)
