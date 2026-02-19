# Vercel AI SDK Ecosystem: State of the Art (February 2026)

## Abstract

This report documents the current state of the Vercel AI SDK (`@ai-sdk`) ecosystem as of February 19, 2026. The SDK has undergone two major version transitions since mid-2025: AI SDK 5.0 (released July 31, 2025) introduced the LanguageModelV2 specification with sweeping API changes, and AI SDK 6.0 (released December 22, 2025) introduced the LanguageModelV3 specification focused on agents and provider-executed tools. The core `ai` package is now at version 6.0.92, `@ai-sdk/provider` is at 3.0.8, and first-party provider packages have been bumped to their corresponding major versions. Notably, some providers built on the `@ai-sdk/openai-compatible` base layer (such as `@ai-sdk/fireworks`) remain on v2.x because the openai-compatible layer itself has not yet been updated to v3. This report provides a comprehensive version inventory, documents all breaking changes in the LanguageModel type system across versions, and outlines migration paths.

## 1. Current Version Inventory

All versions verified via npm registry on February 19, 2026.

### Core Packages

| Package | Latest Version | Release Date (Major) |
|---------|---------------|---------------------|
| `ai` | **6.0.92** | 6.0.0: Dec 22, 2025 |
| `@ai-sdk/provider` | **3.0.8** | 3.0.0: Dec 22, 2025 |
| `@ai-sdk/provider-utils` | **4.0.15** | 4.0.0: Dec 22, 2025 |
| `@ai-sdk/gateway` | **3.0.51** | -- |
| `@ai-sdk/react` | **3.0.94** | -- |

### First-Party Provider Packages (v3.x -- LanguageModelV3)

These providers implement the LanguageModelV3 specification directly.

| Package | Latest Version |
|---------|---------------|
| `@ai-sdk/google` | **3.0.30** |
| `@ai-sdk/openai` | **3.0.30** |
| `@ai-sdk/anthropic` | **3.0.45** |
| `@ai-sdk/xai` | **3.0.57** |
| `@ai-sdk/mistral` | **3.0.20** |
| `@ai-sdk/google-vertex` | **4.0.60** |

### OpenAI-Compatible Layer Packages (v2.x -- LanguageModelV2 still)

These providers are built on top of `@ai-sdk/openai-compatible` and remain on the v2 specification. They still work with AI SDK 6 through the backward-compatible union type.

| Package | Latest Version | Notes |
|---------|---------------|-------|
| `@ai-sdk/openai-compatible` | **2.0.30** | Base layer, still v2 |
| `@ai-sdk/fireworks` | **2.0.34** | Built on openai-compatible |
| `@ai-sdk/deepseek` | **2.0.20** | Built on openai-compatible |

### Community/Third-Party Providers

| Package | Latest Version | Notes |
|---------|---------------|-------|
| `@openrouter/ai-sdk-provider` | **2.2.3** | Published by OpenRouter (not Vercel). Has alpha `6.0.0-alpha.1` for SDK 6. |
| `ollama-ai-provider-v2` | -- | Community maintained |

### No Official `@ai-sdk/openrouter` Package

