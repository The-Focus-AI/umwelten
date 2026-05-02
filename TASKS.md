# Tasks — Local Providers Report Cleanup

## Completed
- [x] Run and finish `--matrix nothink`
- [x] Generate combined markdown report
- [x] Diagnose provider-name bug in combined report
- [x] Patch combine parser to recognize `llamaswap` and `llamaswap-nothink`
- [x] Regenerate combined markdown + narrative reports
- [x] Load Focus.AI shared design system
- [x] Load Focus.AI client design system
- [x] Load Focus.AI report command/template docs

## Completed
- [x] Rebuild the PDF as a clean client-style report from scratch
- [x] Generate client-branded HTML using a curated structure instead of raw pandoc dump
- [x] Render PDF with the client paged template and sane section breaks

## Completed
- [x] Inventory Gemma variants across Ollama and llama-swap/HF
- [x] Identify missing Gemma GGUFs needed to test all Gemmas on both runtimes
- [x] Download missing Gemma GGUFs
- [x] Extend llama-swap config for additional Gemma variants

## Completed (2026-04-29)
- [x] Restart llama-swap with expanded Gemma config (e2b/e4b/26b-a4b/31b serving on :8090)
- [x] Run Gemma llamaswap-nothink sweep (4 cells; 31b timed out on tool-calling)
- [x] Run Gemma ollama think-mode sweep (8 cells incl. llamaswap-think; 26b-a4b + 31b llamaswap-think timed out on tool-calling reasoning loop)
- [x] Regenerate combined markdown + narrative reports with new Gemma data

## Current
- [ ] Investigate Gemma tool-calling failure mode (calculator infinite-loop in nothink, reasoning-loop watchdog timeouts in think) — affects e2b through 31b across runtimes

## Planned
- [ ] Keep detailed raw markdown report as appendix/source artifact
