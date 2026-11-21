---
kind: spec
id: evaluation-and-ranking
title: Multi-Model Evaluation Suites, Pairwise Elo Ranking, Calibrated Judgments, and Scorecards
layer: orchestration
version: 2
uses:
  - standards/uncapped-benchmark-generation@1
---

## Intent

Evaluate and compare models directly over `@earendil-works/pi-ai` across deterministic `VerifyTask`s, structured LLM `JudgeTask`s, Swiss/round-robin `PairwiseRanker` Elo tournaments, and calibrated `Jev` probability judgments, aggregating cost, latency, and quality into reproducible scorecards.

## Invariants

- **[watchdog-abort-propagation]** (*NEVER*): Aborting an evaluation task's `AbortSignal` **NEVER** leaves the underlying `pi-ai` provider stream running in the background; cancellation propagates through `EvalSuite` and `runPiTurn` to the active HTTP request.

## Acceptance Criteria

- **[cached-deterministic-and-judged-suites]**: `EvalSuite` executes `VerifyTask` and `JudgeTask` definitions across model lists with configurable concurrency and per-task timeouts, caching responses and judge scores on disk so interrupted runs resume without re-billing completed cells.
- **[elo-pairwise-tournaments]**: `PairwiseRanker` pairs model outputs via `swissPairs` or `allPairs`, caches head-to-head judge verdicts under canonical alphabetical matchup keys, and computes rating-conserving Elo standings.
- **[calibrated-probability-judgments]**: `createJevBackend` and `createLlmJudgmentBackend` validate `binary`, `choice`, and `ordinal` probability distributions and score them with proper scoring rules (`brierScore`, `rankedProbabilityScore`, `reliabilityBins`, `selectiveRisk`).
- **[combined-dimension-reporting]**: `loadSuite` and `buildSuiteReport` / `buildNarrativeReport` normalize multi-suite `EvalDimension` results into console, Markdown, JSON, and narrative leaderboards.

## Verification

1. **Evaluation, Ranking & Judgment Suite**: Run `pnpm exec vitest run packages/evaluation/` and `pnpm tsx examples/jev/run.ts`.
