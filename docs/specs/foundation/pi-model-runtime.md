---
kind: spec
id: pi-model-runtime
title: Direct Pi-AI Model Resolution and Uncapped Turn Execution
layer: foundation
version: 2
uses:
  - standards/uncapped-benchmark-generation@1
  - standards/per-speaker-agent-identity@1
---

## Intent

Execute model turns, tool loops, and constrained structured outputs directly through `@earendil-works/pi-ai` (`builtinModels()` + `~/.pi/agent/models.json`) inside `@umwelten/pi`—with zero custom `cognition/`, `Stimulus`, `Interaction`, `BaseModelRunner`, or `providers/` abstractions.

## Invariants

- **[zero-vercel-ai-sdk]** (*NEVER*): Workspace `package.json` manifests and TypeScript sources **NEVER** depend on or import `ai`, `@ai-sdk/*`, `@openrouter/ai-sdk-provider`, or `ollama-ai-provider-v2`.
- **[no-bespoke-provider-or-cognition-layer]** (*NEVER*): Umwelten **NEVER** maintains a `packages/core` package, `cognition/` runner hierarchy, `Stimulus` / `Interaction` wrapper classes, or static vendor pricing tables; cloud models resolve directly via `@earendil-works/pi-ai`'s `builtinModels()` and custom endpoints configure via `~/.pi/agent/models.json`.
- **[stream-error-fidelity]** (*NEVER*): Upstream provider stream errors **NEVER** collapse into generic `"No output generated"` placeholders; `runPiTurn` surfaces the provider's error message directly.

## Acceptance Criteria

- **[multi-step-tool-and-structured-execution]**: `runPiTurn` and `runPiStructuredObject` validate tool arguments, execute multi-step tool calls over raw `models.stream()` without injecting default `maxTokens`, and enforce Zod schemas via `__structured_output` constrained sampling.
- **[local-runtime-dialect-controls]**: Local endpoints (`llamaswap-nothink`, `llamabarn-nothink`, `ollama`) forward `chat_template_kwargs` / `think` controls, and `@umwelten/supplier` distinguishes rejected `vLLM` API keys (`VllmAuthError`) from unreachable local ports.

## Verification

1. **Direct Pi-AI & Supplier Discovery Suite**: Run `pnpm exec vitest run packages/pi/src/models.test.ts packages/supplier/src/discover.test.ts`.
