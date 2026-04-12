# Tasks — Evaluation Framework Cleanup

## Completed
- [x] Reviewed full codebase architecture
- [x] Created `src/evaluation/suite.ts` — `EvalSuite` declarative runner
- [x] Created `examples/evals/reasoning.ts` — LLM judge example
- [x] Created `examples/evals/instruction.ts` — deterministic scoring example
- [x] Created `examples/evals/car-wash.ts` — car wash test using EvalSuite
- [x] Fixed result-file caching (retry on error/zero-score judge results)
- [x] Built `PairwiseRanker` class (`src/evaluation/ranking/pairwise-ranker.ts`)
- [x] Created ranking barrel export (`src/evaluation/ranking/index.ts`)
- [x] Added EvalSuite + PairwiseRanker to public exports (`src/index.ts`)
- [x] Wrote tests — 48 new tests, all 895 tests pass (77 files)
- [x] Updated `docs/guide/creating-evaluations.md` — rewrote around EvalSuite
- [x] Updated `docs/guide/model-evaluation.md` — added Quick Start section
- [x] Updated `docs/architecture/evaluation-framework.md` — removed phantom classes
- [x] Updated `docs/walkthroughs/car-wash-evaluation.md` — added Short Version
- [x] Verified `docs/guide/pairwise-ranking.md` — already correct
- [x] Updated `CLAUDE.md` — evaluation section rewritten
- [x] Updated `LLM.txt` — evaluation notes + examples