There is **no** official `@ai-sdk/openrouter` package published by Vercel. The OpenRouter provider is community-maintained as `@openrouter/ai-sdk-provider`, published by the OpenRouter team. According to [npm](https://www.npmjs.com/package/@openrouter/ai-sdk-provider), the latest stable version is 2.2.3, with `6.0.0-alpha.0` and `6.0.0-alpha.1` prereleases available.

## 2. Version Mapping: SDK to Specification

The AI SDK uses a clear mapping between the core `ai` package version, the `@ai-sdk/provider` package version, and the Language Model specification version:

| `ai` Major | `@ai-sdk/provider` Major | Spec Version | Release Date |
|-----------|-------------------------|-------------|-------------|
| 4.x | 1.x | LanguageModelV1 | Pre-July 2025 |
| 5.x | 2.x | LanguageModelV2 | July 31, 2025 |
| 6.x | 3.x | LanguageModelV3 | Dec 22, 2025 |

The internal dependency chain confirms this: `ai@5.0.0` depends on `@ai-sdk/provider@2.0.0`, while `ai@6.0.0` depends on `@ai-sdk/provider@3.0.0`.

## 3. LanguageModelV3: What Changed from V2

The LanguageModelV3 specification was introduced via [PR #8877](https://github.com/vercel/ai/issues/8767) (merged September 26, 2025) and released as part of AI SDK 6.0 on December 22, 2025. According to the [AI SDK 6 announcement](https://vercel.com/blog/ai-sdk-6), the v3 spec is an evolution rather than a redesign.

### LanguageModelV3 Interface

```typescript
interface LanguageModelV3 {
  specificationVersion: 'v3';  // was 'v2'
  provider: string;
  modelId: string;
  supportedUrls: Record<string, RegExp[]>;
  doGenerate(options: LanguageModelV3CallOptions): Promise<GenerateResult>;
  doStream(options: LanguageModelV3CallOptions): Promise<StreamResult>;
}
```

### Key V2 to V3 Changes

Based on the [migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0) and [custom provider docs](https://ai-sdk.dev/providers/community-providers/custom-providers):

1. **`specificationVersion`**: Changed from `'v2'` to `'v3'`.

2. **Tool Call Structure**: `LanguageModelV2ToolCall` only had a `providerExecuted?: boolean` property. `LanguageModelV3ToolCall` adds a `dynamic` property for runtime-unknown tool types.

3. **Provider-Executed Tools**: Full support for tools that are executed by the provider itself (e.g., Anthropic's computer use, Google's search grounding). This was experimental in V2.

4. **Middleware Specification**: `LanguageModelV2Middleware` became `LanguageModelV3Middleware`. The middleware now receives both `doGenerate` and `doStream` in the stream wrapper, enabling richer interception patterns.

5. **Content Types**: Enhanced support for reasoning content (chain-of-thought), source citations, and file generation as native content types.

6. **Token Usage Types**: `LanguageModelV3Usage` differs from `LanguageModelUsage` in structure -- [issue #11312](https://github.com/vercel/ai/issues/11312) documents type incompatibilities between these.

### Backward Compatibility

The `LanguageModel` type is now a union:

```typescript
export type LanguageModel = string | LanguageModelV2 | LanguageModelV3;
```

This means V2 providers **still work** with AI SDK 6, though the SDK [issues a compatibility warning](https://github.com/vercel/ai/issues/10689) when V2 models are used. The internal adaptation from V2 to V3 is handled via a JavaScript Proxy, though the implementation notes it "could break" in edge cases.

## 4. Migration Path: AI SDK 4.x to 5.0

AI SDK 5.0 was released on [July 31, 2025](https://vercel.com/blog/ai-sdk-5). This was a major rewrite with extensive breaking changes.

### Breaking Changes (4.x to 5.0)

According to the [migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0):

- **Message Types**: `CoreMessage` renamed to `ModelMessage`; `Message` renamed to `UIMessage`. The `.content` property on `UIMessage` was replaced with a `parts` array.
- **Function Renames**: `convertToCoreMessages` became `convertToModelMessages` (now async).
- **Tool Definitions**: `parameters` renamed to `inputSchema`; `result` to `output`; `args` to `input`.
- **Model Options**: `maxTokens` renamed to `maxOutputTokens`.
- **Token Properties**: `promptTokens` became `inputTokens`; `completionTokens` became `outputTokens`.
- **Loop Control**: `maxSteps` replaced with `stopWhen` for more flexible agent control.
- **Provider Metadata**: Input parameter `providerMetadata` renamed to `providerOptions` (output still uses `providerMetadata`).
- **Temperature**: No longer defaults to `0` -- must be explicitly set.
- **Zod 4**: Requires `zod@4.1.8` or later.
- **LanguageModelV1 Middleware** renamed to **LanguageModelV2Middleware**.

### Migration Tools

- **Codemods**: `npx @ai-sdk/codemod v5` for automated transformations.
- **MCP Server**: The [AI SDK 5 Migration MCP Server](https://github.com/vercel-labs/ai-sdk-5-migration-mcp-server) provides assisted migration via coding agents.

## 5. Migration Path: AI SDK 5.x to 6.0

AI SDK 6.0 was released on [December 22, 2025](https://vercel.com/blog/ai-sdk-6). Unlike the 4-to-5 transition, this is described as **not a complete redesign** -- the version bump primarily reflects the new v3 Language Model Specification.

### Breaking Changes (5.x to 6.0)

According to the [migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0):

- **Package Requirements**: `ai@^6.0.0`, `@ai-sdk/provider@^3.0.0`, `@ai-sdk/provider-utils@^4.0.0`, all `@ai-sdk/*` provider packages at `^3.0.0` (for first-party V3 providers).
- **Agent Class**: `Experimental_Agent` replaced with `ToolLoopAgent`. The `system` parameter renamed to `instructions`; default `stopWhen` changed from `stepCountIs(1)` to `stepCountIs(20)`.
- **Structured Output**: `generateObject` and `streamObject` deprecated in favor of `generateText`/`streamText` with an `output` setting. Return property changes from `object` to `output`.
- **Embedding Renames**: `textEmbeddingModel` to `embeddingModel`; `textEmbedding` to `embedding`. Generics removed from `EmbeddingModel`.
- **Token Usage**: `cachedInputTokens` deprecated in favor of `inputTokenDetails.cacheReadTokens`; `reasoningTokens` deprecated for `outputTokenDetails.reasoningTokens`.
- **Finish Reason**: `unknown` finish reason removed, now returned as `other`.
- **Tool UI Helpers**: Several renames (`isToolUIPart` to `isStaticToolUIPart`, etc.).
- **Testing Module**: V2 mock classes removed from `ai/test` -- use `MockLanguageModelV3` instead of `MockLanguageModelV2`.
- **Strict Mode**: Now controlled per-tool via `strict` property instead of provider-level `strictJsonSchema`.
- **`CoreMessage` type and `convertToCoreMessages()`**: Fully removed (were deprecated in 5.0).

### Provider-Specific 6.0 Changes

- **OpenAI**: `strictJsonSchema` enabled by default; `structuredOutputs` option removed.
- **Azure**: Default `azure()` uses Responses API; use `azure.chat()` for Chat Completions. Provider key changed from `openai` to `azure`.
- **Anthropic**: New `structuredOutputMode` option with three modes.
- **Google Vertex**: Provider key changed from `google` to `vertex`.

### Migration Tools

- **Codemods**: `npx @ai-sdk/codemod v6` for automated transformations.

## 6. Breaking Changes in the LanguageModel Type

### Summary Across Versions

| Aspect | V1 (SDK 4.x) | V2 (SDK 5.x) | V3 (SDK 6.x) |
|--------|-------------|-------------|-------------|
| Spec Version | `'v1'` | `'v2'` | `'v3'` |
| Package | `@ai-sdk/provider@1.x` | `@ai-sdk/provider@2.x` | `@ai-sdk/provider@3.x` |
| Tool Calls | Basic | `providerExecuted` flag | `providerExecuted` + `dynamic` |
| Token Props | `promptTokens`/`completionTokens` | `inputTokens`/`outputTokens` | Same as V2 + `inputTokenDetails`/`outputTokenDetails` |
| Tool Schema | `parameters` | `inputSchema` | `inputSchema` |
| Middleware | `LanguageModelV1Middleware` | `LanguageModelV2Middleware` | `LanguageModelV3Middleware` |
| Provider Tools | Not supported | Experimental | Native support |
| Union Type | N/A | N/A | `string \| V2 \| V3` |

### Compatibility Notes

- V2 models work in AI SDK 6 via the union type `LanguageModel = string | LanguageModelV2 | LanguageModelV3`, with a [runtime compatibility warning](https://github.com/vercel/ai/issues/10689).
- V1 models do **not** work in AI SDK 5 or 6 -- the error message `"Unsupported model version v1"` is thrown.
- The V2-to-V3 adaptation uses a Proxy pattern internally but has [acknowledged limitations](https://github.com/vercel/ai/issues/10689).

## 7. Impact on This Project (Umwelten)

The umwelten project currently uses:

| Package | Current Version | Latest Available | Gap |
|---------|----------------|-----------------|-----|
| `ai` | `^5.0.115` | `6.0.92` | **Major version behind** |
| `@ai-sdk/google` | `^2.0.51` | `3.0.30` | **Major version behind** |
| `@ai-sdk/fireworks` | `^2.0.34` | `2.0.34` | Current (v3 does not exist) |
| `@ai-sdk/openai-compatible` | `^1.0.29` | `2.0.30` | **Major version behind** |
| `@openrouter/ai-sdk-provider` | `^1.5.4` | `2.2.3` | **Major version behind** |
| `zod` | `^4.3.6` | Current | OK |

### Upgrade Considerations

1. **Low-risk path**: Upgrade `@ai-sdk/openai-compatible` from 1.x to 2.x (aligns with SDK 5), and `@openrouter/ai-sdk-provider` to 2.x. These are necessary even without the SDK 6 jump.

2. **Full upgrade to SDK 6**: Would require updating `ai` to `^6.0.0`, `@ai-sdk/google` to `^3.0.0`, and adopting the V3 specification changes. Key code changes needed:
   - Replace any `generateObject`/`streamObject` calls with `generateText`/`streamText` + `output` setting.
   - Update mock classes in tests to V3.
   - Handle the `CoreMessage` removal (use `ModelMessage`).
   - Review `maxSteps` vs `stopWhen` usage.

3. **`@ai-sdk/fireworks` stays at 2.x**: Since `@ai-sdk/openai-compatible` is still at 2.x, `@ai-sdk/fireworks` has no v3 release. It will continue working with SDK 6 via the V2 compatibility layer.

## 8. New Features Worth Noting in SDK 6

- **`ToolLoopAgent`**: Production-ready agent class with configurable stop conditions and step preparation hooks.
- **Human-in-the-Loop**: Tools support `needsApproval` flag for safety controls.
- **DevTools**: `devToolsMiddleware` provides full visibility into LLM calls at `localhost:4983`.
- **Stable MCP**: `@ai-sdk/mcp` is now stable with HTTP transport, OAuth, resource access, prompts, and elicitation.
- **Reranking**: New `rerank()` function via Cohere, Bedrock, and Together.ai providers.
- **Provider-Specific Tools**: Anthropic memory/code execution, OpenAI shell/MCP, Google Maps grounding, xAI web search.

## References

1. [AI SDK 6 Announcement](https://vercel.com/blog/ai-sdk-6) -- Vercel Blog
2. [AI SDK 5 Announcement](https://vercel.com/blog/ai-sdk-5) -- Vercel Blog
3. [Migration Guide: AI SDK 5.x to 6.0](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0) -- AI SDK Docs
4. [Migration Guide: AI SDK 4.x to 5.0](https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0) -- AI SDK Docs
5. [Writing a Custom Provider](https://ai-sdk.dev/providers/community-providers/custom-providers) -- AI SDK Docs
6. [Unsupported Model Version Troubleshooting](https://ai-sdk.dev/docs/troubleshooting/unsupported-model-version) -- AI SDK Docs
7. [GitHub Issue #10689: Warn on V2 models in SDK 6](https://github.com/vercel/ai/issues/10689) -- GitHub
8. [GitHub Issue #9018: LanguageModel Union Type](https://github.com/vercel/ai/issues/9018) -- GitHub
9. [GitHub Issue #8767: Create V3 Spec](https://github.com/vercel/ai/issues/8767) -- GitHub
10. [GitHub Issue #11312: LanguageModelUsage vs V3Usage](https://github.com/vercel/ai/issues/11312) -- GitHub
11. [AI SDK 5 Migration MCP Server](https://github.com/vercel-labs/ai-sdk-5-migration-mcp-server) -- GitHub
12. [npm: ai package](https://www.npmjs.com/package/ai) -- npm
13. [npm: @ai-sdk/provider](https://www.npmjs.com/package/@ai-sdk/provider) -- npm
14. [npm: @ai-sdk/fireworks](https://www.npmjs.com/package/@ai-sdk/fireworks) -- npm
15. [npm: @openrouter/ai-sdk-provider](https://www.npmjs.com/package/@openrouter/ai-sdk-provider) -- npm
16. [AI SDK Versioning](https://ai-sdk.dev/docs/migration-guides/versioning) -- AI SDK Docs
