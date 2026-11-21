---
kind: standard
id: uncapped-benchmark-generation
title: Uncapped Output Generation for Model Benchmarks
source: https://standards.thefocus.ai/packs/uncapped-benchmark-generation.md
version: 1
status: in_force
---

## Intent

Ensure model runners and evaluation harnesses never inject hidden default output-token ceilings that silently truncate reasoning chains and invalidate downstream quality and throughput benchmarks.

## Invariants

- **[no-default-output-token-cap]** (*NEVER*): Shared model runners and request builders **NEVER** inject a default `maxTokens`, `maxOutputTokens`, or `max_completion_tokens` ceiling when a task or stimulus omits an explicit limit.
- **[explicit-task-cap-only]**: Setting an output-token limit on a specific `Stimulus` forwards that exact per-task ceiling into the outgoing provider request without affecting uncapped calls.

## Verification

1. **Request Builder Guard Suite**: Run `pnpm exec vitest run packages/core/src/cognition/request-options.test.ts packages/core/src/cognition/real-stream-contract.test.ts` and confirm default invocations omit both `maxOutputTokens` and `piStreamOptions.maxTokens` while explicit `Stimulus.maxTokens` values propagate unchanged.
